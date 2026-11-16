"""Agent eval runner. Used by pytest (rules path, in CI) and by `python -m evals.runner` (model path if a key is set)."""
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("FIN_DATABASE_URL", "sqlite:///:memory:")

from app.agents import expense, money_agents, orchestrator  # noqa: E402
from app.agents.harness import Ctx  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Group, Member, User  # noqa: E402

CASES = json.loads((Path(__file__).parent / "cases.json").read_text())
NAMES = ["Sai", "Rahul", "Priya", "Arjun", "Sneha"]


def make_ctx(db) -> Ctx:
    user = User(name="Sai", email=f"sai{os.urandom(4).hex()}@example.com", password_hash="x", upi_id="sai@okbank")
    db.add(user)
    db.flush()
    g = Group(name="Flat 302", owner_id=user.id)
    g.members = [Member(name=n, user_id=user.id if n == "Sai" else None,
                        upi_id=f"{n.lower()}@okbank" if n != "Sneha" else None, verified=n in ("Sai", "Rahul"))
                 for n in NAMES]
    db.add(g)
    db.commit()
    return Ctx(db=db, user=user, group=g, me=g.members[0])


def run_expense_evals(ctx: Ctx) -> dict:
    by_name = {m.name: m.id for m in ctx.group.members}
    by_id = {v: k for k, v in by_name.items()}
    fields = correct = hallucinated = q_expected = q_asked = 0
    failures = []
    pause = float(os.environ.get("EVAL_PAUSE", "0"))  # seconds between cases, to stay under free-tier rate limits
    sources: dict[str, int] = {}
    for case in CASES["expense"]:
        text, exp = case["text"], case["expect"]
        ctx.tool_calls, ctx.tokens = [], 0
        d = expense.parse_expense(ctx, text)
        sources[d["source"]] = sources.get(d["source"], 0) + 1
        if pause and d["source"] == "ai":
            time.sleep(pause)
        bad = []
        # hallucination checks apply to every case
        if d["amount_paise"] is not None and not expense.traceable_amount(d["amount_paise"], text):
            hallucinated += 1
            bad.append("hallucinated amount")
        if any(i not in by_id for i in d["member_ids"]) or any(i not in by_id for i in d["payers"]):
            hallucinated += 1
            bad.append("hallucinated member")
        if "amount" in exp:
            fields += 1
            want = None if exp["amount"] is None else round(exp["amount"] * 100)
            ok = d["amount_paise"] == want
            correct += ok
            if not ok:
                bad.append(f"amount {d['amount_paise']} != {want}")
        if "payer" in exp:
            fields += 1
            ok = list(d["payers"]) == [by_name[exp["payer"]]]
            correct += ok
            if not ok:
                bad.append(f"payer {[by_id[i] for i in d['payers']]} != {exp['payer']}")
        if "people" in exp:
            fields += 1
            want = set(NAMES) if exp["people"] == "all" else set(exp["people"])
            got = {by_id[i] for i in d["member_ids"]}
            ok = got == want
            correct += ok
            if not ok:
                bad.append(f"people {sorted(got)} != {sorted(want)}")
        if "category" in exp:
            fields += 1
            ok = d["category"] == exp["category"]
            correct += ok
            if not ok:
                bad.append(f"category {d['category']} != {exp['category']}")
        if "asks" in exp:
            q_expected += 1
            ok = any(q["field"] == exp["asks"] for q in d["questions"])
            q_asked += ok
            if not ok:
                bad.append(f"did not ask about {exp['asks']}")
        if exp.get("ready") is True and not d["ready"]:
            bad.append(f"asked needlessly: {d['questions']}")
        if bad:
            failures.append({"text": text, "problems": bad})
    return {"cases": len(CASES["expense"]), "drafted_by": sources, "field_accuracy": correct / max(fields, 1), "hallucinated": hallucinated,
            "question_recall": q_asked / max(q_expected, 1), "failures": failures}


def run_intent_evals(ctx: Ctx) -> dict:
    wrong = [(c["text"], orchestrator.rules_intent(c["text"]), c["intent"]) for c in CASES["intent"]
             if orchestrator.rules_intent(c["text"]) != c["intent"]]
    return {"cases": len(CASES["intent"]), "accuracy": 1 - len(wrong) / len(CASES["intent"]), "failures": wrong}


def run_safety_evals(ctx: Ctx) -> dict:
    by_name = {m.name: m.id for m in ctx.group.members}
    missed = []
    for c in CASES["safety"]:
        out = money_agents.safety_check(ctx, by_name.get(c["to"], "nobody"), round(c["amount"] * 100), c.get("note", ""))
        codes = {f["code"] for f in out["flags"]}
        if not set(c["flags"]) <= codes or out["level"] != c["level"]:
            missed.append({"case": c, "got": sorted(codes), "level": out["level"]})
    return {"cases": len(CASES["safety"]), "flag_recall": 1 - len(missed) / len(CASES["safety"]), "failures": missed}


def run_all() -> dict:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        ctx = make_ctx(db)
        return {"expense": run_expense_evals(ctx), "intent": run_intent_evals(ctx), "safety": run_safety_evals(ctx)}


if __name__ == "__main__":
    report = run_all()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    e = report["expense"]
    ok = e["hallucinated"] == 0 and e["field_accuracy"] >= 0.95 and report["safety"]["flag_recall"] == 1
    sys.exit(0 if ok else 1)
