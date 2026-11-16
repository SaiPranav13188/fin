"""Expense Parser: a sentence (typed or spoken) -> a draft expense. Model first, rules as fallback.

Whatever path produced it, the draft goes through `validate_draft`, which removes anything that
cannot be traced back to the user's message or the group.
"""
import re
import time

from ..config import get_settings
from ..schemas import CATEGORIES
from .harness import AgentFailure, Ctx, as_data, clean_text, log_run, looks_like_injection, members_block, run_llm
from .tools import build_tools, match_member, pick

AGENT = "expense_parser"

# ---------- numbers ----------
_NUM = r"(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?"
_AMOUNT = re.compile(rf"(?P<cur>₹|\brs\.?|\binr|\brupees?)?\s*{_NUM}\s*(k|thousand|hazaar|hazar|lakh|lac|l)?\b(?!\s*%)", re.I)
_MULT = {"k": 1000, "thousand": 1000, "hazaar": 1000, "hazar": 1000, "lakh": 100000, "lac": 100000, "l": 100000}
_INDIC_DIGITS = str.maketrans("०१२३४५६७८९౦౧౨౩౪౫౬౭౮౯", "01234567890123456789")


def numbers_in(text: str) -> list[int]:
    """Every amount mentioned in the text, in paise. '2.5k' -> 250000."""
    text = text.translate(_INDIC_DIGITS)
    out = []
    for m in _AMOUNT.finditer(text):
        start = m.start(2)
        if not m.group("cur") and start > 0 and (text[start - 1].isalnum() or text[start - 1] in ".,"):
            continue  # part of a word or a longer number, like "room2"
        value = float(m.group(2).replace(",", "") + (m.group(3) or ""))
        value *= _MULT.get((m.group(4) or "").lower(), 1)
        if value > 0:
            out.append(round(value * 100))
    return out


def traceable_amount(paise: int, text: str) -> bool:
    """True when the amount is a number in the text, or a sum/difference of numbers in it."""
    nums = numbers_in(text)
    if paise in nums:
        return True
    if len(nums) > 8:
        return False
    sums = {0}
    for n in nums:
        sums |= {s + n for s in sums} | {s - n for s in sums}
    return paise in sums


# ---------- rules fallback ----------
_CATEGORY_WORDS = {
    "food": "pizza dinner lunch breakfast biryani restaurant cafe coffee chai tea snacks swiggy zomato food khana "
            "burger dosa maggi momos drinks beer bar dessert tiffin mess canteen",
    "groceries": "grocery groceries sabzi vegetables milk blinkit zepto bigbasket instamart kirana ration",
    "travel": "cab uber ola auto rickshaw taxi petrol fuel diesel train flight bus metro ticket toll trip hotel rapido",
    "rent": "rent kiraya deposit maintenance",
    "bills": "electricity wifi internet bill recharge gas water bijli broadband dth",
    "shopping": "amazon flipkart myntra shopping clothes shoes gift",
    "fun": "movie netflix party game concert outing bowling spotify",
    "health": "medicine doctor pharmacy hospital gym medical",
}
_CAT_LOOKUP = {w: c for c, words in _CATEGORY_WORDS.items() for w in words.split()}
_EVERYONE = re.compile(r"\b(everyone|everybody|all of us|all|sab|sabhi|sabne|andaru|whole group|the group)\b", re.I)
_SELF = {"i", "me", "my", "myself", "maine", "mai", "main", "mein", "mujhe", "nenu", "naa", "na"}
_STOP = set("""a an the and or for with to of on in at by from paid pay pays split spent got had have between among
we us our was is it this that each per rs inr rupees rupee k ka ki ke ko ne se aur bhi diya diye kiya kiye liya
hai tha the kal aaj today yesterday tonight last night bill total amount equally skipped share shared""".split())


def guess_category(text: str) -> str:
    for w in re.findall(r"[a-zA-Z]+", text.lower()):
        if w in _CAT_LOOKUP:
            return _CAT_LOOKUP[w]
    return "other"


def rules_parse(ctx: Ctx, text: str) -> dict:
    members = [m for m in ctx.group.members if m.active]
    me = ctx.me
    low = text.lower()
    nums = numbers_in(text)
    marked = re.search(rf"(?:₹|rs\.?|inr)\s*{_NUM}\s*(k|lakh|lac)?|{_NUM}\s*(?:k\b|rs\b|rupees?|/-)", low)
    after_verb = re.search(rf"\b(?:paid|spent|pay|diye|diya|kharch\w*)\s+(?:₹|rs\.?|inr)?\s*{_NUM}\s*(?:k|lakh|lac|thousand)?\b", low)
    # "Priya had 2 desserts" also contains a number: prefer one marked as money, then one right
    # after "paid"/"spent", else the largest.
    if marked:
        amount = (numbers_in(marked.group(0)) or nums)[0]
    elif after_verb and numbers_in(after_verb.group(0).split(None, 1)[1]):
        amount = numbers_in(after_verb.group(0).split(None, 1)[1])[0]
    else:
        amount = max(nums) if nums else None

    # several payers: "I paid 1200 and Rahul paid 800"
    multi = {}
    for who, rest, *_ in re.findall(rf"(\w+)\s+paid\s+((?:₹|rs\.?|inr)?\s*{_NUM}\s*(?:k|lakh|lac|thousand)?)\b", low):
        who_m = me if who in _SELF else match_member(members, who)
        got = numbers_in(rest)
        if who_m and got:
            multi[who_m.id] = multi.get(who_m.id, 0) + got[0]
    if len(multi) >= 2:
        amount = sum(multi.values())

    # payer: "<name> paid", "paid by <name>", "<name> ne diya/diye/pay kiya"; default is the user
    payer, payer_unknown = me, None
    pm = (re.search(r"paid by (\w+)", low) or re.search(r"(\w+)\s+(?:has\s+)?paid\b", low)
          or re.search(r"(\w+)\s+ne\s+(?:\S+\s+){0,3}?(?:diya|diye|pay|bhara|bhare)", low)
          or re.search(r"(\w+)\s+(?:kattadu|kattindi|ichadu|icchadu)", low))
    if pm and pm.group(1) not in _SELF:
        found = match_member(members, pm.group(1))
        if found:
            payer = found
        elif pm.group(1) not in _STOP and not pm.group(1).isdigit():
            payer_unknown = pm.group(1)

    # people: every word that confidently matches a member
    people, unknown = [], []
    everyone = bool(_EVERYONE.search(low))
    words = re.findall(r"[^\W\d_]+", text)
    for i, w in enumerate(words):
        lw = w.lower()
        if lw in _STOP or lw in _SELF or lw in _CAT_LOOKUP or len(lw) < 2:
            continue
        m = match_member(members, lw)
        if m:
            if m not in people:
                people.append(m)
        elif w[0].isupper() and i > 0 and w.isascii() and not _EVERYONE.fullmatch(lw):
            unknown.append(w)  # a capitalised word mid-sentence that isn't a member: probably a name
    if payer_unknown and payer_unknown.capitalize() not in unknown:
        unknown.append(payer_unknown.capitalize())

    if everyone or not people or people == [payer]:
        participants = members if (everyone or not unknown) else [me]
    else:
        participants = people + ([me] if me not in people else [])
        if payer not in participants:
            participants.append(payer)

    desc_words = [w for w in words if w.lower() not in _STOP and w.lower() not in _SELF
                  and not match_member(members, w.lower()) and w not in unknown and not _EVERYONE.fullmatch(w.lower())]
    description = " ".join(desc_words[:5]).strip().capitalize() or "Expense"
    return {
        "description": description, "amount_paise": amount, "category": guess_category(text),
        "payers": multi if len(multi) >= 2 else {payer.id: amount}, "split_type": "equal",
        "member_ids": [m.id for m in participants], "exact": None, "weights": None, "percents": None,
        "unknown_names": unknown, "question": None,
    }


# ---------- model path ----------
_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["description", "amount_rupees", "category", "payers", "everyone", "participants", "split_type",
                 "splits", "unknown_names", "question"],
    "properties": {
        "description": {"type": "string", "description": "2-4 words, e.g. 'Pizza dinner'"},
        "amount_rupees": {"type": ["number", "null"], "description": "Total bill. null if not stated."},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "payers": {"type": "array", "description": "Who paid. One entry unless several people paid parts.",
                   "items": {"type": "object", "additionalProperties": False,
                             "required": ["member_id", "amount_rupees"],
                             "properties": {"member_id": {"type": "string"},
                                            "amount_rupees": {"type": ["number", "null"]}}}},
        "everyone": {"type": "boolean", "description": "True if split with the whole group"},
        "participants": {"type": "array", "items": {"type": "string"}, "description": "member_ids sharing the cost"},
        "split_type": {"type": "string", "enum": ["equal", "exact", "shares", "percent"]},
        "splits": {"type": "array", "description": "For exact (rupees), shares (weights) or percent. Empty for equal.",
                   "items": {"type": "object", "additionalProperties": False, "required": ["member_id", "value"],
                             "properties": {"member_id": {"type": "string"}, "value": {"type": "number"}}}},
        "unknown_names": {"type": "array", "items": {"type": "string"},
                          "description": "People named in the message who are not in the group"},
        "question": {"type": ["string", "null"], "description": "One short question if something needed is missing"},
    },
}

_SYSTEM = """You are Fin's Expense Parser. Turn one message about a shared expense into a draft.
The message may be in English, Hindi, Hinglish or Telugu, with typos. "2.5k" means 2500. "I", "me", "maine", "nenu" mean the user.
The group's members are listed in <members> as member_id: name. Use search_contacts only if a name is misspelt and you are unsure who it is. Use calc for any arithmetic. For a simple message, answer straight away.
If nobody is said to have paid, the user paid. If no one is named to split with, set everyone to true.
The user is included in the split unless the message says otherwise.
Use split_type "equal" unless the message gives specific amounts, shares or percentages."""


def llm_parse(ctx: Ctx, text: str) -> dict:
    specs, impl = build_tools(ctx)
    tools, impl = pick(specs, impl, ["search_contacts", "calc"])
    out = run_llm(ctx, agent=AGENT, system=_SYSTEM, schema=_SCHEMA, tools=tools, tool_impl=impl,
                  content=members_block(ctx) + "\n" + as_data("user_message", text))
    to_paise = lambda r: round(r * 100) if isinstance(r, (int, float)) else None  # noqa: E731
    amount = to_paise(out["amount_rupees"])
    payers = {p["member_id"]: to_paise(p["amount_rupees"]) for p in out["payers"]}
    if len(payers) == 1 and amount:
        payers = {next(iter(payers)): amount}
    st = out["split_type"]
    splits = {s["member_id"]: s["value"] for s in out["splits"]}
    members = [m.id for m in ctx.group.members if m.active] if out["everyone"] else out["participants"]
    return {
        "description": out["description"], "amount_paise": amount, "category": out["category"], "payers": payers,
        "split_type": st, "member_ids": members,
        "exact": {k: round(v * 100) for k, v in splits.items()} if st == "exact" else None,
        "weights": {k: int(v) for k, v in splits.items()} if st == "shares" else None,
        "percents": splits if st == "percent" else None,
        "unknown_names": out["unknown_names"], "question": out["question"],
    }


# ---------- validator (runs on every draft, whichever path made it) ----------
def validate_draft(ctx: Ctx, text: str, d: dict) -> dict:
    """Strips anything not traceable to the message or the group, and turns gaps into questions."""
    s = get_settings()
    ids = {m.id: m for m in ctx.group.members if m.active}
    questions: list[dict] = []
    removed: list[str] = []

    amount = d.get("amount_paise")
    if amount is not None and (not isinstance(amount, int) or amount <= 0 or not traceable_amount(amount, text)):
        removed.append("amount")
        amount = None
    if amount is not None and amount > s.max_expense_paise:
        removed.append("amount")
        amount = None
    if amount is None:
        questions.append({"field": "amount", "question": "How much was it?"})

    payers = {k: v for k, v in (d.get("payers") or {}).items() if k in ids}
    if len(payers) != len(d.get("payers") or {}):
        removed.append("payer")
    if not payers:
        payers = {ctx.me.id: amount}
    if amount is None:
        payers = dict.fromkeys(payers, None)
    elif len(payers) == 1:
        payers = {next(iter(payers)): amount}
    elif any(v is None for v in payers.values()) or sum(payers.values()) != amount:
        questions.append({"field": "payers", "question": "How much did each person pay?"})

    member_ids = list(dict.fromkeys(i for i in d.get("member_ids") or [] if i in ids))
    if len(member_ids) != len(set(d.get("member_ids") or [])):
        removed.append("people")
    if not member_ids:
        member_ids = list(ids)

    split_type = d.get("split_type") if d.get("split_type") in ("equal", "exact", "shares", "percent") else "equal"
    exact = weights = percents = None
    if split_type == "exact":
        exact = {k: v for k, v in (d.get("exact") or {}).items() if k in ids and isinstance(v, int) and v >= 0}
        if amount is None or sum(exact.values()) != amount:
            questions.append({"field": "split", "question": "The amounts don't add up to the total. Can you check?"})
    elif split_type == "shares":
        weights = {k: v for k, v in (d.get("weights") or {}).items() if k in ids and isinstance(v, int) and v > 0}
        if not weights:
            split_type = "equal"
    elif split_type == "percent":
        percents = {k: v for k, v in (d.get("percents") or {}).items() if k in ids and v > 0}
        if abs(sum(percents.values()) - 100) > 0.01:
            questions.append({"field": "split", "question": "The percentages should add up to 100. Can you check?"})

    unknown = [clean_text(str(n), 40) for n in (d.get("unknown_names") or [])][:5]
    unknown = [n for n in unknown if n and n.lower() in text.lower()]  # the name must really be in the message
    for n in unknown:
        questions.append({"field": "people", "question": f"{n} isn't in this group yet. Add them?", "name": n})

    q = d.get("question")
    if q and not questions and isinstance(q, str):
        questions.append({"field": "other", "question": clean_text(q, 140)})

    category = d.get("category") if d.get("category") in CATEGORIES else "other"
    description = clean_text(str(d.get("description") or "Expense"), 60) or "Expense"
    if looks_like_injection(description):
        description = "Expense"
    return {
        "kind": "expense", "group_id": ctx.group.id, "description": description, "amount_paise": amount,
        "category": category, "payers": payers, "split_type": split_type, "member_ids": member_ids,
        "exact": exact, "weights": weights, "percents": percents, "items": None,
        "questions": questions, "removed_fields": sorted(set(removed)),
        "ready": not questions,
    }


_COMPLEX = re.compile(r"%|\b(skip\w*|except|only|each|half|but|not|didn'?t|without|extra|more|less|minus|plus|percent|"
                      r"shares?|twice|double|owes?|return\w*|refund\w*|nahi|nahin|chhod\w*|instead|per head)\b", re.I)


def simple_enough(ctx: Ctx, text: str) -> dict | None:
    """Rules first for simple sentences: instant, free and offline. Returns a finished draft, or None to use the model.

    Deliberately strict. One amount, a short Latin-script sentence, nothing that hints at an uneven split,
    and every word after "with" must be a known member. Anything else goes to the model.
    """
    words = re.findall(r"[^\W\d_]+", text)
    if not text.isascii() or len(words) > 10 or len(numbers_in(text)) != 1 or _COMPLEX.search(text):
        return None
    if looks_like_injection(text):
        return None
    members = [m for m in ctx.group.members if m.active]
    after_with = re.search(r"\b(?:with|between|among)\b(.*)$", text, re.I)
    for w in re.findall(r"[^\W\d_]+", after_with.group(1)) if after_with else []:
        lw = w.lower()
        if lw in _STOP or lw in _SELF or _EVERYONE.fullmatch(lw) or lw in ("friends", "us", "flatmates", "guys"):
            continue
        if not match_member(members, lw):
            return None  # probably a person who is not in the group: let the model handle it
    draft = validate_draft(ctx, text, rules_parse(ctx, text))
    return draft if draft["ready"] and not draft["removed_fields"] else None


def parse_expense(ctx: Ctx, text: str) -> dict:
    started = time.monotonic()
    text = clean_text(text)
    ctx.step(AGENT, "Reading your message")
    if get_settings().rules_first and (quick := simple_enough(ctx, text)):
        ctx.step(AGENT, "Double-checking the numbers")
        quick["source"] = "rules"
        log_run(ctx, AGENT, text, quick, "ok", started)
        return quick
    status, source = "ok", "ai"
    try:
        raw = llm_parse(ctx, text)
    except AgentFailure:
        ctx.model, source, status = "rules", "rules", "fallback"
        raw = rules_parse(ctx, text)
    ctx.step(AGENT, "Double-checking the numbers")
    draft = validate_draft(ctx, text, raw)
    if draft["removed_fields"] and source == "ai":
        # The model produced something untraceable. Trust the rules for those fields instead.
        fallback = validate_draft(ctx, text, rules_parse(ctx, text))
        if "amount" in draft["removed_fields"] and fallback["amount_paise"]:
            draft.update(amount_paise=fallback["amount_paise"], payers=fallback["payers"])
            draft["questions"] = [q for q in draft["questions"] if q["field"] not in ("amount", "payers")]
            draft["ready"] = not draft["questions"]
    draft["source"] = source
    if draft["questions"]:
        status = "question" if status == "ok" else status
    log_run(ctx, AGENT, text, draft, status, started)
    return draft
