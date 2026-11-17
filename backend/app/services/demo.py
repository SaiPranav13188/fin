"""Throwaway demo accounts, so people can try Fin in a browser without signing up.

Each visitor gets their own account filled with sample friends, groups and expenses. Accounts are deleted 24 hours
after they are made. The email uses the reserved `.invalid` domain, so no mail can ever be sent to one.
"""
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Group, Member, Message, Responsibility, Subscription, User
from ..schemas import ExpenseIn
from ..security import hash_password
from . import ledger

DEMO_DOMAIN = "demo.fin.invalid"
DEMO_HOURS = 24
MAX_LIVE_DEMOS = 500  # keeps the free database small if the demo link spreads


def is_demo(user: User) -> bool:
    return user.email.endswith("@" + DEMO_DOMAIN)


def delete_account(db: Session, user: User) -> None:
    """Deletes a user and their personal data. Shared groups stay for friends who still use them."""
    from ..models import AgentDraft, AgentRun
    for g in db.scalars(select(Group).where(Group.owner_id == user.id)).all():
        heir = next((m for m in g.members if m.user_id and m.user_id != user.id and m.active), None)
        if heir:
            g.owner_id = heir.user_id
        else:
            ledger.delete_group_data(db, g)
    db.flush()
    for m in db.scalars(select(Member).where(Member.user_id == user.id)):
        m.user_id, m.upi_id, m.verified, m.name = None, None, False, "Former member"
    db.query(AgentRun).filter(AgentRun.user_id == user.id).delete(synchronize_session=False)
    db.query(AgentDraft).filter(AgentDraft.user_id == user.id).delete(synchronize_session=False)
    db.delete(user)


def cleanup_expired(db: Session, limit: int = 50) -> int:
    """Deletes demo accounts older than DEMO_HOURS. Runs a small batch each time a new demo starts."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=DEMO_HOURS)
    old = db.scalars(select(User).where(User.email.like(f"%@{DEMO_DOMAIN}"), User.created_at < cutoff)
                     .limit(limit)).all()
    for u in old:
        delete_account(db, u)
    if old:
        db.commit()
    return len(old)


def _add(db: Session, g: Group, payer: Member, desc: str, rupees: int, category: str, days_ago: int,
         among: list[Member] | None = None, weights: dict[str, int] | None = None) -> None:
    body = ExpenseIn(description=desc, amount_paise=rupees * 100, category=category,
                     split_type="shares" if weights else "equal",
                     payers={payer.id: rupees * 100}, member_ids=[m.id for m in among or []], weights=weights,
                     spent_on=date.today() - timedelta(days=days_ago))
    ledger.create_expense(db, g, payer, body, commit=False)


def create_demo_user(db: Session) -> User:
    cleanup_expired(db)
    live = db.scalar(select(func.count()).select_from(User).where(User.email.like(f"%@{DEMO_DOMAIN}")))
    if live >= MAX_LIVE_DEMOS:
        raise HTTPException(503, "The demo is very busy right now. Please try again in a little while.")

    user = User(name="Alex", email=f"demo-{secrets.token_hex(8)}@{DEMO_DOMAIN}",
                password_hash=hash_password(secrets.token_urlsafe(24)))  # random password: nobody can log in with it
    db.add(user)
    db.flush()

    # A trip with friends. Friends have no UPI IDs, so no demo payment can reach a real account.
    trip = Group(name="Goa Trip", emoji="🏖️", owner_id=user.id)
    me = Member(user_id=user.id, name=user.name, verified=True)
    priya, rahul, ananya = Member(name="Priya"), Member(name="Rahul"), Member(name="Ananya")
    trip.members = [me, priya, rahul, ananya]
    db.add(trip)
    db.flush()
    _add(db, trip, priya, "Villa booking", 12000, "travel", 6)
    _add(db, trip, me, "Beach shack dinner", 2400, "food", 5,
         weights={me.id: 3, priya.id: 3, rahul.id: 2, ananya.id: 3})  # Rahul skipped drinks
    _add(db, trip, rahul, "Cab from the airport", 1800, "travel", 6)
    _add(db, trip, me, "Scuba diving", 6000, "fun", 4, among=[me, priya, ananya])
    _add(db, trip, ananya, "Breakfast", 960, "food", 3)
    for who, text in [(priya, "That villa was worth every rupee 😍"), (rahul, "Who's booking the cab back?"),
                      (ananya, "I can. Will add it here after.")]:
        db.add(Message(group_id=trip.id, sender_member=who.id, body=text))

    # Flatmates with shared monthly costs.
    flat = Group(name="Flat 302", emoji="🏠", owner_id=user.id)
    me2 = Member(user_id=user.id, name=user.name, verified=True)
    rohan, meera = Member(name="Rohan"), Member(name="Meera")
    flat.members = [me2, rohan, meera]
    db.add(flat)
    db.flush()
    _add(db, flat, me2, "November rent", 30000, "rent", 10)
    _add(db, flat, meera, "Groceries", 3450, "groceries", 2)
    _add(db, flat, rohan, "Wi-Fi bill", 999, "bills", 8)

    today = date.today()
    db.add(Subscription(user_id=user.id, label="Netflix", amount_paise=64900, renews_on=today + timedelta(days=3)))
    db.add(Responsibility(user_id=user.id, label="Electricity bill", amount_paise=180000,
                          due_date=today + timedelta(days=5)))
    db.flush()
    return user
