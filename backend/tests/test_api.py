from datetime import date, timedelta

from tests.conftest import Api


def test_auth_flow(client):
    a = Api(client, "Asha")
    assert a.get("/auth/me").json()["email"] == "asha@example.com"
    assert client.post("/auth/signup", json={"name": "A", "email": "asha@example.com", "password": "password123"}).status_code == 409
    assert client.post("/auth/login", json={"email": "asha@example.com", "password": "wrong-password"}).status_code == 401
    assert client.get("/auth/me").status_code == 401
    # refresh rotates; the old token then kills the whole session family
    old = a.tokens["refresh_token"]
    new = client.post("/auth/refresh", json={"refresh_token": old}).json()
    assert client.post("/auth/refresh", json={"refresh_token": old}).status_code == 401
    assert client.post("/auth/refresh", json={"refresh_token": new["refresh_token"]}).status_code == 401
    # a refresh token can't be used as an access token
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {old}"}).status_code == 401


def test_other_users_get_404(client, sai, trip):
    g, _ = trip
    eve = Api(client, "Eve")
    for url in (f"/groups/{g['id']}", f"/groups/{g['id']}/expenses", f"/groups/{g['id']}/balances",
                f"/groups/{g['id']}/messages", f"/groups/{g['id']}/export.csv"):
        assert eve.get(url).status_code == 404
    assert eve.post(f"/groups/{g['id']}/expenses", json={"description": "x", "amount_paise": 100}).status_code == 404
    assert eve.get("/groups").json() == []


def test_expense_balances_settle(sai, trip):
    g, ids = trip
    gid = g["id"]
    r = sai.post(f"/groups/{gid}/expenses", json={"description": "Dinner", "amount_paise": 240000, "category": "food"})
    assert r.status_code == 201
    assert r.json()["shares"] == {ids["Sai"]: 80000, ids["Rahul"]: 80000, ids["Priya"]: 80000}
    b = sai.get(f"/groups/{gid}/balances").json()
    assert b["net"][ids["Sai"]] == 160000 and not b["all_settled"]
    by_from = {t["from_member"]: t for t in b["transfers"]}
    assert by_from[ids["Rahul"]]["upi_link"].startswith("upi://pay?pa=sai@okbank")
    # over-settling is refused; exact settle works
    bad = {"from_member": ids["Rahul"], "to_member": ids["Sai"], "amount_paise": 90000}
    assert sai.post(f"/groups/{gid}/settlements", json=bad).status_code == 422
    for who in ("Rahul", "Priya"):
        ok = {"from_member": ids[who], "to_member": ids["Sai"], "amount_paise": 80000, "method": "cash"}
        assert sai.post(f"/groups/{gid}/settlements", json=ok).status_code == 201
    assert sai.get(f"/groups/{gid}/balances").json()["all_settled"]
    kinds = [m["kind"] for m in sai.get(f"/groups/{gid}/messages").json()]
    assert kinds == ["split_card", "settle_card", "settle_card"]


def test_multiple_payers_itemised_edit_delete(sai, trip):
    g, ids = trip
    gid = g["id"]
    body = {"description": "Bill", "amount_paise": 110000, "split_type": "itemised",
            "payers": {ids["Sai"]: 60000, ids["Rahul"]: 50000},
            "items": [{"name": "Pizza", "amount_paise": 60000, "member_ids": [ids["Sai"], ids["Rahul"]]},
                      {"name": "Beer", "amount_paise": 40000, "member_ids": [ids["Sai"]]}]}
    e = sai.post(f"/groups/{gid}/expenses", json=body)
    assert e.status_code == 201 and e.json()["shares"] == {ids["Sai"]: 77000, ids["Rahul"]: 33000}
    body["payers"] = {ids["Sai"]: 1}
    assert sai.post(f"/groups/{gid}/expenses", json=body).status_code == 422
    assert sai.post(f"/groups/{gid}/expenses", json={"description": "x", "amount_paise": 100, "member_ids": ["nope"]}).status_code == 422
    eid = e.json()["id"]
    r = sai.put(f"/groups/{gid}/expenses/{eid}", json={"description": "Bill 2", "amount_paise": 90000, "split_type": "shares",
                                                         "weights": {ids["Sai"]: 2, ids["Priya"]: 1}})
    assert r.status_code == 200 and r.json()["shares"] == {ids["Sai"]: 60000, ids["Priya"]: 30000}
    assert sai.delete(f"/groups/{gid}/expenses/{eid}").status_code == 204
    assert sai.get(f"/groups/{gid}/balances").json()["all_settled"]
    assert sai.get(f"/groups/{gid}/messages").json() == []


def test_invite_join_and_claim(client, sai, trip):
    g, ids = trip
    token = sai.post(f"/groups/{g['id']}/invite").json()["token"]
    priya = Api(client, "Priya")
    assert [c["name"] for c in priya.get(f"/join/{token}/preview").json()["claimable"]] == ["Rahul", "Priya"]
    joined = priya.post(f"/join/{token}?claim_member_id={ids['Priya']}").json()
    me = next(m for m in joined["members"] if m["is_self"])
    assert me["id"] == ids["Priya"] and me["verified"] and len(joined["members"]) == 3
    assert priya.post(f"/join/{token}").json()["id"] == g["id"]  # joining twice is harmless
    assert priya.get("/join/bad-token/preview").status_code == 404


def test_tracking_reminders_recurring(sai, trip, client):
    g, ids = trip
    today = date.today()
    rent = sai.post("/responsibilities", json={"label": "Rent", "amount_paise": 900000, "due_date": str(today + timedelta(days=2))}).json()
    sai.post("/subscriptions", json={"label": "Netflix", "amount_paise": 64900, "renews_on": str(today + timedelta(days=1))})
    sai.post("/subscriptions", json={"label": "Gym", "amount_paise": 150000, "renews_on": str(today + timedelta(days=20))})
    msgs = [r["message"] for r in sai.get("/reminders").json()]
    assert msgs == ["Netflix renews tomorrow (₹649).", "Rent ₹9,000 due in 2 days."]
    assert len(sai.get("/reminders").json()) == 2  # idempotent
    paid = sai.post(f"/responsibilities/{rent['id']}/paid").json()
    assert paid["due_date"] > str(today + timedelta(days=25)) and len(sai.get("/reminders").json()) == 1
    assert Api(client, "Eve").post(f"/responsibilities/{rent['id']}/paid").status_code == 404

    from app.agents.monitor import run_recurring
    from app.db import SessionLocal
    r = sai.post(f"/groups/{g['id']}/recurring", json={"expense": {"description": "Wifi", "amount_paise": 90000, "category": "bills"},
                                                        "next_run": str(today)})
    assert r.status_code == 201
    with SessionLocal() as db:
        assert run_recurring(db) == 1 and run_recurring(db) == 0
    assert sai.get(f"/groups/{g['id']}/expenses").json()[0]["created_via"] == "recurring"
    s = sai.get("/me/summary").json()
    assert s["you_are_owed_paise"] == 60000 and s["month_by_category"] == {"bills": 30000}
    assert "Wifi" in sai.get(f"/groups/{g['id']}/export.csv").text


def test_delete_group_with_history(sai, trip):
    g, ids = trip
    gid = g["id"]
    sai.post(f"/groups/{gid}/expenses", json={"description": "Dinner", "amount_paise": 90000})
    assert sai.delete(f"/groups/{gid}").status_code == 409  # not settled yet
    for who in ("Rahul", "Priya"):
        sai.post(f"/groups/{gid}/settlements", json={"from_member": ids[who], "to_member": ids["Sai"], "amount_paise": 30000, "method": "cash"})
    sai.post(f"/groups/{gid}/recurring", json={"expense": {"description": "Wifi", "amount_paise": 300}, "next_run": "2030-01-01"})
    assert sai.delete(f"/groups/{gid}").status_code == 204
    assert sai.get(f"/groups/{gid}").status_code == 404


def test_delete_account(client, sai, trip):
    g, ids = trip
    gid = g["id"]
    sai.post(f"/groups/{gid}/expenses", json={"description": "Dinner", "amount_paise": 90000})
    solo = sai.post("/groups", json={"name": "Just me"}).json()["id"]
    sai.post(f"/groups/{solo}/expenses", json={"description": "Chai", "amount_paise": 2000})
    sai.post("/agent/draft", json={"text": "cab 450", "group_id": gid})
    priya = Api(client, "Priya")
    token = sai.post(f"/groups/{gid}/invite").json()["token"]
    priya.post(f"/join/{token}?claim_member_id={ids['Priya']}")

    assert sai.delete("/auth/me").status_code == 204
    assert sai.get("/auth/me").status_code == 401
    # the shared group survives for Priya, now owned by her, with Sai anonymised and the history intact
    g2 = priya.get(f"/groups/{gid}").json()
    assert "Former member" in [m["name"] for m in g2["members"]] and "Sai" not in [m["name"] for m in g2["members"]]
    assert len(priya.get(f"/groups/{gid}/expenses").json()) == 1
    assert priya.post(f"/groups/{gid}/invite").status_code == 200
    from app.db import SessionLocal
    from app.models import AgentRun, Group
    with SessionLocal() as db:
        assert db.get(Group, solo) is None  # nobody else used it
        assert db.query(AgentRun).filter(AgentRun.input.like("%cab 450%")).count() == 0


def test_password_reset(client, sai, monkeypatch):
    from app.config import get_settings
    from app.routers import auth as auth_router
    assert client.post("/auth/forgot", json={"email": "sai@example.com"}).status_code == 503  # email not set up
    sent = []
    monkeypatch.setattr(get_settings(), "brevo_api_key", "test")
    monkeypatch.setattr(get_settings(), "mail_from", "fin@example.com")
    monkeypatch.setattr(auth_router, "send_mail", lambda to, subject, text, html: sent.append((to, subject)) or True)
    # the same answer whether or not the account exists
    a = client.post("/auth/forgot", json={"email": "nobody@example.com"})
    b = client.post("/auth/forgot", json={"email": "sai@example.com"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json() and len(sent) == 1
    code = sent[0][1].split(": ")[1]
    old_refresh = sai.tokens["refresh_token"]
    wrong = "000000" if code != "000000" else "111111"
    assert client.post("/auth/reset", json={"email": "sai@example.com", "code": wrong, "password": "newpassword1"}).status_code == 400
    r = client.post("/auth/reset", json={"email": "sai@example.com", "code": code, "password": "newpassword1"})
    assert r.status_code == 200 and r.json()["access_token"]
    assert client.post("/auth/reset", json={"email": "sai@example.com", "code": code, "password": "again12345"}).status_code == 400  # one use
    assert client.post("/auth/login", json={"email": "sai@example.com", "password": "password123"}).status_code == 401
    assert client.post("/auth/login", json={"email": "sai@example.com", "password": "newpassword1"}).status_code == 200
    assert client.post("/auth/refresh", json={"refresh_token": old_refresh}).status_code == 401  # other phones signed out


def test_reset_code_attempts_are_limited(client, sai, monkeypatch):
    from app.config import get_settings
    from app.routers import auth as auth_router
    sent = []
    monkeypatch.setattr(get_settings(), "brevo_api_key", "test")
    monkeypatch.setattr(get_settings(), "mail_from", "fin@example.com")
    monkeypatch.setattr(auth_router, "send_mail", lambda to, subject, text, html: sent.append(subject) or True)
    client.post("/auth/forgot", json={"email": "sai@example.com"})
    code = sent[0].split(": ")[1]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        client.post("/auth/reset", json={"email": "sai@example.com", "code": wrong, "password": "newpassword1"})
    # after 5 wrong tries even the right code is refused
    assert client.post("/auth/reset", json={"email": "sai@example.com", "code": code, "password": "newpassword1"}).status_code == 400
