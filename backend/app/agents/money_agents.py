"""Settle-up Planner, Nudge Writer and Safety Guard.

The planner and the guard are deterministic on purpose: anything that decides where money goes,
or whether a payment is safe, must give the same answer every time and work offline.
"""
import re
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from ..config import get_settings
from ..models import Settlement
from ..services import ledger, money
from .harness import AgentFailure, Ctx, as_data, clean_text, log_run, run_llm
from .tools import match_member


# ---------------- Settle-up Planner ----------------
def plan_settle_up(ctx: Ctx) -> dict:
    started = time.monotonic()
    g = ctx.group
    ctx.step("settle_planner", "Finding the fewest payments")
    names = {m.id: m.name for m in g.members}
    transfers = ledger.group_transfers(ctx.db, g)
    # The user's own payments come first, biggest first, so the app can walk them through in order.
    transfers.sort(key=lambda t: (t.from_member != ctx.me.id, -t.amount_paise))
    steps = [{**t.model_dump(), "from_name": names[t.from_member], "to_name": names[t.to_member],
              "mine": t.from_member == ctx.me.id,
              "needs_upi_id": t.upi_link is None and not t.over_upi_limit} for t in transfers]
    if not steps:
        summary = "Everyone is settled. Nothing to pay."
    else:
        mine = [s for s in steps if s["mine"]]
        summary = f"{len(steps)} payment{'s' if len(steps) != 1 else ''} settles the whole group."
        if mine:
            summary += f" You pay {money.rupees(sum(s['amount_paise'] for s in mine))}."
    out = {"kind": "settle_plan", "group_id": g.id, "steps": steps, "summary": summary}
    log_run(ctx, "settle_planner", g.name, out, "ok", started)
    return out


# ---------------- Nudge Writer ----------------
_TEMPLATES = {
    ("en", "polite"): "Hey {name}! Just a gentle reminder about {amount} for {what}. Whenever you get a moment 🙂",
    ("en", "funny"): "{name}, my wallet is sending SOS signals 🆘 {amount} for {what} would save it. No pressure (some pressure) 😄",
    ("en", "firm"): "Hi {name}, {amount} for {what} is still pending. Please settle it today. Thanks!",
    ("hi", "polite"): "नमस्ते {name}! {what} के {amount} बाकी हैं। जब समय मिले तो भेज देना 🙂",
    ("hi", "funny"): "{name} भाई, मेरा बटुआ रो रहा है 😅 {what} के {amount} भेज दो तो चुप हो जाएगा!",
    ("hi", "firm"): "{name}, {what} के {amount} अभी भी बाकी हैं। कृपया आज भेज दें। धन्यवाद!",
    ("hinglish", "polite"): "Hey {name}! {what} ke {amount} pending hain. Jab time mile tab bhej dena 🙂",
    ("hinglish", "funny"): "{name} bhai, mera wallet ro raha hai 😅 {what} ke {amount} bhej de, chup ho jayega!",
    ("hinglish", "firm"): "{name}, {what} ke {amount} abhi bhi pending hain. Aaj bhej do please. Thanks!",
    ("te", "polite"): "హాయ్ {name}! {what} కోసం {amount} ఇంకా పెండింగ్‌లో ఉంది. వీలైనప్పుడు పంపించు 🙂",
    ("te", "funny"): "{name}, నా వాలెట్ ఏడుస్తోంది 😅 {what} కోసం {amount} పంపిస్తే ఆగిపోతుంది!",
    ("te", "firm"): "{name}, {what} కోసం {amount} ఇంకా రాలేదు. దయచేసి ఈరోజే పంపించు. ధన్యవాదాలు!",
}
_NUDGE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["message"],
                 "properties": {"message": {"type": "string"}}}
_NUDGE_SYSTEM = """You are Fin's Nudge Writer. Write one short, warm reminder message (under 220 characters) from the user to a friend who owes them money.
Match the requested tone (polite, funny or firm) and language (en = English, hi = Hindi in Devanagari, hinglish = Hindi in Latin letters, te = Telugu script).
Mention the friend's first name and the exact amount as given, once. No other numbers, no links, no threats, no shaming, no mention of interest or penalties."""


def _nudge_ok(msg: str, amount_text: str, name: str) -> bool:
    """The validator: right amount, no other numbers, no links, sensible length."""
    if not (10 <= len(msg) <= 300) or amount_text not in msg:
        return False
    rest = msg.replace(amount_text, "")
    if re.search(r"\d|https?://|www\.|upi://|@\w+\.\w", rest):
        return False
    return True


def suggest_send_time(now: datetime | None = None) -> str:
    """Evenings get the best replies. Never suggest late night."""
    now = now or datetime.now(timezone(timedelta(hours=5, minutes=30)))
    at = now.replace(hour=19, minute=0, second=0, microsecond=0)
    if now.hour >= 19:
        at += timedelta(days=1)
    return at.isoformat()


def write_nudge(ctx: Ctx, member_id: str, tone: str = "polite", language: str = "en") -> dict:
    started = time.monotonic()
    agent = "nudge_writer"
    g = ctx.group
    tone = tone if tone in ("polite", "funny", "firm") else "polite"
    language = language if language in ("en", "hi", "hinglish", "te") else "en"
    friend = next((m for m in g.members if m.id == member_id), None)
    if not friend or friend.id == ctx.me.id:
        return {"kind": "nudge", "ready": False, "error": "Pick a friend from this group."}
    ctx.step(agent, "Checking what they owe")
    # The amount comes from the ledger, never from the model.
    owed = next((t.amount_paise for t in ledger.group_transfers(ctx.db, g)
                 if t.from_member == friend.id and t.to_member == ctx.me.id), 0)
    if owed <= 0:
        return {"kind": "nudge", "ready": False, "error": f"{friend.name} doesn't owe you anything right now 🎉"}
    amount_text = money.rupees(owed)
    first = friend.name.split()[0]
    fallback = _TEMPLATES[(language, tone)].format(name=first, amount=amount_text, what=g.name)
    message, status = fallback, "fallback"
    ctx.step(agent, "Writing a friendly reminder")
    try:
        out = run_llm(ctx, agent=agent, system=_NUDGE_SYSTEM, schema=_NUDGE_SCHEMA,
                      content=f"tone: {tone}\nlanguage: {language}\namount: {amount_text}\n"
                              f"{as_data('data', f'friend first name: {first}; group: {g.name}')}")
        candidate = clean_text(out["message"], 300)
        if _nudge_ok(candidate, amount_text, first):
            message, status = candidate, "ok"
        else:
            ctx.model = "rules"
    except AgentFailure:
        ctx.model = "rules"
    link = money.upi_link(ctx.me.upi_id, ctx.user.name, owed, f"Fin {g.name}") \
        if money.valid_upi(ctx.me.upi_id) and owed <= get_settings().upi_max_paise else None
    res = {"kind": "nudge", "ready": True, "group_id": g.id, "member_id": friend.id, "member_name": friend.name,
           "amount_paise": owed, "tone": tone, "language": language, "message": message, "pay_link": link,
           "suggested_time": suggest_send_time(), "source": "ai" if status == "ok" else "rules"}
    log_run(ctx, agent, f"{tone}/{language} -> {friend.name}", res, status, started)
    return res


def find_member_in_text(ctx: Ctx, text: str):
    members = [m for m in ctx.group.members if m.active and m.id != ctx.me.id]
    for w in re.findall(r"[^\W\d_]{2,}", text):
        if w.lower() in ("remind", "nudge", "about", "the", "for", "to", "ping", "ask", "pay", "send"):
            continue
        m = match_member(members, w.lower())
        if m:
            return m
    return None


# ---------------- Safety Guard ----------------
_SCAM = re.compile(
    r"collect request|receive money|to receive|enter (your )?(upi )?pin|scan (this |the )?qr to (get|receive)|"
    r"refund|cashback|kyc|lottery|prize|won |reward|electricity (bill )?disconnect|customer care|anydesk|"
    r"teamviewer|screen ?share|otp|verification fee|processing fee|paise wapas|inaam", re.I)


def safety_check(ctx: Ctx, to_member_id: str, amount_paise: int, note: str = "") -> dict:
    """Runs before every Pay. level: ok | caution | block. Calm wording, never scary."""
    started = time.monotonic()
    s = get_settings()
    g = ctx.group
    ctx.step("safety_guard", "Checking this payment is safe")
    to = next((m for m in g.members if m.id == to_member_id), None)
    flags: list[dict] = []

    def flag(code, level, title, detail):
        flags.append({"code": code, "level": level, "title": title, "detail": detail})

    if not to or to.id == ctx.me.id:
        flag("bad_payee", "block", "Pick who to pay", "Choose someone from this group.")
    else:
        if not money.valid_upi(to.upi_id):
            flag("no_upi", "block", "No UPI ID yet", f"Ask {to.name} for their UPI ID, or mark this as paid in cash.")
        past = ctx.db.scalars(select(Settlement).where(
            Settlement.group_id == g.id, Settlement.from_member == ctx.me.id, Settlement.to_member == to.id)).all()
        if money.valid_upi(to.upi_id) and not past:
            where = "not on Fin yet" if not to.verified else "new to you"
            flag("new_payee", "caution", "First time paying this UPI ID",
                 f"{to.upi_id} is {where}. Check the name in your UPI app before you pay.")
        if past:
            biggest = max(p.amount_paise for p in past)
            if amount_paise > 3 * biggest and amount_paise >= 2000_00:
                flag("unusual_amount", "caution", "Bigger than usual",
                     f"You've never sent {to.name} more than {money.rupees(biggest)}. Double-check the amount.")
        elif amount_paise >= 20000_00:
            flag("large_first", "caution", "Large first payment", "Take a second to confirm the amount and the person.")
        recent = datetime.now(timezone.utc) - timedelta(minutes=10)
        for p in past:
            at = p.created_at if p.created_at.tzinfo else p.created_at.replace(tzinfo=timezone.utc)
            if p.amount_paise == amount_paise and at > recent:
                flag("duplicate", "caution", "You may have paid this already",
                     f"You recorded {money.rupees(amount_paise)} to {to.name} a few minutes ago.")
                break
        owed = next((t.amount_paise for t in ledger.group_transfers(ctx.db, g)
                     if t.from_member == ctx.me.id and t.to_member == to.id), 0)
        if amount_paise > owed:
            flag("more_than_owed", "caution", "More than you owe",
                 f"You owe {to.name} {money.rupees(owed)} in this group.")
    if amount_paise <= 0:
        flag("bad_amount", "block", "Enter an amount", "The amount must be more than zero.")
    if amount_paise > s.upi_max_paise:
        flag("over_limit", "block", "Over the UPI limit",
             f"UPI allows up to {money.rupees(s.upi_max_paise)} per payment. Split it into smaller payments.")
    if _SCAM.search(note or ""):
        flag("scam_phrase", "caution", "This sounds like a common scam",
             "You never need to enter your PIN or approve a request to receive money. If someone asked you to, stop.")
    level = "block" if any(f["level"] == "block" for f in flags) else "caution" if flags else "ok"
    out = {"level": level, "flags": flags, "payee_name": to.name if to else None}
    log_run(ctx, "safety_guard", f"{amount_paise} -> {to_member_id}", out,
            "blocked" if level == "block" else "ok", started)
    return out
