from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .services.money import valid_upi

Paise = int
SplitType = Literal["equal", "exact", "shares", "percent", "itemised"]
CATEGORIES = ("food", "groceries", "travel", "rent", "bills", "shopping", "fun", "health", "other")
Category = Literal["food", "groceries", "travel", "rent", "bills", "shopping", "fun", "health", "other"]
Frequency = Literal["once", "weekly", "monthly", "yearly"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _upi(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    v = v.strip().lower()
    if not valid_upi(v):
        raise ValueError("That doesn't look like a UPI ID (example: name@okhdfcbank)")
    return v


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    upi_id: str | None = None
    language: Literal["en", "hi", "te"] = "en"
    _v = field_validator("upi_id")(_upi)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class RefreshIn(BaseModel):
    refresh_token: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(ORM):
    id: str
    name: str
    email: str
    phone: str | None
    upi_id: str | None
    language: str


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    phone: str | None = Field(default=None, max_length=20)
    upi_id: str | None = None
    language: Literal["en", "hi", "te"] | None = None
    push_token: str | None = Field(default=None, max_length=200)
    _v = field_validator("upi_id")(_upi)


class MemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    upi_id: str | None = None
    _v = field_validator("upi_id")(_upi)


class MemberOut(ORM):
    id: str
    name: str
    upi_id: str | None
    verified: bool
    active: bool
    is_self: bool = False


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    emoji: str = Field(default="🍕", max_length=16)
    kind: Literal["group", "direct"] = "group"
    members: list[MemberIn] = Field(default_factory=list, max_length=50)


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    emoji: str | None = Field(default=None, max_length=16)


class GroupOut(BaseModel):
    id: str
    name: str
    emoji: str
    kind: str
    members: list[MemberOut]
    my_balance_paise: int = 0
    total_spent_paise: int = 0
    created_at: datetime


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    amount_paise: Paise = Field(gt=0)
    member_ids: list[str] = Field(default_factory=list)


class ExpenseIn(BaseModel):
    description: str = Field(min_length=1, max_length=140)
    amount_paise: Paise = Field(gt=0)
    category: Category = "other"
    split_type: SplitType = "equal"
    payers: dict[str, Paise] = Field(default_factory=dict)  # member_id -> paise; empty = "I paid it all"
    member_ids: list[str] = Field(default_factory=list)  # equal split; empty = everyone
    exact: dict[str, Paise] | None = None
    weights: dict[str, int] | None = None
    percents: dict[str, float] | None = None
    items: list[ItemIn] | None = None
    note: str | None = Field(default=None, max_length=280)
    spent_on: date | None = None


class ExpenseOut(BaseModel):
    id: str
    group_id: str
    description: str
    category: str
    amount_paise: int
    split_type: str
    note: str | None
    created_via: str
    spent_on: date
    created_at: datetime
    payers: dict[str, int]
    shares: dict[str, int]
    items: list[ItemIn]
    settled_member_ids: list[str] = []


class SettlementIn(BaseModel):
    from_member: str
    to_member: str
    amount_paise: Paise = Field(gt=0)
    method: Literal["upi", "cash"] = "upi"


class SettlementOut(ORM):
    id: str
    group_id: str
    from_member: str
    to_member: str
    amount_paise: int
    method: str
    created_at: datetime


class TransferOut(BaseModel):
    from_member: str
    to_member: str
    amount_paise: int
    upi_link: str | None = None
    over_upi_limit: bool = False


class BalancesOut(BaseModel):
    net: dict[str, int]
    transfers: list[TransferOut]
    all_settled: bool


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class MessageOut(ORM):
    id: str
    group_id: str
    sender_member: str | None
    body: str
    kind: str
    ref_id: str | None
    created_at: datetime


class ResponsibilityIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    payee: str | None = Field(default=None, max_length=80)
    amount_paise: Paise | None = Field(default=None, gt=0)
    due_date: date
    frequency: Frequency = "monthly"


class ResponsibilityOut(ResponsibilityIn, ORM):
    id: str
    paid: bool


class SubscriptionIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    amount_paise: Paise = Field(gt=0)
    renews_on: date
    frequency: Frequency = "monthly"
    autopay: bool = False


class SubscriptionOut(SubscriptionIn, ORM):
    id: str
    paid: bool


class ReminderOut(ORM):
    id: str
    kind: str
    ref_id: str
    due_at: date
    message: str
    status: str


class RecurringIn(BaseModel):
    expense: ExpenseIn
    frequency: Literal["weekly", "monthly"] = "monthly"
    next_run: date
