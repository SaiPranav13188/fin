"""Database-backed group operations shared by the REST routes, the agents and the jobs."""
import calendar
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (AgentDraft, Expense, ExpensePayer, Group, Item, Member, Message, RecurringExpense, Settlement,
                      Share, User)
from ..schemas import ExpenseIn, ExpenseOut, GroupOut, ItemIn, MemberOut, TransferOut
from . import money


def get_group(db: Session, user: User, group_id: str) -> tuple[Group, Member]:
    """Returns the group and the caller's own member row. 404 for anyone outside the group."""
    row = db.execute(
        select(Group, Member).join(Member, Member.group_id == Group.id)
        .where(Group.id == group_id, Member.user_id == user.id, Member.active)
    ).first()
    if not row:
        raise HTTPException(404, "Group not found")
    return row[0], row[1]


def user_groups(db: Session, user: User) -> list[tuple[Group, Member]]:
    rows = db.execute(
        select(Group, Member).join(Member, Member.group_id == Group.id)
        .where(Member.user_id == user.id, Member.active).order_by(Group.created_at.desc())
    ).all()
    return [(g, m) for g, m in rows]


def personal_group(db: Session, user: User) -> tuple[Group, Member]:
    """The user's private "My spending" ledger: a one-person group holding payments made outside Fin.
    Created on first use. It never shows in the group list and can never owe or be owed anything."""
    row = db.execute(select(Group, Member).join(Member, Member.group_id == Group.id)
                     .where(Member.user_id == user.id, Group.kind == "personal", Group.owner_id == user.id)).first()
    if row:
        return row[0], row[1]
    g = Group(name="My spending", emoji="💸", kind="personal", owner_id=user.id)
    me = Member(user_id=user.id, name=user.name, upi_id=user.upi_id, verified=True)
    g.members = [me]
    db.add(g)
    db.commit()
    return g, me


def fingerprint(day: date, paise: int, merchant: str, ref: str | None = None) -> str:
    import hashlib
    import re as _re
    norm = _re.sub(r"[^a-z0-9]", "", merchant.lower())[:40]
    return hashlib.sha1(f"{day.isoformat()}|{paise}|{norm}|{(ref or '').strip().lower()}".encode()).hexdigest()[:40]


def expense_dicts(db: Session, group_id: str) -> list[dict]:
    exps = db.scalars(select(Expense).where(Expense.group_id == group_id)).all()
    return [{"payers": {p.member_id: p.amount_paise for p in e.payers},
             "shares": {s.member_id: s.amount_paise for s in e.shares}} for e in exps]


def settlement_dicts(db: Session, group_id: str) -> list[dict]:
    rows = db.scalars(select(Settlement).where(Settlement.group_id == group_id)).all()
    return [{"from": s.from_member, "to": s.to_member, "amount": s.amount_paise} for s in rows]


def group_net(db: Session, group: Group) -> dict[str, int]:
    return money.net_balances([m.id for m in group.members], expense_dicts(db, group.id),
                              settlement_dicts(db, group.id))


def group_transfers(db: Session, group: Group, net: dict[str, int] | None = None) -> list[TransferOut]:
    net = net if net is not None else group_net(db, group)
    by_id = {m.id: m for m in group.members}
    out = []
    for t in money.simplify(net):
        to = by_id[t["to"]]
        over = t["amount_paise"] > get_settings().upi_max_paise
        link = None
        if money.valid_upi(to.upi_id) and not over:
            link = money.upi_link(to.upi_id, to.name, t["amount_paise"], f"Fin {group.name}")
        out.append(TransferOut(from_member=t["from"], to_member=t["to"], amount_paise=t["amount_paise"],
                               upi_link=link, over_upi_limit=over))
    return out


def member_out(m: Member, me: Member | None) -> MemberOut:
    return MemberOut(id=m.id, name=m.name, upi_id=m.upi_id, verified=m.verified, active=m.active,
                     is_self=bool(me and m.id == me.id))


def group_out(db: Session, group: Group, me: Member) -> GroupOut:
    net = group_net(db, group)
    total = sum(sum(e["shares"].values()) for e in expense_dicts(db, group.id))
    return GroupOut(id=group.id, name=group.name, emoji=group.emoji, kind=group.kind,
                    members=[member_out(m, me) for m in group.members if m.active or net.get(m.id)],
                    my_balance_paise=net.get(me.id, 0), total_spent_paise=total, created_at=group.created_at)


def expense_out(e: Expense) -> ExpenseOut:
    return ExpenseOut(
        id=e.id, group_id=e.group_id, description=e.description, category=e.category,
        amount_paise=e.amount_paise, split_type=e.split_type, note=e.note, created_via=e.created_via,
        spent_on=e.spent_on, created_at=e.created_at,
        payers={p.member_id: p.amount_paise for p in e.payers},
        shares={s.member_id: s.amount_paise for s in e.shares},
        items=[ItemIn(name=i.name, amount_paise=i.amount_paise, member_ids=i.member_ids) for i in e.items],
        currency=e.currency or "INR", original_minor=e.original_minor, fx_rate=e.fx_rate,
    )


def convert_currency(body: ExpenseIn) -> float | None:
    """For a foreign-currency expense, sets body.amount_paise from today's rate. Returns the rate used."""
    from . import fx
    cur = (body.currency or "INR").upper()
    body.currency = cur
    if cur == "INR":
        body.original_minor = None
        return None
    if not body.original_minor:
        raise HTTPException(422, "Enter the amount in " + cur)
    if body.split_type in ("exact", "itemised"):
        raise HTTPException(422, "For other currencies, split equally, by shares or by percent")
    try:
        paise, rate, _ = fx.to_paise(body.original_minor, cur)
    except fx.FxError as err:
        raise HTTPException(503, str(err)) from err
    body.amount_paise = max(paise, 1)
    payer = next(iter(body.payers), None)
    body.payers = {payer: body.amount_paise} if payer else {}  # one payer: the INR total is theirs
    return rate


def resolve_expense(group: Group, me: Member, body: ExpenseIn) -> tuple[dict[str, int], dict[str, int]]:
    """Validates an expense against the group and returns (payers, shares). Raises 422 with a human message."""
    s = get_settings()
    ids = {m.id for m in group.members if m.active}
    if body.amount_paise > s.max_expense_paise:
        raise HTTPException(422, "That amount is too large")

    def check(member_ids, what):
        unknown = [i for i in member_ids if i not in ids]
        if unknown:
            raise HTTPException(422, f"{what} includes someone who isn't in this group")

    payers = {k: v for k, v in body.payers.items() if v > 0} or {me.id: body.amount_paise}
    check(payers, "Payers")
    if sum(payers.values()) != body.amount_paise:
        raise HTTPException(422, "What people paid doesn't add up to the total")

    members = body.member_ids or [m.id for m in group.members if m.active]
    if len(set(members)) != len(members):
        raise HTTPException(422, "Someone is listed twice")
    check(members, "The split")
    for d in (body.exact, body.weights, body.percents):
        check(d or {}, "The split")
    for it in body.items or []:
        check(it.member_ids, f"“{it.name}”")
    try:
        shares = money.compute_shares(
            body.split_type, body.amount_paise, members, exact=body.exact, weights=body.weights,
            percents=body.percents, items=[i.model_dump() for i in body.items] if body.items else None)
    except money.SplitError as err:
        raise HTTPException(422, str(err)) from err
    return payers, shares


def create_expense(db: Session, group: Group, me: Member, body: ExpenseIn, via: str = "manual",
                   commit: bool = True, card: bool = True, external_ref: str | None = None) -> Expense:
    rate = convert_currency(body)
    payers, shares = resolve_expense(group, me, body)
    e = Expense(group_id=group.id, description=body.description.strip(), category=body.category,
                amount_paise=body.amount_paise, split_type=body.split_type, note=body.note, created_via=via,
                created_by=me.id, spent_on=body.spent_on or date.today(),
                currency=body.currency, original_minor=body.original_minor, fx_rate=rate, external_ref=external_ref)
    e.payers = [ExpensePayer(member_id=k, amount_paise=v) for k, v in payers.items()]
    e.shares = [Share(member_id=k, amount_paise=v) for k, v in shares.items() if v]
    e.items = [Item(name=i.name, amount_paise=i.amount_paise, member_ids=i.member_ids) for i in body.items or []]
    db.add(e)
    db.flush()
    if card:
        db.add(Message(group_id=group.id, sender_member=me.id, body=e.description, kind="split_card", ref_id=e.id))
    if commit:
        db.commit()
    return e


def next_date(d: date, frequency: str) -> date:
    if frequency == "weekly":
        return d + timedelta(days=7)
    if frequency == "yearly":
        return d.replace(year=d.year + 1, day=min(d.day, calendar.monthrange(d.year + 1, d.month)[1]))
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def delete_group_data(db: Session, group: Group) -> None:
    """Deletes a group and everything in it, children first, so Postgres foreign keys are never violated."""
    for e in db.scalars(select(Expense).where(Expense.group_id == group.id)).all():
        db.delete(e)  # payers, shares and items go with it
    from ..models import Goal
    for gl in db.scalars(select(Goal).where(Goal.group_id == group.id)).all():
        db.delete(gl)
    for model in (Settlement, Message, RecurringExpense, AgentDraft):
        db.query(model).filter(model.group_id == group.id).delete(synchronize_session=False)
    db.flush()
    db.delete(group)
