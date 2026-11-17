import csv
import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Expense, Reminder, Responsibility, Subscription, User
from ..schemas import ReminderOut, ResponsibilityIn, ResponsibilityOut, SubscriptionIn, SubscriptionOut
from ..security import current_user
from ..services import ledger

router = APIRouter(tags=["tracking"])


def _crud(model, schema_in, schema_out, path: str, date_field: str):
    def own(db: Session, user: User, rid: str):
        row = db.get(model, rid)
        if not row or row.user_id != user.id:
            raise HTTPException(404, "Not found")
        return row

    @router.get(path, response_model=list[schema_out])
    def list_(user: User = Depends(current_user), db: Session = Depends(get_db)):
        return db.scalars(select(model).where(model.user_id == user.id).order_by(getattr(model, date_field))).all()

    @router.post(path, response_model=schema_out, status_code=201)
    def create(body: schema_in, user: User = Depends(current_user), db: Session = Depends(get_db)):
        row = model(user_id=user.id, **body.model_dump())
        db.add(row)
        db.commit()
        return row

    @router.put(path + "/{rid}", response_model=schema_out)
    def update(rid: str, body: schema_in, user: User = Depends(current_user), db: Session = Depends(get_db)):
        row = own(db, user, rid)
        for k, v in body.model_dump().items():
            setattr(row, k, v)
        db.commit()
        return row

    @router.post(path + "/{rid}/paid", response_model=schema_out)
    def mark_paid(rid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
        """Marks this cycle paid. Repeating entries roll forward to their next date."""
        row = own(db, user, rid)
        if row.frequency == "once":
            row.paid = True
        else:
            setattr(row, date_field, ledger.next_date(getattr(row, date_field), row.frequency))
            row.paid = False
        db.query(Reminder).filter_by(user_id=user.id, ref_id=row.id, status="open").update({"status": "done"})
        db.commit()
        return row

    @router.delete(path + "/{rid}", status_code=204)
    def delete(rid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
        row = own(db, user, rid)
        db.query(Reminder).filter_by(user_id=user.id, ref_id=row.id).delete()
        db.delete(row)
        db.commit()


_crud(Responsibility, ResponsibilityIn, ResponsibilityOut, "/responsibilities", "due_date")
_crud(Subscription, SubscriptionIn, SubscriptionOut, "/subscriptions", "renews_on")


@router.get("/reminders", response_model=list[ReminderOut])
def reminders(user: User = Depends(current_user), db: Session = Depends(get_db)):
    from ..agents.monitor import run_monitor_for_user
    run_monitor_for_user(db, user)  # cheap and idempotent, so the feed is fresh even between daily runs
    return db.scalars(select(Reminder).where(Reminder.user_id == user.id, Reminder.status == "open")
                      .order_by(Reminder.due_at)).all()


@router.post("/reminders/{rid}/{action}", response_model=ReminderOut)
def act_on_reminder(rid: str, action: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(Reminder, rid)
    if not row or row.user_id != user.id or action not in ("done", "dismiss"):
        raise HTTPException(404, "Not found")
    row.status = "done" if action == "done" else "dismissed"
    db.commit()
    return row


@router.get("/me/summary")
def summary(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Home screen numbers: what you owe, what you're owed, this month by category."""
    owe = owed = 0
    groups = []
    month = date.today().replace(day=1)
    by_cat: dict[str, int] = {}
    for g, me in ledger.user_groups(db, user):
        bal = ledger.group_net(db, g).get(me.id, 0)
        owed += max(bal, 0)
        owe += max(-bal, 0)
        groups.append({"id": g.id, "name": g.name, "emoji": g.emoji, "balance_paise": bal})
        for e in db.scalars(select(Expense).where(Expense.group_id == g.id, Expense.spent_on >= month)):
            mine = next((s.amount_paise for s in e.shares if s.member_id == me.id), 0)
            if mine:
                by_cat[e.category] = by_cat.get(e.category, 0) + mine
    subs = db.scalars(select(Subscription).where(Subscription.user_id == user.id)).all()
    return {"you_owe_paise": owe, "you_are_owed_paise": owed, "groups": groups,
            "month_spend_paise": sum(by_cat.values()), "month_by_category": by_cat,
            "subscriptions_monthly_paise": sum(s.amount_paise for s in subs if s.frequency == "monthly")}


def _month_bounds(month: str | None) -> tuple[date, date, date]:
    today = date.today()
    try:
        y, m = (int(x) for x in month.split("-")) if month else (today.year, today.month)
        start = date(y, m, 1)
    except Exception as err:
        raise HTTPException(422, "month must look like 2026-11") from err
    nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    prev = date(y - 1, 12, 1) if m == 1 else date(y, m - 1, 1)
    return prev, start, nxt


def _collect(db: Session, user: User, lo: date, hi: date) -> dict:
    """The user's own share of everything spent between lo (inclusive) and hi (exclusive)."""
    from collections import Counter
    total, count = 0, 0
    by_cat: Counter = Counter()
    by_day: Counter = Counter()
    buddies: Counter = Counter()
    groups: set[str] = set()
    biggest = None
    paid_back = 0
    for g, me in ledger.user_groups(db, user):
        names = {m.id: m.name for m in g.members}
        for e in db.scalars(select(Expense).where(Expense.group_id == g.id, Expense.spent_on >= lo, Expense.spent_on < hi)):
            mine = next((s.amount_paise for s in e.shares if s.member_id == me.id), 0)
            if not mine:
                continue
            total += mine
            count += 1
            by_cat[e.category] += mine
            by_day[e.spent_on.weekday()] += mine
            groups.add(g.id)
            for s in e.shares:
                if s.member_id != me.id and s.amount_paise:
                    buddies[names.get(s.member_id, "Someone")] += 1
            if biggest is None or mine > biggest["paise"]:
                biggest = {"description": e.description, "paise": mine, "group": g.name, "category": e.category}
        from ..models import Settlement
        for st in db.scalars(select(Settlement).where(Settlement.group_id == g.id, Settlement.from_member == me.id)):
            if lo <= st.created_at.date() < hi:
                paid_back += st.amount_paise
    return {"total": total, "count": count, "by_cat": by_cat, "by_day": by_day, "buddies": buddies,
            "groups": len(groups), "biggest": biggest, "paid_back": paid_back}


@router.get("/me/wrapped")
def wrapped(month: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A month in review: how much you spent, where, who with, and how it compares with last month."""
    prev, start, nxt = _month_bounds(month)
    cur, old = _collect(db, user, start, nxt), _collect(db, user, prev, start)
    pct = lambda a, b: round((a - b) * 100 / b) if b else None  # noqa: E731
    cats = [{"category": c, "paise": v, "prev_paise": old["by_cat"].get(c, 0), "change_pct": pct(v, old["by_cat"].get(c, 0))}
            for c, v in cur["by_cat"].most_common()]
    weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    top_day = cur["by_day"].most_common(1)
    buddy = cur["buddies"].most_common(1)
    return {
        "month": start.isoformat()[:7], "month_name": start.strftime("%B"),
        "total_paise": cur["total"], "prev_total_paise": old["total"], "change_pct": pct(cur["total"], old["total"]),
        "expense_count": cur["count"], "groups_active": cur["groups"], "paid_back_paise": cur["paid_back"],
        "by_category": cats, "biggest": cur["biggest"],
        "top_buddy": {"name": buddy[0][0], "count": buddy[0][1]} if buddy else None,
        "busiest_day": weekdays[top_day[0][0]] if top_day else None,
        "has_data": cur["count"] > 0,
    }


@router.get("/groups/{group_id}/export.csv")
def export_csv(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _ = ledger.get_group(db, user, group_id)
    names = {m.id: m.name for m in g.members}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Description", "Category", "Amount (INR)", "Paid by", "Split"])
    for e in db.scalars(select(Expense).where(Expense.group_id == g.id).order_by(Expense.spent_on)):
        def safe(s: str) -> str:  # stop spreadsheet formula injection
            return "'" + s if s[:1] in "=+-@" else s
        w.writerow([e.spent_on, safe(e.description), e.category, f"{e.amount_paise / 100:.2f}",
                    "; ".join(f"{safe(names.get(p.member_id, '?'))} {p.amount_paise / 100:.2f}" for p in e.payers),
                    "; ".join(f"{safe(names.get(s.member_id, '?'))} {s.amount_paise / 100:.2f}" for s in e.shares)])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="fin-export.csv"'})
