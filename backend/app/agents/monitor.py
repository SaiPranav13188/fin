"""Monitor + Reminder: the daily job. Deterministic, idempotent (a unique key stops duplicates)."""
import json
import logging
import urllib.request
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Expense, Group, Member, RecurringExpense, Reminder, Responsibility, Subscription, User
from ..schemas import ExpenseIn
from ..services import ledger, money

log = logging.getLogger("fin.monitor")


def _when(d: date, today: date) -> str:
    n = (d - today).days
    return "today" if n == 0 else "tomorrow" if n == 1 else f"in {n} days" if n > 1 else f"{-n} day{'s' if n < -1 else ''} ago"


def _add(db: Session, user: User, kind: str, ref_id: str, due: date, message: str) -> Reminder | None:
    exists = db.scalar(select(Reminder.id).where(Reminder.user_id == user.id, Reminder.kind == kind,
                                                 Reminder.ref_id == ref_id, Reminder.due_at == due))
    if exists:
        return None
    r = Reminder(user_id=user.id, kind=kind, ref_id=ref_id, due_at=due, message=message)
    try:
        with db.begin_nested():
            db.add(r)
        return r
    except IntegrityError:
        return None


def run_monitor_for_user(db: Session, user: User, today: date | None = None) -> list[Reminder]:
    today = today or date.today()
    new: list[Reminder] = []
    for r in db.scalars(select(Responsibility).where(Responsibility.user_id == user.id, Responsibility.paid.is_(False),
                                                     Responsibility.due_date <= today + timedelta(days=3))):
        amt = f" {money.rupees(r.amount_paise)}" if r.amount_paise else ""
        verb = "was due" if r.due_date < today else "due"
        new.append(_add(db, user, "responsibility", r.id, r.due_date, f"{r.label}{amt} {verb} {_when(r.due_date, today)}."))
    for s in db.scalars(select(Subscription).where(Subscription.user_id == user.id, Subscription.paid.is_(False),
                                                   Subscription.renews_on <= today + timedelta(days=2),
                                                   Subscription.renews_on >= today)):
        new.append(_add(db, user, "subscription", s.id, s.renews_on,
                        f"{s.label} renews {_when(s.renews_on, today)} ({money.rupees(s.amount_paise)})."))
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    for g, me in ledger.user_groups(db, user):
        newest = db.scalar(select(Expense.created_at).where(Expense.group_id == g.id)
                           .order_by(Expense.created_at.desc()).limit(1))
        if not newest:
            continue
        newest = newest if newest.tzinfo else newest.replace(tzinfo=timezone.utc)
        if newest > week_ago:
            continue  # the group is active; nudging now would be nagging
        names = {m.id: m.name for m in g.members}
        monday = today - timedelta(days=today.weekday())  # at most one split reminder per friend per week
        for t in ledger.group_transfers(db, g):
            if t.to_member == me.id:
                new.append(_add(db, user, "split", t.from_member, monday,
                                f"{names[t.from_member]} still owes you {money.rupees(t.amount_paise)} in {g.name}."))
    db.commit()
    return [r for r in new if r]


def run_recurring(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    made = 0
    for r in db.scalars(select(RecurringExpense).where(RecurringExpense.active, RecurringExpense.next_run <= today)).all():
        g = db.get(Group, r.group_id)
        me = db.get(Member, r.created_by)
        try:
            body = ExpenseIn(**{**r.payload, "spent_on": r.next_run})
            ledger.create_expense(db, g, me, body, via="recurring", commit=False)
            r.next_run = ledger.next_date(r.next_run, r.frequency)
            db.commit()
            made += 1
        except Exception:  # e.g. a member left the group: pause it instead of failing every day
            db.rollback()
            r.active = False
            db.commit()
            log.warning("recurring expense %s paused", r.id)
    return made


def send_push(tokens_and_messages: list[tuple[str, str]]) -> None:
    """Expo push notifications. Failures are logged, never raised."""
    batch = [{"to": t, "title": "Fin", "body": m, "sound": "default"} for t, m in tokens_and_messages
             if t and t.startswith("ExponentPushToken")]
    if not batch:
        return
    try:
        req = urllib.request.Request("https://exp.host/--/api/v2/push/send", data=json.dumps(batch).encode(),
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        log.warning("push failed: %s", e)


def daily_job(db: Session) -> dict:
    made = run_recurring(db)
    pushes = []
    for user in db.scalars(select(User)).all():
        for r in run_monitor_for_user(db, user):
            if user.push_token:
                pushes.append((user.push_token, r.message))
    send_push(pushes)
    return {"recurring_created": made, "pushes": len(pushes)}
