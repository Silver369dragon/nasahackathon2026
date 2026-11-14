"""SQLite transactions for the synthetic training workspace and its change feed."""
import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from .models import BP, UNITS, ManualBatch, Telemetry, utc_text

Data = dict[str, Any]
CREW = ("mira", "kai", "lin", "noa", "sol")
WORKSPACE = "training:workspace"
MAX_EVENTS = 100_000
RETENTION_SECONDS = 86_400


class Problem(Exception):
    def __init__(self, status: int, code: str, message: str, *,
                 current_version: int | None = None, resource_ref: str | None = None):
        self.status, self.code, self.message = status, code, message
        self.current_version, self.resource_ref = current_version, resource_ref


def encoded(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def now_text() -> str:
    return utc_text(datetime.now(UTC))


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@contextmanager
def connection(path: Path, *, write: bool = False) -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(path, timeout=5, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield db
        db.commit()
    finally:
        db.close()  # An uncommitted transaction is rolled back on close.


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crew(id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices(
    id TEXT PRIMARY KEY, assignment_id TEXT UNIQUE NOT NULL,
    crew_id TEXT NOT NULL REFERENCES crew(id), valid_from TEXT NOT NULL,
    valid_to TEXT, last_seen REAL
);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL,
    csrf TEXT NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS measurements(
    row_id INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, crew_id TEXT NOT NULL REFERENCES crew(id),
    metric TEXT NOT NULL, observed TEXT NOT NULL, quality TEXT NOT NULL,
    live INTEGER NOT NULL, document TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS measurement_current
    ON measurements(crew_id,metric,live,observed DESC,row_id DESC);
CREATE INDEX IF NOT EXISTS measurement_history ON measurements(crew_id,observed DESC,row_id DESC);
CREATE TABLE IF NOT EXISTS receipts(
    context_key TEXT NOT NULL, actor TEXT NOT NULL, command TEXT NOT NULL, hash TEXT NOT NULL,
    result TEXT NOT NULL, PRIMARY KEY(context_key,actor,command)
);
CREATE TABLE IF NOT EXISTS packets(
    context_key TEXT NOT NULL, device TEXT NOT NULL, boot TEXT NOT NULL, seq INTEGER NOT NULL,
    upstream TEXT, sample_hash TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(context_key,device,boot,seq), UNIQUE(context_key,device,upstream)
);
CREATE TABLE IF NOT EXISTS summaries(
    crew_id TEXT PRIMARY KEY REFERENCES crew(id), version INTEGER NOT NULL,
    document TEXT NOT NULL, next_due REAL
);
CREATE TABLE IF NOT EXISTS changes(
    seq INTEGER PRIMARY KEY AUTOINCREMENT, crew_id TEXT NOT NULL,
    kind TEXT NOT NULL, occurred REAL NOT NULL, document TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_time ON changes(occurred);
"""


def initialize(path: Path) -> bytes:
    from .alerts import ALERT_SCHEMA
    from .body_scan import SCHEMA as BODY_SCAN_SCHEMA
    from .incidents import EMERGENCY_SCHEMA
    from .news2 import SCHEMA as NEWS2_SCHEMA
    from .push import PUSH_SCHEMA
    from .tasks import TASK_SCHEMA

    path.parent.mkdir(parents=True, exist_ok=True)
    initial = sqlite3.connect(path)
    try:
        initial.execute("PRAGMA journal_mode=WAL")
        initial.executescript(SCHEMA + ALERT_SCHEMA + EMERGENCY_SCHEMA + TASK_SCHEMA + PUSH_SCHEMA + NEWS2_SCHEMA + BODY_SCAN_SCHEMA)
    finally:
        initial.close()
    with connection(path, write=True) as db:
        db.execute("INSERT OR IGNORE INTO settings VALUES('cursor_secret',?)", (secrets.token_hex(32),))
        for crew in CREW:
            db.execute("INSERT OR IGNORE INTO crew VALUES(?,?)", (crew, crew.title()))
            db.execute("INSERT OR IGNORE INTO devices VALUES(?,?,?,?,NULL,NULL)",
                       ("mock-" + crew, "assignment-" + crew, crew, "1970-01-01T00:00:00.000000Z"))
        for row in db.execute("SELECT id FROM crew").fetchall():
            update_summary(db, row["id"], "initialize")
        return bytes.fromhex(db.execute("SELECT value FROM settings WHERE key='cursor_secret'").fetchone()[0])


def cursor_token(secret: bytes, scope: list[Any], position: Any) -> str:
    body = encoded([scope, position]).encode()
    raw = hmac.digest(secret, body, "sha256") + body
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def cursor_position(secret: bytes, scope: list[Any], token: str) -> Any:
    try:
        if len(token) > 4096:
            raise ValueError
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        signature, body = raw[:32], raw[32:]
        if not hmac.compare_digest(signature, hmac.digest(secret, body, "sha256")):
            raise ValueError
        actual, position = json.loads(body)
        if actual != scope:
            raise ValueError
        return position
    except (ValueError, TypeError, UnicodeDecodeError):
        raise Problem(409, "CURSOR_SCOPE_CONFLICT", "The cursor is invalid for this view and scope.") from None


def append_event(db: sqlite3.Connection, crew: str, event: str, document: Data, version: int,
                 entity_id: str, cause: str) -> None:
    payload = {"schemaVersion": "1.2", "runId": None, "scopeVersion": 1, "entityId": entity_id,
               "entityVersion": version, "occurredAt": now_text(), "causationId": cause,
               "operation": "upsert", "payload": document}
    db.execute("INSERT INTO changes(crew_id,kind,occurred,document) VALUES(?,?,?,?)",
               (crew, event, time.time(), encoded(payload)))


def update_summary(db: sqlite3.Connection, crew: str, cause: str) -> None:
    from .alerts import highest_alert

    row = db.execute("SELECT name FROM crew WHERE id=?", (crew,)).fetchone()
    prior = db.execute("SELECT document,version FROM summaries WHERE crew_id=?", (crew,)).fetchone()
    now = time.time()
    deadlines: list[float] = []
    cards = []
    for code in UNITS:
        primary = "mock" if code in ("heart_rate", "spo2") else "manual"
        query = "SELECT document FROM measurements WHERE crew_id=? AND metric=? AND live=1 "
        order = " ORDER BY observed DESC,row_id DESC LIMIT 1"
        source_clause = "AND json_extract(document,'$.provenance.source')=? "
        latest_row = db.execute(query + source_clause + order, (crew, code, primary)).fetchone()
        if not latest_row:
            latest_row = db.execute(query + order, (crew, code)).fetchone()
        latest = json.loads(latest_row[0]) if latest_row else None
        valid_row = None
        if latest:
            valid_row = db.execute(query + source_clause + "AND quality='good' "
                                   "AND json_extract(document,'$.method')=?" + order,
                                   (crew, code, latest["provenance"]["source"], latest["method"])).fetchone()
        valid = json.loads(valid_row[0]) if valid_row else None
        freshness = "no_data"
        if latest:
            freshness = "last_measurement"
            if latest["provenance"]["source"] == "mock" and code in ("heart_rate", "spo2"):
                freshness = "stale"
                if valid and valid["provenance"]["source"] == "mock":
                    observed = datetime.fromisoformat(valid["observedAt"]).timestamp()
                    received = datetime.fromisoformat(valid["receivedAt"]).timestamp()
                    expiry = min(observed, received) + 3
                    if expiry > now:
                        freshness = "fresh"
                        deadlines.append(expiry)
        cards.append({"metricCode": code, "latest": latest, "lastValid": valid, "freshness": freshness,
                      "primarySource": primary})
    device = db.execute("SELECT id,last_seen FROM devices WHERE crew_id=?", (crew,)).fetchone()
    last_seen = device["last_seen"] if device else None
    connectivity = "no_data" if last_seen is None else "offline"
    if last_seen is not None and last_seen + 15 > now:
        connectivity = "online"
        deadlines.append(last_seen + 15)
    document = {"crewId": crew, "name": row["name"], "metricCards": cards, "deviceStatus": connectivity,
                "highestActiveAlert": highest_alert(db, crew)}
    serialized = encoded(document)
    if prior and prior["document"] == serialized:
        db.execute("UPDATE summaries SET next_due=? WHERE crew_id=?", (min(deadlines, default=None), crew))
        return
    version = prior["version"] + 1 if prior else 1
    db.execute("INSERT OR REPLACE INTO summaries VALUES(?,?,?,?)",
               (crew, version, serialized, min(deadlines, default=None)))
    append_event(db, crew, "crew_summary.updated", {**document, "version": version}, version, crew, cause)


def upkeep(path: Path) -> None:
    from .alerts import expire_alerts
    from .tasks import maintain_tasks

    now = time.time()
    cutoff = now - RETENTION_SECONDS
    with connection(path, write=True) as db:
        maintain_tasks(db, datetime.fromtimestamp(now, UTC))
        due = {row[0] for row in db.execute("SELECT crew_id FROM summaries WHERE next_due<=?", (now,))}
        due.update(expire_alerts(db, now))
        for crew in due:
            update_summary(db, crew, "freshness")
        head = event_head(db)
        db.execute("DELETE FROM changes WHERE occurred<? OR seq<=?", (cutoff, head - MAX_EVENTS))
        db.execute("DELETE FROM sessions WHERE expires<=?", (time.time(),))


def event_head(db: sqlite3.Connection) -> int:
    row = db.execute("SELECT seq FROM sqlite_sequence WHERE name='changes'").fetchone()
    return row[0] if row else 0


def check_cursor_window(db: sqlite3.Connection, position: int) -> None:
    first = db.execute("SELECT MIN(seq) FROM changes").fetchone()[0]
    floor = first - 1 if first is not None else event_head(db)
    if position < floor:
        raise Problem(410, "CURSOR_EXPIRED", "Take a new snapshot to resume.")


def project_measurement(document: Data, view: str) -> Data:
    if view == "personal":
        return document
    public_context = ("activity", "posture", "measurementSite", "temperatureType")
    result = {**document, "context": {k: v for k, v in document["context"].items() if k in public_context}}
    if view == "system_display":
        allowed = ("id", "subject", "metricCode", "value", "unit", "observedAt", "receivedAt",
                   "method", "quality", "context", "measurementGroupId")
        result = {k: result[k] for k in allowed}
        result["provenance"] = {k: document["provenance"][k] for k in ("source", "dataOrigin", "isSynthetic")}
    return result


def project_summary(document: Data, view: str) -> Data:
    cards = []
    for card in document["metricCards"]:
        latest, valid = card["latest"], card["lastValid"]
        cards.append({**card, "latest": project_measurement(latest, view) if latest else None,
                      "lastValid": project_measurement(valid, view) if valid and view != "system_display" else None})
    # Older replay frames can predate the broadcast-only summary format.
    public = {k: v for k, v in document.items() if k not in ("activeIncidentCount", "assignee", "taskSummary")}
    return {**public, "metricCards": cards}


def accept(path: Path, batch: ManualBatch | Telemetry, actor: str, crew: str) -> tuple[Data, bool]:
    command = encoded([batch.bootId, batch.seq]) if isinstance(batch, Telemetry) else batch.commandId
    request_data = batch.model_dump(mode="json")
    request_hash = digest(encoded(request_data))
    with connection(path, write=True) as db:
        previous = db.execute("SELECT hash,result FROM receipts WHERE context_key=? AND actor=? AND command=?",
                              (WORKSPACE, actor, command)).fetchone()
        if previous:
            if previous["hash"] != request_hash:
                raise Problem(409, "IDEMPOTENCY_CONFLICT", "The command was accepted with different content.")
            return json.loads(previous["result"]), True
        live = True
        sample_hash = ""
        if isinstance(batch, Telemetry):
            valid = db.execute("SELECT 1 FROM devices WHERE id=? AND assignment_id=? AND crew_id=? "
                               "AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)",
                               (actor, batch.assignmentId, crew, utc_text(batch.observedAt),
                                utc_text(batch.observedAt))).fetchone()
            if not valid or batch.clockStatus == "unsynced":
                raise Problem(409, "ASSIGNMENT_CONFLICT", "The device assignment cannot be verified at the observation time.")
            # Upstream IDs survive forwarding across connections and device boots.
            sample_hash = digest(encoded({k: v for k, v in request_data.items() if k not in
                                  ("bootId", "seq", "messageId", "deviceUptimeMs", "deliveryKind", "causationId")}))
            sample = db.execute("SELECT result,sample_hash FROM packets WHERE context_key=? AND device=? AND upstream=?",
                                (WORKSPACE, actor, batch.upstreamSampleId)).fetchone()
            if sample:
                if sample["sample_hash"] != sample_hash:
                    raise Problem(409, "IDEMPOTENCY_CONFLICT", "The upstream sample has different content.")
                saved = sample["result"]
                db.execute("INSERT INTO receipts VALUES(?,?,?,?,?)", (WORKSPACE, actor, command, request_hash, saved))
                # The original packet owns the unique upstream ID. This second delivery
                # still advances its boot's sequence and points at the same accepted rows.
                db.execute("INSERT INTO packets VALUES(?,?,?,?,NULL,?,?)",
                           (WORKSPACE, actor, batch.bootId, batch.seq, sample_hash, saved))
                return json.loads(saved), True
            last_seq = db.execute("SELECT MAX(seq) FROM packets WHERE context_key=? AND device=? AND boot=?",
                                  (WORKSPACE, actor, batch.bootId)).fetchone()[0]
            live = batch.deliveryKind == "live" and (last_seq is None or batch.seq > last_seq)
            db.execute("UPDATE devices SET last_seen=? WHERE id=?", (time.time(), actor))
        result = write_measurements(db, batch, actor, crew, live)
        saved = encoded(result)
        db.execute("INSERT INTO receipts VALUES(?,?,?,?,?)", (WORKSPACE, actor, command, request_hash, saved))
        if isinstance(batch, Telemetry):
            db.execute("INSERT INTO packets VALUES(?,?,?,?,?,?,?)",
                       (WORKSPACE, actor, batch.bootId, batch.seq, batch.upstreamSampleId, sample_hash, saved))
        return result, False


def write_measurements(db: sqlite3.Connection, batch: ManualBatch | Telemetry, actor: str, crew: str,
                       live: bool) -> Data:
    from .alerts import evaluate_heart_rate
    from .tasks import complete_measurement

    mock = isinstance(batch, Telemetry)
    received = now_text()
    observed = utc_text(batch.observedAt)
    source = "mock" if mock else "manual"
    ids = []
    evaluations: list[str] = []
    alerts: list[str] = []
    group = batch.measurementGroupId or next((m.measurementGroupId for m in batch.metrics if m.code in BP
                                               and m.measurementGroupId), None) or str(uuid4())
    cause = (batch.causationId or batch.messageId) if isinstance(batch, Telemetry) else batch.commandId
    provenance = {"source": source, "dataOrigin": "synthetic" if mock else "manual", "transport": "http",
                  "isSynthetic": True, "deviceId": actor if mock else None,
                  "assignmentId": batch.assignmentId if isinstance(batch, Telemetry) else None,
                  "scenarioId": None, "scenarioVersion": None,
                  "upstreamSampleId": batch.upstreamSampleId if isinstance(batch, Telemetry) else None}
    bp = {m.code: m for m in batch.metrics if m.code in BP}
    sys, dia = bp.get("blood_pressure_systolic"), bp.get("blood_pressure_diastolic")
    reversed_bp = bool(sys and dia and sys.value is not None and dia.value is not None and sys.value <= dia.value)
    for metric in batch.metrics:
        ident = str(uuid4())
        invalid_order = metric.code in BP and reversed_bp and metric.quality == "good"
        quality = "invalid" if invalid_order else metric.quality
        reason = "pressure_order" if invalid_order else metric.qualityReason or metric.missingReason
        row = {"id": ident, "schemaVersion": "1.2", "runId": None, "mode": "training",
               "subject": {"type": "crew", "id": crew}, "metricCode": metric.code, "value": metric.value,
               "unit": metric.unit, "observedAt": observed, "receivedAt": received,
               "clockStatus": batch.clockStatus if isinstance(batch, Telemetry) else "synced",
               "scenarioTimeMs": None, "method": batch.method if isinstance(batch, ManualBatch) else metric.method,
               "context": batch.context if isinstance(batch, ManualBatch) else metric.context,
               "provenance": provenance, "quality": quality, "reportedQuality": metric.quality,
               "qualityReason": reason, "qualityProfileVersion": "demo-quality-1",
               "measurementGroupId": group if metric.code in BP else metric.measurementGroupId or batch.measurementGroupId,
               "supersedesMeasurementId": None,
               "actorId": actor, "causationId": cause,
               "deliveryKind": batch.deliveryKind if isinstance(batch, Telemetry) else "live"}
        db.execute("INSERT INTO measurements(id,crew_id,metric,observed,quality,live,document) VALUES(?,?,?,?,?,?,?)",
                   (ident, crew, metric.code, observed, quality, live, encoded(row)))
        append_event(db, crew, "measurement.accepted", row, 1, ident, cause)
        if metric.code == "heart_rate":
            evaluations, alerts = evaluate_heart_rate(db, row, live)
        ids.append(ident)
    if isinstance(batch, ManualBatch):
        complete_measurement(db, crew, observed, received, ids, cause)
    update_summary(db, crew, cause)
    return {"messageId": batch.messageId if isinstance(batch, Telemetry) else batch.commandId,
            "status": "accepted", "measurementIds": ids, "ruleEvaluationIds": evaluations, "alertIds": alerts,
            "statisticsStatus": "not_enabled"}
