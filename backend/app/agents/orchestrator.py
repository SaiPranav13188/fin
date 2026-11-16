"""Orchestrator: a LangGraph graph that routes one message to the right agent.

    guard -> route -> (expense | settle | nudge | ask | clarify) -> END

Routing uses cheap rules first and only asks the model when the rules are unsure. Budgets,
retries and fallbacks live in the harness, so every node inherits them.
"""
import re
import time
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from . import expense, insights, money_agents
from .harness import AgentFailure, Ctx, as_data, clean_text, log_run, looks_like_injection, run_llm

INTENTS = ("add_expense", "settle_up", "nudge", "ask", "unclear")


class State(TypedDict, total=False):
    ctx: Ctx
    text: str
    intent: str
    result: dict


_ASK = re.compile(r"^(how much|how many|who|whom|what|which|when|kitna|kitne|kaun|kya|entha|evaru)\b|\?\s*$", re.I)
_SETTLE = re.compile(r"\bsettle|\bhisaab|\bclear (the )?dues|square up", re.I)
_NUDGE = re.compile(r"\bremind|\bnudge|\bping\b|yaad dila", re.I)
_SPEND_VERB = re.compile(r"\bpaid\b|\bspent\b|\bsplit\b|\bbought\b|\bdiya\b|\bdiye\b|\bkharcha\b|₹|\brs\b", re.I)


def rules_intent(text: str) -> str:
    has_number = bool(expense.numbers_in(text))
    if _NUDGE.search(text):
        return "nudge"
    if _SETTLE.search(text) and not has_number:
        return "settle_up"
    if _ASK.search(text) and not (has_number and _SPEND_VERB.search(text)):
        return "ask"
    if has_number or _SPEND_VERB.search(text):
        return "add_expense"
    return "unclear"


def _guard(state: State) -> State:
    ctx, text = state["ctx"], clean_text(state["text"])
    ctx.step("orchestrator", "Understanding what you need")
    if not text:
        return {"text": text, "intent": "unclear"}
    if looks_like_injection(text):
        # Still handled as plain data by the agents; flagged in the audit log.
        ctx.tool_calls.append({"tool": "guard", "note": "injection-like text"})
    return {"text": text}


def _route(state: State) -> State:
    if state.get("intent"):
        return {}
    ctx, text = state["ctx"], state["text"]
    intent = rules_intent(text)
    if intent == "unclear":
        try:
            out = run_llm(ctx, agent="orchestrator", content=as_data("user_message", text),
                          system="Classify what the user of a bill-splitting app wants. add_expense: recording money "
                                 "spent. settle_up: paying back or clearing balances. nudge: reminding a friend to pay. "
                                 "ask: a question about their spending or balances. unclear: anything else.",
                          schema={"type": "object", "additionalProperties": False, "required": ["intent"],
                                  "properties": {"intent": {"type": "string", "enum": list(INTENTS)}}})
            intent = out["intent"] if out["intent"] in INTENTS else "unclear"
        except AgentFailure:
            ctx.model = "rules"
    return {"intent": intent}


def _need_group(ctx: Ctx) -> dict | None:
    if ctx.group is None:
        return {"kind": "question", "question": "Which group is this for?", "field": "group"}
    return None


def _expense(state: State) -> State:
    ctx = state["ctx"]
    return {"result": _need_group(ctx) or expense.parse_expense(ctx, state["text"])}


def _settle(state: State) -> State:
    ctx = state["ctx"]
    return {"result": _need_group(ctx) or money_agents.plan_settle_up(ctx)}


def _nudge(state: State) -> State:
    ctx, text = state["ctx"], state["text"]
    if (q := _need_group(ctx)):
        return {"result": q}
    friend = money_agents.find_member_in_text(ctx, text)
    if not friend:
        return {"result": {"kind": "question", "question": "Who should I remind?", "field": "member"}}
    tone = "funny" if re.search(r"funny|joke|mazak", text, re.I) else "firm" if re.search(r"firm|strict|serious", text, re.I) else "polite"
    lang = ("hinglish" if re.search(r"hinglish", text, re.I) else "hi" if re.search(r"\bhindi\b", text, re.I)
            else "te" if re.search(r"telugu", text, re.I) else ctx.user.language)
    return {"result": money_agents.write_nudge(ctx, friend.id, tone, lang)}


def _ask(state: State) -> State:
    return {"result": insights.ask(state["ctx"], state["text"])}


def _clarify(state: State) -> State:
    ctx = state["ctx"]
    started = time.monotonic()
    res = {"kind": "question", "field": "intent",
           "question": "I can add an expense, settle up, remind a friend or answer a question about your spending. "
                       "Try “I paid 1200 for pizza with Rahul”."}
    log_run(ctx, "orchestrator", state.get("text", ""), res, "question", started)
    return {"result": res}


def _build():
    g = StateGraph(State)
    g.add_node("guard", _guard)
    g.add_node("route", _route)
    for name, fn in (("add_expense", _expense), ("settle_up", _settle), ("nudge", _nudge), ("ask", _ask),
                     ("unclear", _clarify)):
        g.add_node(name, fn)
        g.add_edge(name, END)
    g.add_edge(START, "guard")
    g.add_edge("guard", "route")
    g.add_conditional_edges("route", lambda s: s["intent"], {i: i for i in INTENTS})
    return g.compile()


graph = _build()


def handle(ctx: Ctx, text: str) -> dict:
    out = graph.invoke({"ctx": ctx, "text": text})
    result = dict(out["result"])
    result["intent"] = out.get("intent", "unclear")
    return result
