"""Lock the tables away from Supabase's public data API.

Supabase serves every table in the public schema over a REST API that anyone holding the project's
public (anon) key can call. Fin's server is the only thing that should read these tables, so we turn on
row-level security with no policies (which denies the anon and authenticated roles) and revoke their
grants. The server connects as the database owner, which is not affected.

Revision ID: a1f3c9d2e7b4
Revises: 519c2854c08a
"""
from alembic import op

revision = "a1f3c9d2e7b4"
down_revision = "519c2854c08a"
branch_labels = None
depends_on = None

TABLES = ["users", "refresh_tokens", "groups", "members", "expenses", "expense_payers", "shares", "items",
          "settlements", "messages", "responsibilities", "subscriptions", "recurring_expenses", "reminders",
          "agent_drafts", "agent_runs", "alembic_version"]


def _has_role(bind, role: str) -> bool:
    return bind.exec_driver_sql("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).first() is not None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return  # SQLite (local and tests) has no public API to protect
    for t in TABLES:
        op.execute(f'ALTER TABLE "{t}" ENABLE ROW LEVEL SECURITY')
    for role in ("anon", "authenticated"):
        if _has_role(bind, role):
            op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role}")
            op.execute(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role}")
            # tables created by later migrations stay private too
            op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM {role}")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for t in TABLES:
        op.execute(f'ALTER TABLE "{t}" DISABLE ROW LEVEL SECURITY')
