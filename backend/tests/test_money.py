import random

import pytest

from app.services.money import SplitError, allocate, compute_shares, net_balances, rupees, simplify, upi_link, valid_upi


def test_allocate_never_loses_a_paisa():
    assert allocate(100, [1, 1, 1]) == [34, 33, 33]
    rnd = random.Random(7)
    for _ in range(300):
        total = rnd.randint(1, 10**7)
        w = [rnd.randint(1, 50) for _ in range(rnd.randint(1, 9))]
        parts = allocate(total, w)
        assert sum(parts) == total and min(parts) >= 0


def test_split_types():
    assert compute_shares("equal", 1000, ["a", "b", "c"]) == {"a": 334, "b": 333, "c": 333}
    assert compute_shares("exact", 1000, [], exact={"a": 700, "b": 300}) == {"a": 700, "b": 300}
    assert compute_shares("shares", 900, [], weights={"a": 2, "b": 1}) == {"a": 600, "b": 300}
    assert compute_shares("percent", 1000, [], percents={"a": 33.33, "b": 66.67}) == {"a": 333, "b": 667}
    with pytest.raises(SplitError):
        compute_shares("exact", 1000, [], exact={"a": 700})
    with pytest.raises(SplitError):
        compute_shares("percent", 1000, [], percents={"a": 50})


def test_itemised_spreads_tax_and_tip():
    items = [{"name": "Pizza", "amount_paise": 60000, "member_ids": ["a", "b"]},
             {"name": "Beer", "amount_paise": 40000, "member_ids": ["a"]}]
    shares = compute_shares("itemised", 110000, [], items=items)  # ₹100 tax+tip on ₹1000
    assert shares == {"a": 77000, "b": 33000}
    assert sum(compute_shares("itemised", 95000, [], items=items).values()) == 95000  # discount


def test_balances_and_simplify():
    net = net_balances(["a", "b", "c"], [{"payers": {"a": 900}, "shares": {"a": 300, "b": 300, "c": 300}}], [])
    assert net == {"a": 600, "b": -300, "c": -300} and sum(net.values()) == 0
    transfers = simplify(net)
    assert len(transfers) == 2 and all(t["to"] == "a" for t in transfers)
    rnd = random.Random(3)
    for _ in range(200):
        vals = [rnd.randint(-5000, 5000) for _ in range(rnd.randint(2, 8))]
        vals[-1] -= sum(vals)
        net = {str(i): v for i, v in enumerate(vals)}
        ts = simplify(net)
        assert len(ts) <= len(net) - 1 or not any(vals)
        for t in ts:
            net[t["from"]] += t["amount_paise"]
            net[t["to"]] -= t["amount_paise"]
        assert not any(net.values())


def test_upi():
    assert valid_upi("rahul@okaxis") and not valid_upi("rahul") and not valid_upi("a b@ok")
    link = upi_link("rahul@okaxis", "Rahul K", 80050, "Fin: Goa trip!")
    assert link == "upi://pay?pa=rahul@okaxis&pn=Rahul%20K&am=800.50&cu=INR&tn=Fin%20Goa%20trip"
    assert rupees(12345678) == "₹1,23,456.78" and rupees(80000) == "₹800" and rupees(-500) == "-₹5"
