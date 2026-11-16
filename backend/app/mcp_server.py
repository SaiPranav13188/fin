"""MCP server: lets Claude Desktop use Fin. Same rule as the app: draft first, confirm to save.

Run:  FIN_MCP_EMAIL=you@example.com FIN_MCP_PASSWORD=... uv run python -m app.mcp_server
"""
import os

from mcp.server.mcpserver import MCPServer
from sqlalchemy import select

from .agents import expense
from .agents.harness import Ctx
from .db import Base, SessionLocal, engine
from .models import AgentDraft, User
from .schemas import ExpenseIn
from .security import verify_password
from .services import ledger, money

mcp = MCPServer("fin")


def _user(db) -> User:
    user = db.scalar(select(User).where(User.email == os.environ.get("FIN_MCP_EMAIL", "").lower()))
    if not user or not verify_password(os.environ.get("FIN_MCP_PASSWORD", ""), user.password_hash):
        raise ValueError("Set FIN_MCP_EMAIL and FIN_MCP_PASSWORD to your Fin login")
    return user


@mcp.tool()
def list_groups() -> list[dict]:
    """List your Fin groups with your balance in each (rupees; positive means you are owed)."""
    with SessionLocal() as db:
        return [{"group_id": g.id, "name": g.name, "my_balance_rupees": ledger.group_net(db, g).get(me.id, 0) / 100}
                for g, me in ledger.user_groups(db, _user(db))]


@mcp.tool()
def get_balances(group_id: str) -> dict:
    """Who owes whom in a group, as the fewest payments that settle it."""
    with SessionLocal() as db:
        g, _ = ledger.get_group(db, _user(db), group_id)
        names = {m.id: m.name for m in g.members}
        return {"payments": [f"{names[t.from_member]} pays {names[t.to_member]} {money.rupees(t.amount_paise)}"
                             for t in ledger.group_transfers(db, g)] or ["All settled"]}


@mcp.tool()
def draft_expense(group_id: str, text: str) -> dict:
    """Turn a sentence like 'I paid 1200 for pizza with Rahul' into a DRAFT. Nothing is saved.
    Show the draft to the user and call confirm_expense only after they approve it."""
    with SessionLocal() as db:
        user = _user(db)
        g, me = ledger.get_group(db, user, group_id)
        d = expense.parse_expense(Ctx(db=db, user=user, group=g, me=me), text)
        from datetime import datetime, timedelta, timezone
        row = AgentDraft(user_id=user.id, group_id=g.id, kind="expense", payload=d,
                         expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
        db.add(row)
        db.commit()
        names = {m.id: m.name for m in g.members}
        return {"draft_id": row.id, "description": d["description"], "ready": d["ready"],
                "amount_rupees": d["amount_paise"] / 100 if d["amount_paise"] else None,
                "paid_by": [names[i] for i in d["payers"]], "split_between": [names[i] for i in d["member_ids"]],
                "questions": [q["question"] for q in d["questions"]]}


@mcp.tool()
def confirm_expense(draft_id: str) -> dict:
    """Save a draft the user has approved. Fails if the draft still has open questions."""
    with SessionLocal() as db:
        user = _user(db)
        row = db.get(AgentDraft, draft_id)
        if not row or row.user_id != user.id or row.status != "pending":
            raise ValueError("Draft not found or already used")
        d = row.payload
        if not d.get("ready"):
            raise ValueError("This draft has open questions: " + "; ".join(q["question"] for q in d["questions"]))
        g, me = ledger.get_group(db, user, row.group_id)
        body = ExpenseIn(**{k: d[k] for k in ("description", "amount_paise", "category", "split_type", "member_ids",
                                             "payers", "exact", "weights", "percents")})
        e = ledger.create_expense(db, g, me, body, via="text", commit=False)
        row.status = "confirmed"
        db.commit()
        return {"saved": True, "expense_id": e.id}


if __name__ == "__main__":
    Base.metadata.create_all(engine)
    mcp.run()
