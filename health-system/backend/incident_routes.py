"""Authenticated manual emergency signal from the signed-in crew member."""
from pathlib import Path

from fastapi import FastAPI, Request

from .incidents import publish_emergency
from .models import Contract, Identifier
from .store import Problem, connection


class EmergencyCommand(Contract):
    commandId: Identifier


def register_emergencies(app: FastAPI, path: Path) -> None:
    from .main import current, response

    @app.post("/v1/emergencies")
    def send(request: Request, data: EmergencyCommand):
        user = current(request, write=True)
        crew = user["crewId"]
        if not crew or "crew" not in user["roles"]:
            raise Problem(403, "FORBIDDEN", "Only a crew member can send a manual emergency signal.")
        with connection(path, write=True) as db:
            before = db.total_changes
            item = publish_emergency(db, crew, "manual", data.commandId)
            replayed = db.total_changes == before
        return response({"emergency": item}, 200 if replayed else 201, replayed=replayed)
