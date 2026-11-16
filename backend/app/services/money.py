"""Paise-exact split maths, balances, debt simplification and UPI links. Pure functions."""
import re
from urllib.parse import quote


class SplitError(ValueError):
    pass


def allocate(total: int, weights: list[int]) -> list[int]:
    """Split `total` paise in proportion to `weights` using the largest-remainder method."""
    wsum = sum(weights)
    if total < 0 or wsum <= 0 or any(w < 0 for w in weights):
        raise SplitError("Weights must be positive")
    base = [total * w // wsum for w in weights]
    left = total - sum(base)
    order = sorted(range(len(weights)), key=lambda i: (-(total * weights[i] % wsum), i))
    for i in order[:left]:
        base[i] += 1
    return base


def compute_shares(split_type: str, total: int, members: list[str], *, exact: dict[str, int] | None = None,
                   weights: dict[str, int] | None = None, percents: dict[str, float] | None = None,
                   items: list[dict] | None = None) -> dict[str, int]:
    """Returns {member_id: paise}; always sums to `total`."""
    if total <= 0:
        raise SplitError("Amount must be more than zero")
    if split_type == "equal":
        if not members:
            raise SplitError("Pick at least one person")
        return dict(zip(members, allocate(total, [1] * len(members))))
    if split_type == "exact":
        exact = {k: v for k, v in (exact or {}).items() if v}
        if any(v < 0 for v in exact.values()):
            raise SplitError("Amounts can't be negative")
        if sum(exact.values()) != total:
            raise SplitError(f"Amounts add up to ₹{sum(exact.values()) / 100:.2f}, not ₹{total / 100:.2f}")
        return exact
    if split_type == "shares":
        weights = {k: v for k, v in (weights or {}).items() if v > 0}
        if not weights:
            raise SplitError("Give at least one person a share")
        ids = list(weights)
        return dict(zip(ids, allocate(total, [weights[i] for i in ids])))
    if split_type == "percent":
        percents = {k: v for k, v in (percents or {}).items() if v > 0}
        if abs(sum(percents.values()) - 100) > 0.01:
            raise SplitError(f"Percentages add up to {sum(percents.values()):g}%, not 100%")
        ids = list(percents)
        return dict(zip(ids, allocate(total, [round(percents[i] * 100) for i in ids])))
    if split_type == "itemised":
        if not items:
            raise SplitError("Add at least one item")
        out: dict[str, int] = {}
        item_sum = 0
        for it in items:
            who = it.get("member_ids") or []
            if it["amount_paise"] <= 0 or not who:
                raise SplitError(f"“{it.get('name', 'Item')}” needs a price and at least one person")
            item_sum += it["amount_paise"]
            for m, a in zip(who, allocate(it["amount_paise"], [1] * len(who))):
                out[m] = out.get(m, 0) + a
        extra = total - item_sum  # tax, tip, discount: spread in proportion to what each person ate
        if extra < 0 and -extra > item_sum:
            raise SplitError("Total is less than the items")
        if extra:
            ids = list(out)
            adj = allocate(abs(extra), [out[i] for i in ids])
            for i, a in zip(ids, adj):
                out[i] += a if extra > 0 else -a
        return out
    raise SplitError("Unknown split type")


def net_balances(member_ids: list[str], expenses: list[dict], settlements: list[dict]) -> dict[str, int]:
    """Positive = is owed money, negative = owes money. Sums to zero."""
    net = dict.fromkeys(member_ids, 0)
    for e in expenses:
        for m, a in e["payers"].items():
            net[m] = net.get(m, 0) + a
        for m, a in e["shares"].items():
            net[m] = net.get(m, 0) - a
    for s in settlements:
        net[s["from"]] = net.get(s["from"], 0) + s["amount"]
        net[s["to"]] = net.get(s["to"], 0) - s["amount"]
    return net


def simplify(net: dict[str, int]) -> list[dict]:
    """Greedy largest-debtor-pays-largest-creditor. At most n-1 transfers."""
    debt = sorted(([m, -a] for m, a in net.items() if a < 0), key=lambda x: (-x[1], x[0]))
    cred = sorted(([m, a] for m, a in net.items() if a > 0), key=lambda x: (-x[1], x[0]))
    out, i, j = [], 0, 0
    while i < len(debt) and j < len(cred):
        pay = min(debt[i][1], cred[j][1])
        out.append({"from": debt[i][0], "to": cred[j][0], "amount_paise": pay})
        debt[i][1] -= pay
        cred[j][1] -= pay
        if debt[i][1] == 0:
            i += 1
        if cred[j][1] == 0:
            j += 1
    return out


UPI_RE = re.compile(r"^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$")


def valid_upi(upi_id: str | None) -> bool:
    return bool(upi_id and UPI_RE.match(upi_id.strip()))


def upi_link(upi_id: str, name: str, amount_paise: int, note: str) -> str:
    """Standard upi://pay deep link. Fin never moves money; the user's UPI app does."""
    note = re.sub(r"[^A-Za-z0-9 ]", "", note)[:40].strip() or "Fin"
    return (f"upi://pay?pa={quote(upi_id.strip(), safe='@.-_')}&pn={quote(name[:40])}"
            f"&am={amount_paise / 100:.2f}&cu=INR&tn={quote(note)}")


def rupees(paise: int) -> str:
    r, p = divmod(abs(paise), 100)
    s = str(r)
    if len(s) > 3:  # Indian grouping: 1,23,456
        head, tail = s[:-3], s[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        s = f"{head},{tail}"
    return ("-" if paise < 0 else "") + "₹" + s + (f".{p:02d}" if p else "")
