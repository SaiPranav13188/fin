import os

os.environ["FIN_ENV"] = "test"
# CI also runs the suite on Postgres by setting TEST_DATABASE_URL.
os.environ["FIN_DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite:///:memory:")
os.environ["FIN_GEMINI_API_KEY"] = ""  # tests never call the real model
os.environ["FIN_RATE_LOGIN_PER_MINUTE"] = "100000"
os.environ["FIN_RATE_AGENT_PER_MINUTE"] = "100000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c


class Api:
    """A signed-in user."""

    def __init__(self, client, name, email=None):
        self.c = client
        email = email or f"{name.lower()}@example.com"
        r = client.post("/auth/signup", json={"name": name, "email": email, "password": "password123",
                                              "upi_id": f"{name.lower()}@okbank"})
        assert r.status_code == 201, r.text
        self.tokens = r.json()
        self.h = {"Authorization": f"Bearer {self.tokens['access_token']}"}

    def get(self, url, **kw):
        return self.c.get(url, headers=self.h, **kw)

    def post(self, url, json=None, **kw):
        return self.c.post(url, headers=self.h, json=json, **kw)

    def put(self, url, json=None):
        return self.c.put(url, headers=self.h, json=json)

    def delete(self, url):
        return self.c.delete(url, headers=self.h)


@pytest.fixture()
def sai(client):
    return Api(client, "Sai")


@pytest.fixture()
def trip(sai):
    """A group with Sai (self), Rahul and Priya. Returns (group, ids-by-name)."""
    g = sai.post("/groups", json={"name": "Goa trip", "emoji": "🏖️", "members": [
        {"name": "Rahul", "upi_id": "rahul@okaxis"}, {"name": "Priya"}]}).json()
    return g, {m["name"]: m["id"] for m in g["members"]}
