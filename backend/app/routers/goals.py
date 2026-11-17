"""Group savings goals ("Goa trip fund"). Fin tracks who has chipped in; the money itself sits with the keeper."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Goal, GoalContribution, User
from ..schemas import ContributionIn, GoalIn
from ..security import current_user
from ..services import ledger, money
from .groups import notify

router = APIRouter(tags=["goals"])


class GoalOut(BaseModel):
    id: str
    name: str
    emoji: str
    target_paise: int
    saved_paise: int
    keeper_member: str
    keeper_upi_link: str | None
    due_on: date | None
    by_member: dict[str, int]
    reached: bool


def _out(g, goal: Goal) -> GoalOut:
    by: dict[str, int] = {}
    for c in goal.contributions:
        by[c.member_id] = by.get(c.member_id, 0) + c.amount_paise
    saved = sum(by.values())
    keeper = next((m for m in g.members if m.id == goal.keeper_member), None)
    left = max(goal.target_paise - saved, 0)
    link = None
    if keeper and money.valid_upi(keeper.upi_id) and 0 < left <= get_settings().upi_max_paise:
        link = money.upi_link(keeper.upi_id, keeper.name, left, f"Fin {goal.name}")
    return GoalOut(id=goal.id, name=goal.name, emoji=goal.emoji, target_paise=goal.target_paise, saved_paise=saved,
                   keeper_member=goal.keeper_member, keeper_upi_link=link, due_on=goal.due_on, by_member=by,
                   reached=saved >= goal.target_paise)


def _goal(db: Session, user: User, goal_id: str):
    goal = db.get(Goal, goal_id)
    if not goal:
        raise HTTPException(404, "Goal not found")
    g, me = ledger.get_group(db, user, goal.group_id)  # 404 for anyone outside the group
    return g, me, goal


@router.get("/groups/{group_id}/goals", response_model=list[GoalOut])
def list_goals(group_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _ = ledger.get_group(db, user, group_id)
    return [_out(g, x) for x in db.scalars(select(Goal).where(Goal.group_id == g.id).order_by(Goal.created_at))]


@router.post("/groups/{group_id}/goals", response_model=GoalOut, status_code=201)
def create_goal(group_id: str, body: GoalIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = ledger.get_group(db, user, group_id)
    keeper = body.keeper_member or me.id
    if keeper not in {m.id for m in g.members if m.active}:
        raise HTTPException(422, "The keeper must be in this group")
    if len(db.scalars(select(Goal.id).where(Goal.group_id == g.id)).all()) >= 10:
        raise HTTPException(422, "A group can have up to 10 goals")
    goal = Goal(group_id=g.id, name=body.name.strip(), emoji=body.emoji, target_paise=body.target_paise,
                keeper_member=keeper, due_on=body.due_on)
    db.add(goal)
    db.commit()
    notify(g.id, "goal")
    return _out(g, goal)


@router.post("/goals/{goal_id}/contributions", response_model=GoalOut, status_code=201)
def contribute(goal_id: str, body: ContributionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me, goal = _goal(db, user, goal_id)
    member = body.member_id or me.id
    if member not in {m.id for m in g.members}:
        raise HTTPException(422, "Pick someone from this group")
    db.add(GoalContribution(goal_id=goal.id, member_id=member, amount_paise=body.amount_paise))
    db.commit()
    db.refresh(goal)
    notify(g.id, "goal")
    return _out(g, goal)


@router.delete("/goals/{goal_id}/contributions/{cid}", response_model=GoalOut)
def undo_contribution(goal_id: str, cid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _, goal = _goal(db, user, goal_id)
    c = db.get(GoalContribution, cid)
    if not c or c.goal_id != goal.id:
        raise HTTPException(404, "Not found")
    db.delete(c)
    db.commit()
    db.refresh(goal)
    return _out(g, goal)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, _, goal = _goal(db, user, goal_id)
    db.delete(goal)
    db.commit()
    notify(g.id, "goal")


@router.get("/fx/{currency}")
def fx_rate(currency: str, user: User = Depends(current_user)):
    """Today's rate, so the app can preview the rupee amount while you type."""
    from ..services import fx
    try:
        rate, day = fx.rate_to_inr(currency)
    except fx.FxError as err:
        raise HTTPException(503 if "right now" in str(err) else 422, str(err)) from err
    return {"currency": currency.upper(), "rate": rate, "date": day, "supported": list(fx.CURRENCIES)}
