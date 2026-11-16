"""Read-only tools. Each one is scoped to the signed-in user, so an agent can never see anyone else's data."""
import ast
import difflib
import operator

from sqlalchemy import select

from ..models import Expense, Settlement
from ..services import ledger
from .harness import Ctx

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.USub: operator.neg, ast.UAdd: operator.pos}


def calc(expression: str) -> float:
    """Safe arithmetic: numbers, + - * / and brackets only. No names, no calls."""
    if len(expression) > 200:
        raise ValueError("expression too long")

    def ev(n):
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        raise ValueError("only numbers and + - * / are allowed")

    return round(ev(ast.parse(expression.replace("×", "*").replace("÷", "/").replace(",", ""), mode="eval").body), 2)


def match_member(members, name: str, cutoff: float = 0.72):
    """Finds the group member a typed name refers to. Returns None when unsure (two close matches)."""
    name = name.strip().lower()
    if not name:
        return None
    scored = []
    for m in members:
        full = m.name.lower()
        parts = [full] + full.split()
        best = max(1.0 if name == p else 0.93 if p.startswith(name) and len(name) >= 3 else
                   difflib.SequenceMatcher(None, name, p).ratio() for p in parts)
        scored.append((best, m))
    scored.sort(key=lambda x: -x[0])
    if not scored or scored[0][0] < cutoff:
        return None
    if len(scored) > 1 and scored[1][0] >= cutoff and scored[0][0] - scored[1][0] < 0.05:
        return None  # ambiguous: ask instead of guessing
    return scored[0][1]


def build_tools(ctx: Ctx) -> tuple[list[dict], dict]:
    g, me = ctx.group, ctx.me
    active = [m for m in g.members if m.active] if g else []

    def get_members():
        return [{"member_id": m.id, "name": m.name, "is_user": m.id == me.id} for m in active]

    def search_contacts(name: str):
        m = match_member(active, name)
        return {"member_id": m.id, "name": m.name} if m else {"member_id": None, "note": "no confident match"}

    def get_balances():
        net = ledger.group_net(ctx.db, g)
        return [{"member_id": m.id, "name": m.name, "net_rupees": net.get(m.id, 0) / 100} for m in active]

    def get_expenses(limit: int = 10):
        rows = ctx.db.scalars(select(Expense).where(Expense.group_id == g.id)
                              .order_by(Expense.created_at.desc()).limit(min(max(limit, 1), 20))).all()
        return [{"description": e.description, "amount_rupees": e.amount_paise / 100, "category": e.category,
                 "date": str(e.spent_on)} for e in rows]

    def get_history(limit: int = 10):
        rows = ctx.db.scalars(select(Settlement).where(Settlement.group_id == g.id)
                              .order_by(Settlement.created_at.desc()).limit(min(max(limit, 1), 20))).all()
        names = {m.id: m.name for m in g.members}
        return [{"from": names.get(s.from_member), "to": names.get(s.to_member),
                 "amount_rupees": s.amount_paise / 100, "date": str(s.created_at.date())} for s in rows]

    impl = {"get_members": get_members, "search_contacts": search_contacts, "get_balances": get_balances,
            "get_expenses": get_expenses, "get_history": get_history, "calc": calc}

    def spec(name, desc, props=None, required=None):
        return {"name": name, "description": desc, "strict": True,
                "input_schema": {"type": "object", "properties": props or {}, "required": required or [],
                                 "additionalProperties": False}}

    specs = {
        "get_members": spec("get_members", "List everyone in this group with their member_id."),
        "search_contacts": spec("search_contacts", "Find the group member a (possibly misspelt) name refers to.",
                                {"name": {"type": "string"}}, ["name"]),
        "get_balances": spec("get_balances", "Net balance per member. Positive means the group owes them."),
        "get_expenses": spec("get_expenses", "Recent expenses in this group.",
                             {"limit": {"type": "integer"}}, ["limit"]),
        "get_history": spec("get_history", "Recent settle-up payments in this group.",
                            {"limit": {"type": "integer"}}, ["limit"]),
        "calc": spec("calc", "Evaluate arithmetic exactly, e.g. '2400 - 600 / 3'. Use it for any maths.",
                     {"expression": {"type": "string"}}, ["expression"]),
    }
    return specs, impl


def pick(specs: dict, impl: dict, names: list[str]) -> tuple[list[dict], dict]:
    return [specs[n] for n in names], {n: impl[n] for n in names}
