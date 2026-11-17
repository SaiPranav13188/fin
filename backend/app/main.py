import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine, get_db
from .models import AgentRun
from .privacy import PRIVACY_HTML
from .routers import agents, auth, goals, groups, tracking

log = logging.getLogger("fin")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.is_prod:
        Base.metadata.create_all(engine)  # production uses Alembic migrations
    scheduler = None
    if settings.enable_scheduler:
        from apscheduler.schedulers.background import BackgroundScheduler

        from .agents.monitor import daily_job

        def job():
            with SessionLocal() as db:
                log.info("daily job: %s", daily_job(db))

        scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
        scheduler.add_job(job, "cron", hour=9, minute=0, id="daily", max_instances=1, coalesce=True)
        scheduler.start()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Fin API", version="1.0.0", lifespan=lifespan,
              docs_url=None if settings.is_prod else "/docs", redoc_url=None,
              openapi_url=None if settings.is_prod else "/openapi.json")

if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                       allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)


for r in (auth.router, groups.router, goals.router, tracking.router, agents.router):
    app.include_router(r)


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"ok": True}


@app.get("/privacy", response_class=HTMLResponse)
def privacy():
    return HTMLResponse(PRIVACY_HTML, headers={"Cache-Control": "public, max-age=3600"})


@app.get("/")
def root():
    return {"name": "Fin API", "ok": True}


def _internal(secret: str) -> None:
    import hmac
    if not settings.cron_secret or not hmac.compare_digest(secret, settings.cron_secret):
        raise HTTPException(404)


@app.post("/internal/daily")
def run_daily(x_cron_secret: str = Header(""), db: Session = Depends(get_db)):
    """Lets an external cron (Render cron job, GitHub Actions) trigger the daily monitor."""
    _internal(x_cron_secret)
    from .agents.monitor import daily_job
    return daily_job(db)


@app.get("/internal/agent-stats")
def agent_stats(x_cron_secret: str = Header(""), db: Session = Depends(get_db)):
    """Accuracy/latency/cost view over agent_runs for the dashboard."""
    _internal(x_cron_secret)
    rows = db.execute(select(AgentRun.agent, AgentRun.status, func.count(), func.avg(AgentRun.latency_ms),
                             func.sum(AgentRun.tokens)).group_by(AgentRun.agent, AgentRun.status)).all()
    return [{"agent": a, "status": s, "runs": n, "avg_latency_ms": round(lat or 0), "tokens": tok or 0}
            for a, s, n, lat, tok in rows]
