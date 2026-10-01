from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import account, auth, health, incidents, monitors, public, settings
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import BodySizeLimitMiddleware, SecurityHeadersMiddleware
from app.core.ratelimit import RateLimitMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging("api")
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="API Monitor",
        version="1.0.0",
        lifespan=lifespan,
        description="API monitoring and incident detection platform.",
    )
    # Middleware order: last added runs first (outermost).
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
    )
    app.add_middleware(SecurityHeadersMiddleware)
    register_error_handlers(app)
    for module in (health, auth, account, monitors, incidents, settings, public):
        app.include_router(module.router)
    return app


app = create_app()
