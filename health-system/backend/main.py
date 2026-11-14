"""Local training API. Serve with uvicorn backend.main:app (one worker)."""
import asyncio
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from . import cloud_chat
from .assistant import initialize_chat, register_assistant
from .catalog import CATALOG
from .credentials import mock_token
from .knowledge import initialize_knowledge, register_knowledge
from .models import Login, ManualBatch, MetricCode, Telemetry, View, utc_text
from .news2 import register_news2
from .news2 import summaries as assessment_summaries
from .push import push_worker, register_push
from .store import (
    CREW,
    WORKSPACE,
    Data,
    Problem,
    accept,
    check_cursor_window,
    connection,
    cursor_position,
    cursor_token,
    digest,
    encoded,
    event_head,
    initialize,
    now_text,
    project_measurement,
    project_summary,
    upkeep,
)
from .trends import register_trends

SESSION = "health_session"
HOURS_12 = 12 * 60 * 60
BODY_LIMIT = 256 * 1024
ACCOUNT_ROLES = {
    **{name: ["crew"] for name in CREW},
    "monitor": ["monitor"],
    "display": ["display"],
}


def response(data: Data, status: int = 200, *, replayed: bool = False) -> JSONResponse:
    return JSONResponse({"requestId": str(uuid4()), "serverTime": now_text(),
                         "data": data, "meta": {"replayed": replayed}}, status,
                        headers={"Cache-Control": "no-store"})


def failure(status: int, code: str, message: str, fields: list | None = None, **details) -> JSONResponse:
    return JSONResponse({"requestId": str(uuid4()), "serverTime": now_text(),
                         "error": {"code": code, "message": message, "retryable": status == 503,
                                   "fields": fields or [], **details}}, status, headers={"Cache-Control": "no-store"})


class PacketLimit:
    """Count actual body bytes, including requests sent without Content-Length."""
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] not in ("/v1/telemetry", "/v1/manual-measurements"):
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > BODY_LIMIT:
                await failure(413, "PAYLOAD_TOO_LARGE", "Packets may contain up to 256 KiB.")(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body"):
                break

        async def buffered_receive():
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, buffered_receive, send)


def session_user(db: sqlite3.Connection, token: str | None) -> Data:
    row = db.execute("SELECT username,csrf FROM sessions WHERE token_hash=? AND expires>?",
                     (digest(token or ""), time.time())).fetchone()
    if not row:
        raise Problem(401, "AUTH_REQUIRED", "Sign in to continue.")
    name = row["username"]
    crew = name if name in CREW else None
    if name not in ACCOUNT_ROLES:
        raise Problem(401, "AUTH_REQUIRED", "This account is no longer available.")
    return {"username": name, "crewId": crew, "roles": ACCOUNT_ROLES[name], "csrfToken": row["csrf"],
            "scopeVersion": 1, "mode": "training"}


def current(request: Request, *, write: bool = False) -> Data:
    with connection(request.app.state.db_path) as db:
        user = session_user(db, request.cookies.get(SESSION))
    if write and not hmac.compare_digest(user["csrfToken"].encode(), request.headers.get("x-csrf-token", "").encode()):
        raise Problem(403, "FORBIDDEN", "A valid CSRF token is required.")
    return user


def require_workspace(run_id: str | None) -> None:
    if run_id is not None:
        raise Problem(404, "RUN_NOT_FOUND", "Training run is unavailable.")


def view_scope(request: Request, view: str, run_id: str | None) -> tuple[Data, list]:
    user = current(request)
    allowed = {"personal": {"crew"}, "system": {"monitor"}, "system_display": {"monitor", "display"}}
    if not allowed[view].intersection(user["roles"]):
        raise Problem(403, "FORBIDDEN", "This account cannot access the requested view.")
    require_workspace(run_id)
    return user, [WORKSPACE, "events", view, user["username"], user["roles"], user["scopeVersion"]]


def public_events(db: sqlite3.Connection, position: int, head: int, view: str, user: Data):
    check_cursor_window(db, position)
    args: list = [position, head]
    if view == "system_display":
        visible = "kind IN ('crew_summary.updated','emergency.created','team_tasks.updated')"
    else:
        health = "kind IN ('crew_summary.updated','measurement.accepted','measurement.corrected','alert.updated','news2.updated')"
        if view == "personal":
            health = f"({health} OR kind='task.updated') AND crew_id=?"
            args.append(user["crewId"])
        else:
            health += " OR kind='team_tasks.updated'"
        visible = f"({health}) OR kind='emergency.created'"
    rows = db.execute(f"""SELECT seq,kind,document FROM changes WHERE seq>? AND seq<=? AND ({visible})
                          ORDER BY seq LIMIT 100""", args).fetchall()
    result = []
    for row in rows:
        payload = {**json.loads(row["document"]), "schemaVersion": "1.3"}
        if row["kind"] == "crew_summary.updated":
            payload["payload"] = project_summary(payload["payload"], view)
        elif row["kind"] in ("measurement.accepted", "measurement.corrected"):
            payload["payload"] = project_measurement(payload["payload"], view)
        if view == "system_display":
            payload.pop("causationId", None)
        result.append((row["seq"], row["kind"], payload))
    return result


def configured_path() -> Path:
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share")))
    return Path(os.environ.get("HEALTH_DB_PATH", str(local / "NasaHealthSystem" / "training.sqlite3")))


def create_app(db_path: Path | str | None = None) -> FastAPI:
    path = Path(db_path) if db_path is not None else configured_path()

    async def expire():
        while True:
            await asyncio.sleep(0.5)
            try:
                await run_in_threadpool(upkeep, path)
            except sqlite3.OperationalError:
                # A temporary busy database is retried on the next pass.
                continue

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.secret = await run_in_threadpool(initialize, path)
        await run_in_threadpool(initialize_knowledge, path)
        await run_in_threadpool(initialize_chat, path)
        await run_in_threadpool(upkeep, path)
        timer = asyncio.create_task(expire())
        push = asyncio.create_task(push_worker(path))
        try:
            yield
        finally:
            timer.cancel()
            push.cancel()
            with suppress(asyncio.CancelledError):
                await push
            with suppress(asyncio.CancelledError):
                await timer
            for job in list(application.state.chat_jobs):
                job.cancel()
            await asyncio.gather(*application.state.chat_jobs, return_exceptions=True)

    app = FastAPI(title="Crew Health Training", version="1.3", lifespan=lifespan)
    app.state.db_path = path
    app.state.chat_jobs = set()
    app.add_middleware(PacketLimit)

    @app.exception_handler(Problem)
    async def problem(request: Request, exc: Problem):
        details: Data = {}
        if exc.resource_ref is not None:
            details["resourceRef"] = exc.resource_ref
        if exc.current_version is not None:
            details["currentVersion"] = exc.current_version
        return failure(exc.status, exc.code, exc.message, **details)

    @app.exception_handler(RequestValidationError)
    async def invalid(request: Request, exc: RequestValidationError):
        fields = [{"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()]
        if any(e["type"] == "too_long" and tuple(e["loc"]) == ("body", "metrics") for e in exc.errors()):
            return failure(413, "PAYLOAD_TOO_LARGE", "Packets may contain up to 100 metric entries.", fields)
        malformed = any(e["type"] == "json_invalid" for e in exc.errors())
        return failure(400 if malformed else 422, "INVALID_JSON" if malformed else "VALIDATION_ERROR",
                       "Check the request fields.", fields)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return failure(exc.status_code, "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR", str(exc.detail))

    @app.exception_handler(sqlite3.Error)
    async def database_error(request: Request, exc: sqlite3.Error):
        return failure(503, "DATABASE_UNAVAILABLE", "The local database is temporarily unavailable.")

    @app.get("/v1/health/live")
    def live():
        return response({"status": "live"})

    @app.get("/v1/health/ready")
    def ready():
        with connection(path) as db:
            db.execute("SELECT value FROM settings WHERE key='cursor_secret'").fetchone()
        return response({"status": "ready", "mode": "training", "database": "ready", "catalogCount": len(CATALOG),
                         "serviceStatus": service_status()})

    @app.post("/v1/session")
    @app.post("/v1/auth/login")
    def login(request: Request, data: Login):
        password = os.environ.get("HEALTH_DEMO_PASSWORD", "orbital-demo")
        if not hmac.compare_digest(data.password.encode(), password.encode()) or data.username not in ACCOUNT_ROLES:
            raise Problem(401, "AUTH_REQUIRED", "Invalid username or password.")
        token = secrets.token_urlsafe(32)
        with connection(path, write=True) as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(request.cookies.get(SESSION, "")),))
            db.execute("INSERT INTO sessions VALUES(?,?,?,?)",
                       (digest(token), data.username, secrets.token_urlsafe(24), time.time() + HOURS_12))
            user = session_user(db, token)
        result = response(user)
        result.set_cookie(SESSION, token, httponly=True, samesite="strict", secure=request.url.scheme == "https",
                          max_age=HOURS_12, path="/")
        return result

    @app.get("/v1/session")
    @app.get("/v1/auth/me")
    def me(request: Request):
        return response(current(request))

    @app.delete("/v1/session")
    @app.post("/v1/auth/logout")
    def logout(request: Request):
        current(request, write=True)
        with connection(path, write=True) as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(request.cookies[SESSION]),))
        result = response({"loggedOut": True})
        result.delete_cookie(SESSION, path="/")
        return result

    @app.get("/v1/catalog/metrics")
    @app.get("/v1/catalog")
    def catalog(request: Request):
        current(request)
        return response({"items": CATALOG})

    @app.post("/v1/manual-measurements")
    def manual(request: Request, data: ManualBatch):
        user = current(request, write=True)
        if user["crewId"] != data.crewId:
            raise Problem(403, "FORBIDDEN", "Crew may record measurements only for themselves.")
        require_workspace(data.runId)
        result, replayed = accept(path, data, user["username"], data.crewId)
        return response(result, 200 if replayed else 201, replayed=replayed)

    @app.post("/v1/telemetry")
    def telemetry(request: Request, data: Telemetry):
        bearer = request.headers.get("authorization", "")
        scheme, _, token = bearer.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise Problem(401, "AUTH_REQUIRED", "A registered device credential is required.")
        owner = next((crew for crew in CREW if hmac.compare_digest(mock_token(crew).encode(), token.encode())), None)
        if owner is None:
            raise Problem(401, "AUTH_REQUIRED", "Invalid device credential.")
        if data.deviceId != "mock-" + owner or data.assignmentId != "assignment-" + owner:
            raise Problem(403, "FORBIDDEN", "The credential does not cover this device and assignment.")
        require_workspace(data.runId)
        result, replayed = accept(path, data, data.deviceId, owner)
        return response(result, 200 if replayed else 201, replayed=replayed)

    from .body_scan import register_body_scans
    from .incident_routes import register_emergencies
    from .task_routes import register_tasks

    register_emergencies(app, path)
    register_push(app, path)
    register_trends(app, path)
    register_news2(app, path)
    register_body_scans(app, path)
    register_tasks(app, path)
    register_reads(app, path)
    register_knowledge(app, path)
    register_assistant(app, path)
    register_stream(app, path)
    register_web(app)
    return app


def service_status() -> Data:
    return {"backend": "ready", "knowledge": "ready",
            "model": "configured" if cloud_chat.api_key() else "unavailable"}


def register_reads(app: FastAPI, path: Path) -> None:
    from .alerts import list_alerts
    from .incidents import list_emergencies
    from .tasks import clock, ensure_day, personal_tasks, team_tasks

    @app.get("/v1/snapshot")
    def snapshot(request: Request, view: View, runId: str | None = None):
        user, scope = view_scope(request, view, runId)
        with connection(path, write=True) as db:
            now = clock()
            ensure_day(db, now)
            task_data: Data = {"tasks": []}
            if view != "system_display":
                task_data["news2Assessments"] = assessment_summaries(db, user["crewId"])
            if view == "personal":
                task_data["tasks"] = personal_tasks(db, user["crewId"], now.date())["items"]
            else:
                task_data["teamTaskSummary"] = team_tasks(db, now.date())
            query = "SELECT s.document,s.version FROM crew c JOIN summaries s ON s.crew_id=c.id"
            params: tuple = ()
            if user["crewId"]:
                query += " WHERE c.id=?"
                params = (user["crewId"],)
            summaries = []
            for row in db.execute(query + " ORDER BY c.rowid", params):
                doc = {**json.loads(row["document"]), "version": row["version"]}
                summaries.append(project_summary(doc, view))
            emergencies = list_emergencies(db)
            alerts = [] if view == "system_display" else [
                a for state in ("active", "unknown")
                for a in list_alerts(db, user["crewId"], state)
            ]
            cursor = cursor_token(app.state.secret, scope, event_head(db))
        data = {"schemaVersion": "1.3", "runId": None, "mode": "training", "run": None,
                "scopeVersion": 1, "view": view, "cursor": cursor, "crewSummaries": summaries,
                "currentMeasurements": [dict(crewId=c["crewId"], **m) for c in summaries for m in c["metricCards"]],
                "alerts": alerts, "emergencies": emergencies,
                **task_data, "devices": [], "environment": [],
                "serviceStatus": service_status()}
        return response(data)

    @app.get("/v1/alerts")
    def alerts(request: Request, runId: str | None = None, subjectId: str | None = None,
               conditionState: str | None = None):
        user = current(request)
        require_workspace(runId)
        if "display" in user["roles"] or (user["crewId"] and subjectId and user["crewId"] != subjectId):
            raise Problem(403, "FORBIDDEN", "This account cannot access those alerts.")
        if conditionState is not None and conditionState not in ("active", "unknown", "cleared", "invalidated"):
            raise Problem(422, "VALIDATION_ERROR", "Unknown alert condition.")
        with connection(path) as db:
            return response({"items": list_alerts(db, user["crewId"] or subjectId, conditionState)})

    @app.get("/v1/measurements")
    def measurements(request: Request, crewId: str | None = None, subjectId: str | None = None,
                     metricCode: MetricCode | None = None, runId: str | None = None,
                     after: Annotated[datetime | None, Query(alias="from")] = None,
                     before: Annotated[datetime | None, Query(alias="to")] = None, cursor: str | None = None,
                     limit: Annotated[int, Query(ge=1, le=500)] = 100):
        user = current(request)
        if "display" in user["roles"]:
            raise Problem(403, "FORBIDDEN", "This account has access to summary views only.")
        if crewId and subjectId and crewId != subjectId:
            raise Problem(422, "VALIDATION_ERROR", "crewId and subjectId must identify the same crew member.")
        crew = crewId or subjectId or user["crewId"]
        if user["crewId"] and crew != user["crewId"]:
            raise Problem(403, "FORBIDDEN", "Crew may read only their own measurements.")
        require_workspace(runId)
        times = [item for item in (after, before) if item]
        if any(t.tzinfo is None for t in times) or (after and before and after > before):
            raise Problem(422, "VALIDATION_ERROR", "Use a valid timezone-aware date range.")
        scope = [WORKSPACE, "history", user["username"], crew, metricCode, *[str(v) for v in (after, before)]]
        clauses, values = ["1=1"], []
        for condition, value in (("crew_id=?", crew), ("metric=?", metricCode),
                                 ("observed>=?", utc_text(after) if after else None),
                                 ("observed<=?", utc_text(before) if before else None)):
            if value is not None:
                clauses.append(condition)
                values.append(value)
        if cursor:
            at, seq = cursor_position(app.state.secret, scope, cursor)
            clauses.append("(observed,row_id)<(?,?)")
            values.extend([at, seq])
        sql = "SELECT document,observed,row_id FROM measurements WHERE " + " AND ".join(clauses)
        with connection(path) as db:
            rows = db.execute(sql + " ORDER BY observed DESC,row_id DESC LIMIT ?", [*values, limit + 1]).fetchall()
        next_page = None
        if len(rows) > limit:
            tail = rows[limit - 1]
            next_page = cursor_token(app.state.secret, scope, [tail["observed"], tail["row_id"]])
        view = "personal" if user["crewId"] else "system"
        return response({"items": [project_measurement(json.loads(r["document"]), view) for r in rows[:limit]],
                         "nextCursor": next_page})

    @app.get("/v1/crew")
    @app.get("/v1/crew/{crew_id}")
    def crew_details(request: Request, crew_id: str | None = None, runId: str | None = None):
        user = current(request)
        if user["roles"] == ["display"] and crew_id:
            raise Problem(403, "FORBIDDEN", "Detailed crew records require monitoring privileges.")
        if crew_id and user["crewId"] and crew_id != user["crewId"]:
            raise Problem(404, "NOT_FOUND", "Crew member is unavailable.")
        require_workspace(runId)
        target = crew_id or user["crewId"]
        with connection(path) as db:
            rows = db.execute("SELECT id,name FROM crew WHERE (? IS NULL OR id=?) ORDER BY rowid",
                              (target, target)).fetchall()
        items = [{"crewId": row["id"], "name": row["name"], "canReadDetails": user["roles"] != ["display"]}
                 for row in rows]
        if crew_id and not items:
            raise Problem(404, "NOT_FOUND", "Crew member is unavailable.")
        return response(items[0] if crew_id else {"items": items})


def register_stream(app: FastAPI, path: Path) -> None:
    @app.get("/v1/events/stream")
    async def stream(request: Request, view: View, cursor: str | None = None, runId: str | None = None):
        user, scope = await run_in_threadpool(view_scope, request, view, runId)
        token = request.headers.get("last-event-id") or cursor
        if not token:
            raise Problem(409, "SNAPSHOT_REQUIRED", "Take a snapshot before subscribing.")
        start = cursor_position(app.state.secret, scope, token)
        with connection(path) as db:
            check_cursor_window(db, start)
            initial_head = event_head(db)

        def frame(number: int, name: str, data: Data) -> str:
            ident = cursor_token(app.state.secret, scope, number)
            return f"id: {ident}\nevent: {name}\ndata: {encoded(data)}\n\n"

        def poll(position: int, replay: bool):
            with connection(path) as db:
                authorized = session_user(db, request.cookies.get(SESSION))
                if authorized["roles"] != user["roles"] or authorized["username"] != user["username"]:
                    raise Problem(409, "SCOPE_CHANGED", "Take a new authorized snapshot.")
                head = initial_head if replay else event_head(db)
                return head, public_events(db, position, head, view, authorized)

        async def frames():
            position = start
            replay = True
            last_output = time.monotonic()
            while True:
                try:
                    head, batch = await run_in_threadpool(poll, position, replay)
                except Problem as exc:
                    yield f"event: stream.reset_required\ndata: {encoded({'code': exc.code})}\n\n"
                    return
                for number, kind, document in batch:
                    yield frame(number, kind, document)
                    position = number
                    last_output = time.monotonic()
                if len(batch) >= 100:
                    continue
                position = head  # Unauthorized events may create gaps in a user's stream.
                if replay:
                    replay = False
                    yield frame(position, "stream.ready", {"scopeVersion": 1, "runId": None, "view": view})
                    last_output = time.monotonic()
                if time.monotonic() - last_output >= 15:
                    yield ": heartbeat\n\n"
                    last_output = time.monotonic()
                await asyncio.sleep(0.2)

        return StreamingResponse(frames(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


def register_web(app: FastAPI) -> None:
    dist = Path(__file__).resolve().parents[1] / "web" / "dist"
    if not (dist / "index.html").is_file():
        return
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{route:path}", include_in_schema=False)
    def spa(route: str):
        if route.partition("/")[0] not in ("", "app", "system", "board", "login"):
            asset = (dist / route).resolve()
            if asset.is_relative_to(dist) and asset.is_file() and route.partition("/")[0] != "v1":
                return FileResponse(asset)
            raise Problem(404, "NOT_FOUND", "This route does not exist.")
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})


app = create_app()
