"""Owner-scoped task reads and commands, with separate aggregate-only team access."""
from datetime import date as CalendarDate
from pathlib import Path

from fastapi import FastAPI, Request

from .store import Problem, connection
from .tasks import (
    TaskAction,
    TaskStatus,
    clock,
    ensure_day,
    get_task,
    personal_tasks,
    task_command,
    team_tasks,
)


def register_tasks(app: FastAPI, path: Path) -> None:
    from .main import current, require_workspace, response

    def owner(request: Request, run: str | None, requested: str | None = None, *, write: bool = False) -> str:
        user = current(request, write=write)
        require_workspace(run)
        crew = user["crewId"]
        if not crew or (requested is not None and requested != crew):
            raise Problem(403, "FORBIDDEN", "Only the owner may access their individual tasks.")
        return crew

    @app.get("/v1/tasks")
    def tasks(request: Request, crewId: str | None = None, date: CalendarDate | None = None,
              status: TaskStatus | None = None, runId: str | None = None):
        crew = owner(request, runId, crewId)
        if date and date.toordinal() < 7:
            raise Problem(422, "VALIDATION_ERROR", "This date cannot represent a seven-day history.")
        with connection(path, write=True) as db:
            ensure_day(db, clock())
            result = personal_tasks(db, crew, date)
        if status:
            result["items"] = [task for task in result["items"] if task["status"] == status]
        return response(result)

    @app.get("/v1/tasks/team")
    def team(request: Request, runId: str | None = None):
        user = current(request)
        require_workspace(runId)
        if not set(user["roles"]).intersection({"monitor", "display"}):
            raise Problem(403, "FORBIDDEN", "This account does not have access to the team view.")
        now = clock()
        with connection(path, write=True) as db:
            ensure_day(db, now)
            return response(team_tasks(db, now.date()))

    @app.get("/v1/tasks/{task_id}")
    def detail(task_id: str, request: Request, runId: str | None = None):
        crew = owner(request, runId)
        with connection(path) as db:
            return response({"task": get_task(db, crew, task_id)})

    @app.post("/v1/tasks/{task_id}/actions")
    def change(task_id: str, request: Request, data: TaskAction, runId: str | None = None):
        crew = owner(request, runId, write=True)
        with connection(path, write=True) as db:
            result, replayed = task_command(db, crew, task_id, data)
        return response(result, replayed=replayed)
