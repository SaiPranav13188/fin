"""Your personal spending: payments made outside Fin (GPay, PhonePe, Paytm, cards) added by statement import or by hand.

They live in a private one-person ledger, so they count toward "spent this month", categories, insights and
your monthly story, and can never create a balance between you and anyone else.
"""
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents import statement
from ..agents.harness import Ctx
from ..config import get_settings
from ..db import get_db
from ..models import Expense, User
from ..schemas import Category, ExpenseIn
from ..security import check_rate, current_user
from ..services import ledger

router = APIRouter(tags=["spending"])


class SpendIn(BaseModel):
    date: date
    merchant: str = Field(min_length=1, max_length=60)
    amount_paise: int = Field(gt=0, le=100_00_00_000)
    category: Category = "other"
    ref: str | None = Field(default=None, max_length=40)


class BulkIn(BaseModel):
    items: list[SpendIn] = Field(min_length=1, max_length=300)


def _add(db: Session, user: User, items: list[SpendIn], via: str) -> dict:
    g, me = ledger.personal_group(db, user)
    existing = {r for r in db.scalars(select(Expense.external_ref).where(Expense.group_id == g.id, Expense.external_ref.is_not(None)))}
    added = skipped = 0
    for it in items:
        if it.date > date.today():
            raise HTTPException(422, "A payment can't be dated in the future")
        fp = ledger.fingerprint(it.date, it.amount_paise, it.merchant, it.ref)
        if fp in existing:
            skipped += 1
            continue
        body = ExpenseIn(description=it.merchant, amount_paise=it.amount_paise, category=it.category, split_type="equal",
                         payers={me.id: it.amount_paise}, member_ids=[me.id], spent_on=it.date)
        ledger.create_expense(db, g, me, body, via=via, commit=False, card=False, external_ref=fp)
        existing.add(fp)
        added += 1
    db.commit()
    return {"added": added, "skipped_duplicates": skipped}


@router.get("/me/personal")
def personal(user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _ = ledger.personal_group(db, user)
    return {"group_id": g.id}


@router.post("/me/spend")
def add_spend(body: SpendIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _add(db, user, [body], "import")


@router.post("/me/spend/bulk")
def add_spend_bulk(body: BulkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _add(db, user, body.items, "import")


@router.post("/agent/statement")
async def read_statement(file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Reads a statement into a list of payments to review. The file is held in memory only and never stored."""
    check_rate(f"agent:{user.id}", get_settings().rate_agent_per_minute)
    data = await file.read(statement.MAX_FILE_BYTES + 1)
    if len(data) > statement.MAX_FILE_BYTES:
        raise HTTPException(413, "That file is too large. Export a shorter period and try again.")
    g, me = ledger.personal_group(db, user)
    ctx = Ctx(db=db, user=user, group=g, me=me)
    res = statement.read_statement(ctx, data, file.filename or "")
    if res.get("payments"):
        have = {r for r in db.scalars(select(Expense.external_ref).where(Expense.group_id == g.id, Expense.external_ref.is_not(None)))}
        for p in res["payments"]:
            p["duplicate"] = ledger.fingerprint(date.fromisoformat(p["date"]), p["amount_paise"], p["merchant"], p.get("ref")) in have
    return res
