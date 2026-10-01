import redis
from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from app.core import metrics as _metrics  # noqa: F401  (registers metric families)
from app.core.config import get_settings
from app.core.database import engine
from app.core.errors import error_response

router = APIRouter(tags=["ops"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready():
    """Dependency check. Reports only up/down per dependency - never hostnames or errors."""
    checks = {"postgres": False, "redis": False}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["postgres"] = True
    except Exception:  # noqa: BLE001
        pass
    try:
        redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1).ping()
        checks["redis"] = True
    except Exception:  # noqa: BLE001
        pass
    if all(checks.values()):
        return {"status": "ready", "checks": checks}
    return error_response(503, "not_ready", "Dependency unavailable", checks)


@router.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
