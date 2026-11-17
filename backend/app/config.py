"""Settings come from environment variables (or backend/.env locally). Never commit secrets."""
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="FIN_", extra="ignore")

    env: str = "dev"  # dev | test | prod
    database_url: str = "sqlite:///./fin.db"
    jwt_secret: str = "dev-only-secret-change-me-dev-only-secret"
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    cors_origins: str = ""  # comma-separated; the mobile app does not need CORS
    redis_url: str = ""  # optional; in-memory rate limits when empty
    public_base_url: str = "http://localhost:8000"  # used for invite links

    # Agents. With no key, every agent uses its rule-based fallback.
    gemini_api_key: str = ""
    fast_model: str = "gemini-3.5-flash-lite"  # parsing, routing, nudges, insights
    smart_model: str = "gemini-3.8-flash"  # receipt photos
    rules_first: bool = True  # simple sentences skip the model: instant, and saves free-tier quota
    agent_max_steps: int = 5
    agent_max_output_tokens: int = 4000
    agent_token_budget: int = 30000  # input + output tokens per request
    agent_timeout_seconds: float = 20.0
    agent_max_retries: int = 2

    # Limits
    upi_max_paise: int = 100_000_00  # ₹1,00,000 per UPI transaction
    max_expense_paise: int = 1_00_00_000_00  # ₹1 crore sanity cap
    rate_login_per_minute: int = 8
    rate_agent_per_minute: int = 20
    max_receipt_bytes: int = 6_000_000

    enable_scheduler: bool = False
    brevo_api_key: str = ""  # email for password reset; empty = reset is switched off
    mail_from: str = ""
    mail_from_name: str = "Fin"
    cron_secret: str = ""  # shared secret for /internal/* (empty = those routes are off)
    sentry_dsn: str = ""

    @field_validator("database_url")
    @classmethod
    def _normalise_db_url(cls, v: str) -> str:
        # Supabase / Render hand out postgres:// URLs; SQLAlchemy wants the driver named.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_prod and (s.jwt_secret.startswith("dev-only") or len(s.jwt_secret) < 32):
        raise RuntimeError("FIN_JWT_SECRET must be set to a long random value in production")
    return s
