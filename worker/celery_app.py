"""Celery application: broker config, logging, metrics and the beat schedule."""

import os

from celery import Celery
from celery.signals import setup_logging, worker_ready
from prometheus_client import start_http_server

from app.core.config import get_settings
from app.core.logging import configure_logging

settings = get_settings()

celery_app = Celery(
    "api_monitor",
    broker=settings.redis_url,
    include=[
        "worker.tasks.check",
        "worker.tasks.notify",
        "worker.scheduler.tasks",
    ],
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # Reliability: ack after the task finishes, so a worker crash re-delivers the job instead of losing it.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    # Keep trying to reach Redis rather than exiting; jobs wait in the queue meanwhile.
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=None,
    broker_transport_options={"visibility_timeout": 3600, "socket_timeout": 5, "socket_connect_timeout": 5},
    task_default_queue="checks",
    task_routes={"worker.tasks.notify.*": {"queue": "notifications"}},
    result_backend=None,
    task_ignore_result=True,
    beat_schedule={
        "enqueue-due-checks": {"task": "worker.scheduler.tasks.enqueue_due_checks", "schedule": 5.0},
        "sweep-pending-notifications": {"task": "worker.tasks.notify.sweep_pending_notifications", "schedule": 60.0},
        "purge-old-check-results": {"task": "worker.scheduler.tasks.purge_old_results", "schedule": 3600.0},
    },
)


@setup_logging.connect
def _configure_logging(**_: object) -> None:
    configure_logging("worker")


@worker_ready.connect
def _start_metrics_server(**_: object) -> None:
    # Threads pool => one process, so in-process Prometheus counters are accurate.
    port = int(os.environ.get("WORKER_METRICS_PORT", "9101"))
    if port:
        start_http_server(port)
