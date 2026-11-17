"""The backup must round-trip: every row back, with the same types."""
import importlib.util
from pathlib import Path

from sqlalchemy import create_engine, select

from app.db import Base
from app.models import Expense, Group, User


def _load():
    spec = importlib.util.spec_from_file_location("backup", Path(__file__).resolve().parents[1] / "scripts" / "backup.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_backup_round_trip(client, sai, trip, tmp_path):
    g, ids = trip
    sai.post(f"/groups/{g['id']}/expenses", json={"description": "Dinner", "amount_paise": 240000, "category": "food", "note": "₹ & emoji 🍕"})
    sai.post(f"/groups/{g['id']}/goals", json={"name": "Goa fund", "target_paise": 1000000})
    sai.post("/subscriptions", json={"label": "Netflix", "amount_paise": 64900, "renews_on": "2030-01-05"})
    mod = _load()
    src = tmp_path / "src.db"
    dst = tmp_path / "dst.db"
    # copy the in-memory test database into a file, then back it up and restore it elsewhere
    from app.db import engine as mem
    file_engine = create_engine(f"sqlite:///{src}")
    Base.metadata.create_all(file_engine)
    path = None
    with mem.connect() as m, file_engine.begin() as f:
        for t in Base.metadata.sorted_tables:
            rows = [dict(r) for r in m.execute(select(t)).mappings()]
            if rows:
                f.execute(t.insert(), rows)
    path = mod.backup(f"sqlite:///{src}", tmp_path / "backups")
    assert path.exists() and path.stat().st_mode & 0o777 == 0o600
    Base.metadata.create_all(create_engine(f"sqlite:///{dst}"))
    counts = mod.restore(path, f"sqlite:///{dst}")
    assert counts["expenses"] == 1 and counts["goals"] == 1 and counts["subscriptions"] == 1 and counts["users"] == 1
    d = create_engine(f"sqlite:///{dst}")
    with d.connect() as c:
        e = c.execute(select(Expense)).mappings().one()
        assert e["note"] == "₹ & emoji 🍕" and e["amount_paise"] == 240000
        assert c.execute(select(Group.name)).scalar() == "Goa trip"
        assert c.execute(select(User.email)).scalar() == "sai@example.com"
    # restoring twice replaces rather than duplicates
    assert mod.restore(path, f"sqlite:///{dst}")["expenses"] == 1
    # only the newest 30 are kept
    for _ in range(31):
        mod.backup(f"sqlite:///{src}", tmp_path / "backups")
    assert len(list((tmp_path / "backups").glob("fin-*.json.gz"))) == 30
