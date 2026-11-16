"""Database tables. Money is always integer paise."""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(timezone.utc)


def pk() -> Mapped[str]:
    return mapped_column(String(32), primary_key=True, default=new_id)


def fk(target: str, **kw) -> Mapped[str]:
    return mapped_column(String(32), ForeignKey(target, ondelete="CASCADE"), index=True, **kw)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    upi_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    language: Mapped[str] = mapped_column(String(10), default="en")
    push_token: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    family: Mapped[str] = mapped_column(String(32), index=True)  # rotation chain; reuse revokes it
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Group(Base):
    __tablename__ = "groups"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(String(60))
    emoji: Mapped[str] = mapped_column(String(16), default="🍕")
    kind: Mapped[str] = mapped_column(String(12), default="group")  # group | direct
    owner_id: Mapped[str] = fk("users.id")
    invite_token: Mapped[str] = mapped_column(String(32), unique=True, default=new_id)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    members: Mapped[list["Member"]] = relationship(back_populates="group", cascade="all, delete-orphan",
                                                   order_by="Member.created_at")


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_member_group_user"),)
    id: Mapped[str] = pk()
    group_id: Mapped[str] = fk("groups.id")
    user_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"),
                                                nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    upi_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)  # joined with their own account
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    group: Mapped[Group] = relationship(back_populates="members")


class Expense(Base):
    __tablename__ = "expenses"
    id: Mapped[str] = pk()
    group_id: Mapped[str] = fk("groups.id")
    description: Mapped[str] = mapped_column(String(140))
    category: Mapped[str] = mapped_column(String(24), default="other")
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    split_type: Mapped[str] = mapped_column(String(12))
    note: Mapped[str | None] = mapped_column(String(280), nullable=True)
    created_via: Mapped[str] = mapped_column(String(12), default="manual")  # manual|text|voice|receipt|recurring
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    spent_on: Mapped[date] = mapped_column(Date, default=lambda: now().date())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    payers: Mapped[list["ExpensePayer"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    shares: Mapped[list["Share"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    items: Mapped[list["Item"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class ExpensePayer(Base):
    __tablename__ = "expense_payers"
    expense_id: Mapped[str] = mapped_column(String(32), ForeignKey("expenses.id", ondelete="CASCADE"), primary_key=True)
    member_id: Mapped[str] = mapped_column(String(32), ForeignKey("members.id"), primary_key=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger)


class Share(Base):
    __tablename__ = "shares"
    expense_id: Mapped[str] = mapped_column(String(32), ForeignKey("expenses.id", ondelete="CASCADE"), primary_key=True)
    member_id: Mapped[str] = mapped_column(String(32), ForeignKey("members.id"), primary_key=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger)


class Item(Base):
    __tablename__ = "items"
    id: Mapped[str] = pk()
    expense_id: Mapped[str] = fk("expenses.id")
    name: Mapped[str] = mapped_column(String(80))
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    member_ids: Mapped[list[str]] = mapped_column(JSON, default=list)  # item_members, kept inline


class Settlement(Base):
    __tablename__ = "settlements"
    id: Mapped[str] = pk()
    group_id: Mapped[str] = fk("groups.id")
    from_member: Mapped[str] = mapped_column(String(32), ForeignKey("members.id"))
    to_member: Mapped[str] = mapped_column(String(32), ForeignKey("members.id"))
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    method: Mapped[str] = mapped_column(String(8), default="upi")  # upi | cash
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = pk()
    group_id: Mapped[str] = fk("groups.id")
    sender_member: Mapped[str | None] = mapped_column(String(32), nullable=True)
    body: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(12), default="text")  # text | split_card | settle_card | system
    ref_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Responsibility(Base):
    __tablename__ = "responsibilities"
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id")
    label: Mapped[str] = mapped_column(String(80))
    payee: Mapped[str | None] = mapped_column(String(80), nullable=True)
    amount_paise: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    due_date: Mapped[date] = mapped_column(Date)
    frequency: Mapped[str] = mapped_column(String(10), default="monthly")  # once | weekly | monthly | yearly
    paid: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id")
    label: Mapped[str] = mapped_column(String(80))
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    renews_on: Mapped[date] = mapped_column(Date)
    frequency: Mapped[str] = mapped_column(String(10), default="monthly")
    autopay: Mapped[bool] = mapped_column(Boolean, default=False)
    paid: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RecurringExpense(Base):
    __tablename__ = "recurring_expenses"
    id: Mapped[str] = pk()
    group_id: Mapped[str] = fk("groups.id")
    created_by: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON)  # an ExpenseIn body
    frequency: Mapped[str] = mapped_column(String(10), default="monthly")
    next_run: Mapped[date] = mapped_column(Date, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Reminder(Base):
    __tablename__ = "reminders"
    __table_args__ = (UniqueConstraint("user_id", "kind", "ref_id", "due_at", name="uq_reminder_once"),)
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id")
    kind: Mapped[str] = mapped_column(String(16))  # responsibility | subscription | split | nudge
    ref_id: Mapped[str] = mapped_column(String(32))
    due_at: Mapped[date] = mapped_column(Date)
    message: Mapped[str] = mapped_column(String(280))
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | done | dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AgentDraft(Base):
    """A draft an agent produced. Nothing is saved until the user confirms it."""
    __tablename__ = "agent_drafts"
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id")
    group_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[str] = mapped_column(String(16))  # expense | nudge
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | confirmed | discarded
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = pk()
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    agent: Mapped[str] = mapped_column(String(24), index=True)
    input: Mapped[str] = mapped_column(Text)
    tool_calls: Mapped[list] = mapped_column(JSON, default=list)
    output: Mapped[dict] = mapped_column(JSON, default=dict)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16))  # ok | fallback | question | blocked | error
    model: Mapped[str] = mapped_column(String(40), default="rules")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
