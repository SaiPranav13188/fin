"""Agent endpoints. Every one returns a DRAFT. The only write is /agent/confirm, after the user taps."""
import json
import queue
import threading
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..agents import insights, money_agents, orchestrator, receipt
from ..agents.harness import Ctx
from ..config import get_settings
from ..db import SessionLocal, get_db
from ..models import AgentDraft, User
from ..schemas import ExpenseIn, ExpenseOut, ItemIn
from ..security import check_rate, current_user
from ..services import ledger
from .groups import notify

router = APIRouter(prefix="/agent", tags=["agents"])


def _ctx(db: Session, user: User, group_id: str | None, emit=None) -> Ctx:
    check_rate(f"agent:{user.id}", get_settings().rate_agent_per_minute)
    group = me = None
    if group_id:
        group, me = ledger.get_group(db, user, group_id)
    return Ctx(db=db, user=user, group=group, me=me, emit=emit or (lambda e: None))


def _save_draft(db: Session, user: User, result: dict) -> dict:
    """Stores expense and nudge drafts so /agent/confirm can only commit something an agent really drafted."""
    if result.get("kind") in ("expense", "nudge") and not result.get("error"):
        d = AgentDraft(user_id=user.id, group_id=result.get("group_id"), kind=result["kind"], payload=result,
                       expires_at=datetime.now(timezone.utc) + timedelta(hours=24))
        db.add(d)
        db.commit()
        result = {**result, "draft_id": d.id}
    return result


class DraftIn(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    group_id: str | None = None
    source: Literal["text", "voice"] = "text"


@router.post("/draft")
def draft(body: DraftIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """One message in, one draft out (expense, settle plan, nudge, answer or a follow-up question)."""
    ctx = _ctx(db, user, body.group_id)
    result = orchestrator.handle(ctx, body.text)
    result["created_via"] = body.source
    return _save_draft(db, user, result)


@router.post("/draft/stream")
def draft_stream(body: DraftIn, user: User = Depends(current_user)):
    """Same as /agent/draft, as Server-Sent Events, so the app can act out each step with the mascot."""
    check_rate(f"agent:{user.id}", get_settings().rate_agent_per_minute)
    events: queue.Queue = queue.Queue()

    def work():
        with SessionLocal() as db:
            try:
                u = db.get(User, user.id)
                group = me = None
                if body.group_id:
                    group, me = ledger.get_group(db, u, body.group_id)
                ctx = Ctx(db=db, user=u, group=group, me=me, emit=events.put)
                result = orchestrator.handle(ctx, body.text)
                result["created_via"] = body.source
                events.put({"type": "result", "data": _save_draft(db, u, result)})
            except HTTPException as e:
                events.put({"type": "error", "message": str(e.detail)})
            except Exception:
                events.put({"type": "error", "message": "Something went wrong. Please try again."})
            finally:
                events.put(None)

    threading.Thread(target=work, daemon=True).start()

    def stream():
        while (e := events.get()) is not None:
            yield f"data: {json.dumps(e, default=str)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/receipt")
async def read_receipt(group_id: str = Form(...), image: UploadFile = File(...), user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    """Reads a bill photo into a draft. The image is held in memory only and never stored."""
    limit = get_settings().max_receipt_bytes
    data = await image.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, "That photo is too large. Try a smaller one.")
    ctx = _ctx(db, user, group_id)
    result = receipt.read_receipt(ctx, data)
    result["created_via"] = "receipt"
    return _save_draft(db, user, result)


class AdviceIn(BaseModel):
    group_id: str
    items: list[ItemIn] = Field(min_length=1, max_length=60)
    rule: str = Field(min_length=1, max_length=400)
    member_ids: list[str] = Field(default_factory=list)


@router.post("/split-advice")
def split_advice(body: AdviceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = _ctx(db, user, body.group_id)
    return receipt.advise_split(ctx, [i.model_dump() for i in body.items], body.rule, body.member_ids or None)


class GroupOnly(BaseModel):
    group_id: str


@router.post("/settle-plan")
def settle_plan(body: GroupOnly, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return money_agents.plan_settle_up(_ctx(db, user, body.group_id))


class NudgeIn(BaseModel):
    group_id: str
    member_id: str
    tone: Literal["polite", "funny", "firm"] = "polite"
    language: Literal["en", "hi", "hinglish", "te"] = "en"


@router.post("/nudge")
def nudge(body: NudgeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = _ctx(db, user, body.group_id)
    return _save_draft(db, user, money_agents.write_nudge(ctx, body.member_id, body.tone, body.language))


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=400)


@router.post("/ask")
def ask(body: AskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return insights.ask(_ctx(db, user, None), body.question)


class SafetyIn(BaseModel):
    group_id: str
    to_member: str
    amount_paise: int
    note: str = Field(default="", max_length=280)


@router.post("/safety-check")
def safety(body: SafetyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return money_agents.safety_check(_ctx(db, user, body.group_id), body.to_member, body.amount_paise, body.note)


class ConfirmIn(BaseModel):
    draft_id: str
    expense: ExpenseIn | None = None  # the final expense as the user approved it (they may have edited the draft)


@router.post("/confirm")
def confirm(body: ConfirmIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The single commit point. Re-validates everything with the same rules as a hand-made expense."""
    d = db.get(AgentDraft, body.draft_id)
    if not d or d.user_id != user.id:
        raise HTTPException(404, "Draft not found")
    expires = d.expires_at if d.expires_at.tzinfo else d.expires_at.replace(tzinfo=timezone.utc)
    if d.status != "pending" or expires < datetime.now(timezone.utc):
        raise HTTPException(409, "This draft was already used or has expired")
    if d.kind == "nudge":
        d.status = "confirmed"
        db.commit()
        return {"ok": True, "message": d.payload.get("message")}
    if not body.expense:
        raise HTTPException(422, "Send the expense you want to save")
    g, me = ledger.get_group(db, user, d.group_id)
    e = ledger.create_expense(db, g, me, body.expense, via=d.payload.get("created_via", "text"), commit=False)
    d.status = "confirmed"
    db.commit()
    notify(g.id, "expense", {"id": e.id})
    return ExpenseOut.model_validate(ledger.expense_out(e))


@router.post("/discard/{draft_id}", status_code=204)
def discard(draft_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(AgentDraft, draft_id)
    if d and d.user_id == user.id and d.status == "pending":
        d.status = "discarded"
        db.commit()
