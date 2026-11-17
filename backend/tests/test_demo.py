from datetime import datetime, timedelta, timezone

import pytest

from app import security
from app.db import SessionLocal
from app.models import Group, User
from app.services import demo


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    security._hits.clear()
    yield
    security._hits.clear()


def _demo(client):
    r = client.post("/auth/demo")
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_demo_account_has_sample_data(client):
    h = _demo(client)
    me = client.get("/auth/me", headers=h).json()
    assert me["email"].endswith("@" + demo.DEMO_DOMAIN)
    groups = client.get("/groups", headers=h).json()
    assert {g["name"] for g in groups} == {"Goa Trip", "Flat 302"}
    trip = next(g for g in groups if g["name"] == "Goa Trip")
    expenses = client.get(f"/groups/{trip['id']}/expenses", headers=h).json()
    assert len(expenses) == 5
    balances = client.get(f"/groups/{trip['id']}/balances", headers=h).json()
    assert balances["all_settled"] is False
    # Sample friends have no UPI IDs, so no demo payment can go to a real account.
    assert all(not m.get("upi_id") for m in trip["members"] if not m["is_self"])
    # The demo works like a normal account: visitors can add their own expenses.
    r = client.post(f"/groups/{trip['id']}/expenses", headers=h, json={"description": "Ice cream", "amount_paise": 40000})
    assert r.status_code == 201


def test_demo_accounts_are_separate(client):
    a, b = _demo(client), _demo(client)
    a_group = client.get("/groups", headers=a).json()[0]["id"]
    assert client.get(f"/groups/{a_group}", headers=b).status_code == 404


def test_old_demo_accounts_are_deleted(client):
    h = _demo(client)
    me = client.get("/auth/me", headers=h).json()
    with SessionLocal() as db:
        db.get(User, me["id"]).created_at = datetime.now(timezone.utc) - timedelta(hours=demo.DEMO_HOURS + 1)
        db.commit()
    _demo(client)  # starting a new demo cleans up expired ones
    with SessionLocal() as db:
        assert db.get(User, me["id"]) is None
        assert db.query(Group).filter(Group.owner_id == me["id"]).count() == 0
    assert client.get("/auth/me", headers=h).status_code == 401


def test_demo_is_rate_limited(client):
    for _ in range(5):
        _demo(client)
    assert client.post("/auth/demo").status_code == 429
