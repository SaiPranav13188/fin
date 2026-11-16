"""Insights (Q&A): answers questions about the user's money with read-only SQL.

Isolation is by construction, not by trusting the query: we copy ONLY this user's rows into a
throwaway in-memory SQLite database, and the model's SQL runs there with an authorizer that
allows nothing but SELECT, plus a time limit and a row limit. There is no path to other users'
data or to the real database.
"""
import re
import sqlite3
import time
from datetime import date

from sqlalchemy import select

from ..models import Expense, Settlement, Subscription
from ..services import ledger, money
from .harness import AgentFailure, Ctx, as_data, clean_text, log_run, run_llm

AGENT = "insights"
SCHEMA_DOC = """Tables (amounts are in rupees):
expenses(id, group_name, description, category, spent_on DATE 'YYYY-MM-DD', total, my_share, i_paid)
  - my_share: the user's part of the expense. i_paid: what the user paid towards it.
  - category is one of: food, groceries, travel, rent, bills, shopping, fun, health, other
balances(group_name, person, amount)  -- positive: they owe the user. negative: the user owes them.
settlements(group_name, from_person, to_person, amount, paid_on DATE)  -- 'You' is the user
subscriptions(label, amount, renews_on DATE, frequency)"""


def build_sandbox(ctx: Ctx) -> sqlite3.Connection:
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.executescript("""
        CREATE TABLE expenses(id TEXT, group_name TEXT, description TEXT, category TEXT, spent_on TEXT,
                              total REAL, my_share REAL, i_paid REAL);
        CREATE TABLE balances(group_name TEXT, person TEXT, amount REAL);
        CREATE TABLE settlements(group_name TEXT, from_person TEXT, to_person TEXT, amount REAL, paid_on TEXT);
        CREATE TABLE subscriptions(label TEXT, amount REAL, renews_on TEXT, frequency TEXT);""")
    for g, me in ledger.user_groups(ctx.db, ctx.user):
        names = {m.id: ("You" if m.id == me.id else m.name) for m in g.members}
        for e in ctx.db.scalars(select(Expense).where(Expense.group_id == g.id)):
            share = next((s.amount_paise for s in e.shares if s.member_id == me.id), 0)
            paid = next((p.amount_paise for p in e.payers if p.member_id == me.id), 0)
            con.execute("INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?)",
                        (e.id, g.name, e.description, e.category, str(e.spent_on), e.amount_paise / 100,
                         share / 100, paid / 100))
        for t in ledger.group_transfers(ctx.db, g):
            if t.to_member == me.id:
                con.execute("INSERT INTO balances VALUES (?,?,?)", (g.name, names[t.from_member], t.amount_paise / 100))
            elif t.from_member == me.id:
                con.execute("INSERT INTO balances VALUES (?,?,?)", (g.name, names[t.to_member], -t.amount_paise / 100))
        for s in ctx.db.scalars(select(Settlement).where(Settlement.group_id == g.id)):
            con.execute("INSERT INTO settlements VALUES (?,?,?,?,?)",
                        (g.name, names.get(s.from_member), names.get(s.to_member), s.amount_paise / 100,
                         str(s.created_at.date())))
    for sub in ctx.db.scalars(select(Subscription).where(Subscription.user_id == ctx.user.id)):
        con.execute("INSERT INTO subscriptions VALUES (?,?,?,?)",
                    (sub.label, sub.amount_paise / 100, str(sub.renews_on), sub.frequency))
    con.commit()

    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}

    def authorizer(action, arg1, arg2, dbname, source):
        if action == sqlite3.SQLITE_FUNCTION and (arg2 or "").lower() in ("load_extension", "readfile", "writefile"):
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY

    con.set_authorizer(authorizer)
    return con


def run_sql(con: sqlite3.Connection, query: str) -> dict:
    query = query.strip().rstrip(";")
    if ";" in query or not re.match(r"(?is)^\s*(select|with)\b", query) or len(query) > 1500:
        raise ValueError("Only a single SELECT statement is allowed")
    deadline = time.monotonic() + 1.0
    con.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 2000)
    try:
        cur = con.execute(query)
        rows = cur.fetchmany(50)
        cols = [c[0] for c in cur.description or []]
    except sqlite3.Error as e:
        raise ValueError(f"SQL error: {e}") from e
    finally:
        con.set_progress_handler(None, 0)
    return {"columns": cols, "rows": [list(r) for r in rows]}


_ANSWER_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["answer", "answerable"],
                  "properties": {"answer": {"type": "string", "description": "1-2 friendly sentences with ₹ amounts"},
                                 "answerable": {"type": "boolean"}}}
_SYSTEM = f"""You are Fin's Insights agent. Answer the user's question about their own shared expenses.
Use the run_sql tool (SQLite, SELECT only) to look up facts. Never state a number you did not get from run_sql.
Today is {{today}}. "My spending" means SUM(my_share). If the data cannot answer the question, set answerable to false and say what you can answer instead.
Keep the answer short, warm and in plain words. Use ₹ and Indian number grouping.

{SCHEMA_DOC}"""


def rules_answer(con: sqlite3.Connection, q: str) -> tuple[str, list[dict]]:
    low = q.lower()
    month = date.today().strftime("%Y-%m")
    used = []

    def query(sql):
        r = run_sql(con, sql)
        used.append({"sql": sql, **r})
        return r["rows"]

    cat = next((c for c in ("food", "groceries", "travel", "rent", "bills", "shopping", "fun", "health") if c in low), None)
    if re.search(r"owes? me|owe me|who owes", low):
        rows = query("SELECT person, SUM(amount) a FROM balances WHERE amount > 0 GROUP BY person ORDER BY a DESC LIMIT 5")
        if not rows:
            return "Nobody owes you anything right now. All clear 🎉", used
        top = rows[0]
        rest = ", ".join(f"{r[0]} {money.rupees(round(r[1] * 100))}" for r in rows[1:])
        return f"{top[0]} owes you the most: {money.rupees(round(top[1] * 100))}." + (f" Then {rest}." if rest else ""), used
    if re.search(r"(do i|i) owe|whom do i", low):
        rows = query("SELECT person, -SUM(amount) a FROM balances WHERE amount < 0 GROUP BY person ORDER BY a DESC LIMIT 5")
        if not rows:
            return "You don't owe anyone. You're square ✓", used
        return "You owe " + ", ".join(f"{r[0]} {money.rupees(round(r[1] * 100))}" for r in rows) + ".", used
    if "subscription" in low:
        rows = query("SELECT COUNT(*), COALESCE(SUM(amount),0) FROM subscriptions WHERE frequency='monthly'")
        return f"You have {rows[0][0]} monthly subscriptions costing {money.rupees(round(rows[0][1] * 100))} a month.", used
    if re.search(r"spen[dt]|kharch|how much", low):
        when = "" if re.search(r"all time|overall|ever|total so far", low) else f" AND spent_on LIKE '{month}%'"
        label = "so far" if not when else "this month"
        if cat:
            rows = query(f"SELECT COALESCE(SUM(my_share),0) FROM expenses WHERE category='{cat}'{when}")
            return f"You've spent {money.rupees(round(rows[0][0] * 100))} on {cat} {label}.", used
        rows = query(f"SELECT category, SUM(my_share) s FROM expenses WHERE 1=1{when} GROUP BY category ORDER BY s DESC")
        if not rows:
            return f"No spending recorded {label} yet.", used
        total = sum(r[1] for r in rows)
        return (f"You've spent {money.rupees(round(total * 100))} {label}. "
                f"Most of it on {rows[0][0]} ({money.rupees(round(rows[0][1] * 100))})."), used
    return ("I can answer things like “How much did I spend on food this month?”, “Who owes me the most?” "
            "or “What do I owe?”"), used


def ask(ctx: Ctx, question: str) -> dict:
    started = time.monotonic()
    question = clean_text(question, 400)
    ctx.step(AGENT, "Gathering your records")
    con = build_sandbox(ctx)
    used: list[dict] = []

    def tool(query: str):
        r = run_sql(con, query)
        used.append({"sql": query, **r})
        return r

    spec = {"name": "run_sql", "description": "Run one read-only SQLite SELECT over the user's own records.",
            "strict": True, "input_schema": {"type": "object", "additionalProperties": False, "required": ["query"],
                                             "properties": {"query": {"type": "string"}}}}
    status = "ok"
    try:
        out = run_llm(ctx, agent=AGENT, system=_SYSTEM.replace("{today}", str(date.today())), schema=_ANSWER_SCHEMA,
                      tools=[spec], tool_impl={"run_sql": tool}, content=as_data("user_message", question))
        answer = clean_text(out["answer"], 500)
        # No invented numbers: every figure in the answer must come from a query result.
        if out["answerable"] and re.search(r"\d", answer) and not any(u["rows"] for u in used):
            raise AgentFailure("answer has numbers but no query returned rows")
    except AgentFailure:
        ctx.model, status = "rules", "fallback"
        used.clear()
        answer, used = rules_answer(con, question)
    finally:
        pass
    con.close()
    res = {"kind": "answer", "answer": answer, "records": used[-3:], "source": "ai" if status == "ok" else "rules"}
    log_run(ctx, AGENT, question, {"answer": answer, "queries": [u["sql"] for u in used]}, status, started)
    return res
