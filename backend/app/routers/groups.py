import asyncio
from collections import defaultdict

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, get_db
from ..models import Expense, Group, Member, Message, RecurringExpense, Settlement, User, new_id
from ..schemas import (BalancesOut, ExpenseIn, ExpenseOut, GroupIn, GroupOut, GroupPatch, MemberIn, MemberOut,
                       MessageIn, MessageOut, RecurringIn, SettlementIn, SettlementOut)
from ..security import current_user, user_from_token
from ..services import ledger, money

router = APIRouter(tags=["groups"])


# ---- live updates: one in-process hub. Use Redis pub/sub if you ever run more than one instance. ----
class Hub:
    def __init__(self):
        self.rooms: dict[str, set[WebSocket]] = defaultdict(set)

    async def send(self, group_id: str, event: dict):
        for ws in list(self.rooms.get(group_id, ())):
            try:
                await ws.send_json(event)
            except Exception:
                self.rooms[group_id].discard(ws)


hub = Hub()


def push_members(db: Session, group: Group, actor: Member, text: str) -> None:
    """Phone notification to everyone else in the group who has the app. Sent in the background."""
    from ..agents.monitor import send_push
    from ..models import User as U
    ids = [m.user_id for m in group.members if m.user_id and m.id != actor.id and m.active]
    tokens = [u.push_token for u in db.scalars(select(U).where(U.id.in_(ids))) if u.push_token] if ids else []
    if tokens:
        import threading
        threading.Thread(target=send_push, args=([(t, text) for t in tokens],), daemon=True).start()


def notify(group_id: str, kind: str, data: dict | None = None):
    """Called from sync routes (worker threads) to push an event to everyone watching the group."""
    if not hub.rooms.get(group_id):
        return
    try:
        anyio.from_thread.run(hub.send, group_id, {"type": kind, **(data or {})})
    except Exception:
        pass


@router.websocket("/groups/{group_id}/ws")
async def group_ws(ws: WebSocket, group_id: str, token: str = Query("")):
    def allowed() -> bool:
        with SessionLocal() as db:
            user = user_from_token(db, token)
            if not user:
                return False
            return db.scalar(select(Member.id).where(Member.group_id == group_id, Member.user_id == user.id,
                                                     Member.active)) is not None
    if not await asyncio.to_thread(allowed):
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.rooms[group_id].add(ws)
    try:
        while True:
            await ws.receive_text()  # clients only listen; pings keep the socket open
    except WebSocketDisconnect:
        pass
    finally:
        hub.rooms[group_id].discard(ws)


# ---- groups ----
@router.get("/groups", response_model=list[GroupOut])
def list_groups(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [ledger.group_out(db, g, m) for g, m in ledger.user_groups(db, user)]


@router.post("/groups", response_model=GroupOut, status_code=201)
def create_group(body: GroupIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g = Group(name=body.name.strip(), emoji=body.emoji, kind=body.kind, owner_id=user.id)
    me = Member(user_id=user.id, name=user.name, upi_id=user.upi_id, verified=True)
    g.members = [me] + [Member(name=m.name.strip(), upi_id=m.upi_id) for m in body.members]
    db.add(g)
    db.commit()
    return ledger.group_out(db, g, me)


@router.get("/groups/{group_id}", response_model=GroupOut)
def read_group(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    return ledger.group_out(db, g, me)


@router.patch("/groups/{group_id}", response_model=GroupOut)
def patch_group(group_id: str, body: GroupPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(g, k, v)
    db.commit()
    return ledger.group_out(db, g, me)


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _ = ledger.get_group(db, user, group_id)
    if g.owner_id != user.id:
        raise HTTPException(403, "Only the person who made the group can delete it")
    if any(ledger.group_net(db, g).values()):
        raise HTTPException(409, "Settle up before deleting this group")
    ledger.delete_group_data(db, g)
    db.commit()


@router.post("/groups/{group_id}/members", response_model=MemberOut, status_code=201)
def add_member(group_id: str, body: MemberIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    if len(g.members) >= 50:
        raise HTTPException(422, "A group can have up to 50 people")
    if any(m.active and m.name.lower() == body.name.strip().lower() for m in g.members):
        raise HTTPException(409, "Someone with that name is already in the group")
    m = Member(group_id=g.id, name=body.name.strip(), upi_id=body.upi_id)
    db.add(m)
    db.commit()
    notify(g.id, "members")
    return ledger.member_out(m, me)


@router.patch("/groups/{group_id}/members/{member_id}", response_model=MemberOut)
def patch_member(group_id: str, member_id: str, body: MemberIn, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    m = next((x for x in g.members if x.id == member_id), None)
    if not m:
        raise HTTPException(404, "Member not found")
    if m.user_id and m.user_id != user.id:
        raise HTTPException(403, "Only they can change their own details")
    m.name, m.upi_id = body.name.strip(), body.upi_id
    db.commit()
    return ledger.member_out(m, me)


@router.delete("/groups/{group_id}/members/{member_id}", status_code=204)
def remove_member(group_id: str, member_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    m = next((x for x in g.members if x.id == member_id), None)
    if not m:
        raise HTTPException(404, "Member not found")
    if m.id != me.id and g.owner_id != user.id:
        raise HTTPException(403, "Only the group owner can remove other people")
    if ledger.group_net(db, g).get(m.id):
        raise HTTPException(409, f"{m.name} still has a balance. Settle up first.")
    m.active = False
    db.commit()
    notify(g.id, "members")


@router.post("/groups/{group_id}/invite")
def invite(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _ = ledger.get_group(db, user, group_id)
    return {"token": g.invite_token, "url": f"{get_settings().public_base_url}/join/{g.invite_token}"}


@router.post("/groups/{group_id}/invite/reset")
def reset_invite(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _ = ledger.get_group(db, user, group_id)
    g.invite_token = new_id()
    db.commit()
    return {"token": g.invite_token, "url": f"{get_settings().public_base_url}/join/{g.invite_token}"}


@router.get("/join/{token}/preview")
def join_preview(token: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g = db.scalar(select(Group).where(Group.invite_token == token))
    if not g:
        raise HTTPException(404, "This invite link is no longer valid")
    return {"name": g.name, "emoji": g.emoji,
            "claimable": [{"id": m.id, "name": m.name} for m in g.members if m.active and not m.user_id]}


@router.post("/join/{token}", response_model=GroupOut)
def join(token: str, claim_member_id: str | None = None, user: User = Depends(current_user),
         db: Session = Depends(get_db)):
    """Join by invite link. Optionally claim the placeholder a friend already made for you."""
    g = db.scalar(select(Group).where(Group.invite_token == token))
    if not g:
        raise HTTPException(404, "This invite link is no longer valid")
    mine = next((m for m in g.members if m.user_id == user.id), None)
    if mine:
        mine.active = True
    else:
        mine = next((m for m in g.members if m.id == claim_member_id and not m.user_id and m.active), None)
        if claim_member_id and not mine:
            raise HTTPException(409, "That spot is already taken")
        if mine:
            mine.user_id, mine.verified = user.id, True
            mine.upi_id = user.upi_id or mine.upi_id
        else:
            mine = Member(group_id=g.id, user_id=user.id, name=user.name, upi_id=user.upi_id, verified=True)
            db.add(mine)
    db.commit()
    db.refresh(g)
    notify(g.id, "members")
    return ledger.group_out(db, g, mine)


# ---- expenses ----
@router.get("/groups/{group_id}/expenses", response_model=list[ExpenseOut])
def list_expenses(group_id: str, limit: int = Query(50, le=200), offset: int = 0, q: str | None = None,
                  category: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ledger.get_group(db, user, group_id)
    stmt = select(Expense).where(Expense.group_id == group_id)
    if q:
        stmt = stmt.where(Expense.description.ilike(f"%{q}%"))
    if category:
        stmt = stmt.where(Expense.category == category)
    rows = db.scalars(stmt.order_by(Expense.created_at.desc()).limit(limit).offset(offset)).all()
    return [ledger.expense_out(e) for e in rows]


@router.post("/groups/{group_id}/expenses", response_model=ExpenseOut, status_code=201)
def add_expense(group_id: str, body: ExpenseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    e = ledger.create_expense(db, g, me, body)
    notify(g.id, "expense", {"id": e.id})
    push_members(db, g, me, f"{me.name} added {e.description} ({money.rupees(e.amount_paise)}) in {g.name}")
    return ledger.expense_out(e)


def _own_expense(db: Session, group_id: str, expense_id: str) -> Expense:
    e = db.get(Expense, expense_id)
    if not e or e.group_id != group_id:
        raise HTTPException(404, "Expense not found")
    return e


@router.get("/groups/{group_id}/expenses/{expense_id}", response_model=ExpenseOut)
def read_expense(group_id: str, expense_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ledger.get_group(db, user, group_id)
    return ledger.expense_out(_own_expense(db, group_id, expense_id))


@router.put("/groups/{group_id}/expenses/{expense_id}", response_model=ExpenseOut)
def edit_expense(group_id: str, expense_id: str, body: ExpenseIn, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    from ..models import ExpensePayer, Item, Share
    g, me = ledger.get_group(db, user, group_id)
    e = _own_expense(db, group_id, expense_id)
    payers, shares = ledger.resolve_expense(g, me, body)
    e.description, e.category, e.amount_paise = body.description.strip(), body.category, body.amount_paise
    e.split_type, e.note = body.split_type, body.note
    if body.spent_on:
        e.spent_on = body.spent_on
    e.payers.clear()
    e.shares.clear()
    e.items.clear()
    db.flush()
    e.payers = [ExpensePayer(member_id=k, amount_paise=v) for k, v in payers.items()]
    e.shares = [Share(member_id=k, amount_paise=v) for k, v in shares.items() if v]
    e.items = [Item(name=i.name, amount_paise=i.amount_paise, member_ids=i.member_ids) for i in body.items or []]
    db.commit()
    notify(g.id, "expense", {"id": e.id})
    return ledger.expense_out(e)


@router.delete("/groups/{group_id}/expenses/{expense_id}", status_code=204)
def delete_expense(group_id: str, expense_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _ = ledger.get_group(db, user, group_id)
    e = _own_expense(db, group_id, expense_id)
    db.query(Message).filter_by(group_id=group_id, ref_id=e.id).delete()
    db.delete(e)
    db.commit()
    notify(g.id, "expense", {"id": expense_id, "deleted": True})


@router.post("/groups/{group_id}/recurring", status_code=201)
def add_recurring(group_id: str, body: RecurringIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    ledger.resolve_expense(g, me, body.expense)  # validate now, so the monthly job can't fail later
    r = RecurringExpense(group_id=g.id, created_by=me.id, payload=body.expense.model_dump(mode="json"),
                         frequency=body.frequency, next_run=body.next_run)
    db.add(r)
    db.commit()
    return {"id": r.id, "next_run": r.next_run}


@router.get("/groups/{group_id}/recurring")
def list_recurring(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ledger.get_group(db, user, group_id)
    rows = db.scalars(select(RecurringExpense).where(RecurringExpense.group_id == group_id, RecurringExpense.active))
    return [{"id": r.id, "next_run": r.next_run, "frequency": r.frequency,
             "description": r.payload.get("description"), "amount_paise": r.payload.get("amount_paise")} for r in rows]


@router.delete("/groups/{group_id}/recurring/{rid}", status_code=204)
def stop_recurring(group_id: str, rid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ledger.get_group(db, user, group_id)
    r = db.get(RecurringExpense, rid)
    if not r or r.group_id != group_id:
        raise HTTPException(404, "Not found")
    r.active = False
    db.commit()


# ---- balances and settling up ----
@router.get("/groups/{group_id}/balances", response_model=BalancesOut)
def balances(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _ = ledger.get_group(db, user, group_id)
    net = ledger.group_net(db, g)
    return BalancesOut(net=net, transfers=ledger.group_transfers(db, g, net), all_settled=not any(net.values()))


@router.get("/groups/{group_id}/settlements", response_model=list[SettlementOut])
def list_settlements(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ledger.get_group(db, user, group_id)
    return db.scalars(select(Settlement).where(Settlement.group_id == group_id)
                      .order_by(Settlement.created_at.desc())).all()


@router.post("/groups/{group_id}/settlements", response_model=SettlementOut, status_code=201)
def settle(group_id: str, body: SettlementIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Records a payment the user says went through in their UPI app (or in cash). Fin never moves money."""
    g, me = ledger.get_group(db, user, group_id)
    ids = {m.id for m in g.members}
    if body.from_member not in ids or body.to_member not in ids or body.from_member == body.to_member:
        raise HTTPException(422, "Pick two different people from this group")
    net = ledger.group_net(db, g)
    owed = -net.get(body.from_member, 0)
    if body.amount_paise > max(owed, 0):
        raise HTTPException(422, "That's more than what is owed")
    s = Settlement(group_id=g.id, **body.model_dump())
    db.add(s)
    db.flush()
    db.add(Message(group_id=g.id, sender_member=me.id, body="", kind="settle_card", ref_id=s.id))
    db.commit()
    notify(g.id, "settlement", {"id": s.id})
    names = {m.id: m.name for m in g.members}
    push_members(db, g, me, f"{names[s.from_member]} paid {names[s.to_member]} {money.rupees(s.amount_paise)} in {g.name} ✓")
    return s


# ---- chat ----
@router.get("/groups/{group_id}/messages", response_model=list[MessageOut])
def list_messages(group_id: str, limit: int = Query(60, le=200), before: str | None = None,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    ledger.get_group(db, user, group_id)
    stmt = select(Message).where(Message.group_id == group_id)
    if before and (ref := db.get(Message, before)):
        stmt = stmt.where(Message.created_at < ref.created_at)
    rows = db.scalars(stmt.order_by(Message.created_at.desc()).limit(limit)).all()
    return rows[::-1]


@router.post("/groups/{group_id}/messages", response_model=MessageOut, status_code=201)
def post_message(group_id: str, body: MessageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    m = Message(group_id=g.id, sender_member=me.id, body=body.body.strip())
    db.add(m)
    db.commit()
    notify(g.id, "message", {"id": m.id})
    return m
