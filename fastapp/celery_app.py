import os
from celery import Celery
from dotenv import load_dotenv

load_dotenv(override=True)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "minerclaw",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["fastapp.tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_concurrency=16,
    worker_prefetch_multiplier=1,
    worker_pool="threads",
    task_time_limit=3600,
    task_soft_time_limit=3400,
    beat_schedule={
        "check-expired-instances-every-5-minutes": {
            "task": "fastapp.tasks.check_expired_instances_task",
            "schedule": 300.0,
        },
        "process-routines-every-minute": {
            "task": "fastapp.tasks.process_routines_task",
            "schedule": 60.0,
        },
        "reconcile-system-state-every-10-minutes": {
            "task": "fastapp.tasks.reconcile_system_state_task",
            "schedule": 600.0,
        },
    },
)
