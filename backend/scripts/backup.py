"""Back up the Fin database to a compressed file, and restore it.

    uv run python scripts/backup.py                    # back up production (FIN_PROD_DATABASE_URL in .env)
    uv run python scripts/backup.py --restore FILE --into URL --yes-replace-everything

Each backup is one .json.gz file: every table's rows plus the schema version. It works on Postgres and
SQLite, needs no extra tools, and keeps the newest 30 backups in ~/Fin-backups.
"""
import argparse
import gzip
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import Boolean, Date, DateTime, Float, create_engine, delete, insert, select, text  # noqa: E402

from app import models  # noqa: E402,F401  (registers every table)
from app.db import Base  # noqa: E402

BACKUP_DIR = Path(os.environ.get("FIN_BACKUP_DIR", Path.home() / "Fin-backups"))
KEEP = 30


def _engine(url: str):
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    kw = {"connect_args": {"prepare_threshold": None}} if url.startswith("postgresql") else {}
    return create_engine(url, **kw)


def _encode(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _decode(col, v):
    if v is None:
        return None
    if isinstance(col.type, DateTime):
        d = datetime.fromisoformat(v)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    if isinstance(col.type, Date):
        return date.fromisoformat(v)
    if isinstance(col.type, Boolean):
        return bool(v)
    if isinstance(col.type, Float):
        return float(v)
    return v


def backup(url: str, out_dir: Path = BACKUP_DIR) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    engine = _engine(url)
    data = {"made_at": datetime.now(timezone.utc).isoformat(), "tables": {}, "schema_version": None}
    with engine.connect() as c:
        try:
            data["schema_version"] = c.execute(text("SELECT version_num FROM alembic_version")).scalar()
        except Exception:
            c.rollback()
        for table in Base.metadata.sorted_tables:
            rows = c.execute(select(table)).mappings().all()
            data["tables"][table.name] = [{k: _encode(v) for k, v in r.items()} for r in rows]
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S-%f")
    path = out_dir / f"fin-{stamp}.json.gz"
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    tmp.rename(path)  # never leave a half-written backup behind
    os.chmod(path, 0o600)  # personal data: readable only by you
    for old in sorted(out_dir.glob("fin-*.json.gz"))[:-KEEP]:
        old.unlink()
    return path


def restore(path: Path, url: str) -> dict[str, int]:
    """Replaces everything in the target database with the backup. Tables must already exist (run migrations first)."""
    with gzip.open(path, "rt", encoding="utf-8") as f:
        data = json.load(f)
    engine = _engine(url)
    counts = {}
    with engine.begin() as c:
        for table in reversed(Base.metadata.sorted_tables):
            c.execute(delete(table))
        for table in Base.metadata.sorted_tables:
            rows = data["tables"].get(table.name, [])
            cols = {col.name: col for col in table.columns}
            clean = [{k: _decode(cols[k], v) for k, v in r.items() if k in cols} for r in rows]
            if clean:
                c.execute(insert(table), clean)
            counts[table.name] = len(clean)
    return counts


def _env(key: str) -> str:
    env = Path(__file__).resolve().parents[1] / ".env"
    for line in env.read_text().splitlines() if env.exists() else []:
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    return os.environ.get(key, "")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--restore", type=Path)
    ap.add_argument("--into")
    ap.add_argument("--yes-replace-everything", action="store_true")
    a = ap.parse_args()
    if a.restore:
        if not (a.into and a.yes_replace_everything):
            sys.exit("Restoring replaces ALL data in the target. Pass --into URL and --yes-replace-everything.")
        print(restore(a.restore, a.into))
    else:
        url = _env("FIN_PROD_DATABASE_URL")
        if not url:
            sys.exit("FIN_PROD_DATABASE_URL is not set in backend/.env")
        p = backup(url)
        print(f"{datetime.now():%Y-%m-%d %H:%M} backup saved: {p} ({p.stat().st_size // 1024} KB)")
