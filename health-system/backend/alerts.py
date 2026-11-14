"""Durable evaluation of the versioned, synthetic training heart-rate rule."""
import json
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

from . import store
from .models import utc_text
from .store import WORKSPACE, Data

RULE = "TRAINING_HR_RECHECK"
VERSION = 1
RULE_SET = "training-rules-1"
PROCEDURE = "training-recheck"
FRESH_SECONDS = 3
REQUIRED_BUCKETS = 3
THRESHOLD = 110

DEFINITION = {
    "ruleId": RULE, "ruleVersion": VERSION, "ruleSetVersion": RULE_SET, "domain": "training",
    "applicableModes": ["training"], "subjectType": "crew", "requiredInputs": ["heart_rate"],
    "qualityRequirements": ["good"], "freshnessRequirements": {"maxAgeSeconds": FRESH_SECONDS},
    "contextRequirements": {"activity": "rest", "source": "mock", "isSynthetic": True,
                            "dataOrigin": "synthetic", "deliveryKind": "live"},
    "condition": {"operator": ">", "value": THRESHOLD, "unit": "/min"},
    "persistence": {"bucketSeconds": 1, "consecutiveBuckets": REQUIRED_BUCKETS},
    "clearCondition": {"operator": "<=", "value": THRESHOLD, "consecutiveBuckets": REQUIRED_BUCKETS},
    "severity": "recheck", "createIncident": False, "incidentType": None,
    "procedureId": PROCEDURE, "procedureVersion": 1, "enabled": True, "reviewStatus": "training_only",
    "sourceReferences": ["NASA_Health_System_Build_Spec.md §7.1"],
}

ALERT_SCHEMA = """
CREATE TABLE IF NOT EXISTS rule_definitions(
    rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL, document TEXT NOT NULL,
    PRIMARY KEY(rule_id,rule_version)
);
CREATE TABLE IF NOT EXISTS alerts(
    id TEXT PRIMARY KEY, context_key TEXT NOT NULL, crew_id TEXT NOT NULL REFERENCES crew(id),
    rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL, state TEXT NOT NULL, severity TEXT NOT NULL,
    created TEXT NOT NULL, updated TEXT NOT NULL, last_matched TEXT NOT NULL, reason TEXT NOT NULL,
    initial_evidence TEXT NOT NULL, evidence TEXT NOT NULL, version INTEGER NOT NULL,
    FOREIGN KEY(rule_id,rule_version) REFERENCES rule_definitions(rule_id,rule_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_episode
    ON alerts(context_key,crew_id,rule_id,rule_version) WHERE state IN ('active','unknown');
CREATE TABLE IF NOT EXISTS rule_progress(
    context_key TEXT NOT NULL, crew_id TEXT NOT NULL REFERENCES crew(id),
    rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL, stream TEXT NOT NULL,
    observed REAL NOT NULL, streak TEXT NOT NULL, evidence TEXT NOT NULL, expires REAL,
    PRIMARY KEY(context_key,crew_id,rule_id,rule_version)
);
CREATE INDEX IF NOT EXISTS rule_expiry ON rule_progress(expires) WHERE expires IS NOT NULL;
CREATE TABLE IF NOT EXISTS rule_evaluations(
    id TEXT PRIMARY KEY, context_key TEXT NOT NULL, crew_id TEXT NOT NULL REFERENCES crew(id),
    rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL, measurement_id TEXT NOT NULL,
    sample_group TEXT, status TEXT NOT NULL, reason TEXT NOT NULL, input_ids TEXT NOT NULL,
    evaluated_at TEXT NOT NULL, alert_id TEXT REFERENCES alerts(id),
    UNIQUE(context_key,crew_id,rule_id,rule_version,measurement_id),
    UNIQUE(context_key,crew_id,rule_id,rule_version,sample_group),
    FOREIGN KEY(rule_id,rule_version) REFERENCES rule_definitions(rule_id,rule_version)
);
"""
# initialize() executes this schema as one SQLite script. Quote the static JSON literal for SQL.
_definition_sql = store.encoded(DEFINITION).replace("'", "''")
ALERT_SCHEMA += f"INSERT OR IGNORE INTO rule_definitions VALUES('{RULE}',{VERSION},'{_definition_sql}');"

MATCHED = "連續三個一秒時間桶的合成靜息心率均高於 110 bpm，請重測。"
RECOVERED = "連續三個一秒時間桶的合成靜息心率均為 110 bpm 以下，已符合恢復條件。"
INTERRUPTED = "有效靜息心率資料中斷，尚無法確認條件是否持續。"
BAD_QUALITY = "量測缺值或品質不足，須取得新的有效靜息心率。"
WAITING = "目前尚未滿足連續三個有效時間桶的條件。"


def _document(alert: sqlite3.Row) -> Data:
    return {
        "id": alert["id"], "episodeId": alert["id"], "runId": None, "crewId": alert["crew_id"],
        "ruleId": alert["rule_id"], "ruleVersion": alert["rule_version"], "ruleSetVersion": RULE_SET,
        "conditionState": alert["state"], "severity": alert["severity"], "procedureId": PROCEDURE,
        "procedureVersion": 1, "reason": alert["reason"], "createdAt": alert["created"],
        "updatedAt": alert["updated"], "lastMatchedAt": alert["last_matched"], "version": alert["version"],
        "initialEvidenceMeasurementIds": json.loads(alert["initial_evidence"]),
        "evidenceMeasurementIds": json.loads(alert["evidence"]),
    }


def list_alerts(db: sqlite3.Connection, crew_id: str | None = None,
                condition_state: str | None = None) -> list[Data]:
    query = "SELECT * FROM alerts WHERE context_key=?"
    args = [WORKSPACE]
    if crew_id:
        query += " AND crew_id=?"
        args.append(crew_id)
    if condition_state:
        query += " AND state=?"
        args.append(condition_state)
    return [_document(row) for row in db.execute(query + " ORDER BY created DESC,rowid DESC", args)]


def highest_alert(db: sqlite3.Connection, crew: str) -> Data | None:
    row = db.execute("SELECT id,state,severity,rule_id FROM alerts WHERE context_key=? AND crew_id=? "
                     "AND state IN ('active','unknown') ORDER BY CASE severity WHEN 'urgent' THEN 3 "
                     "WHEN 'assistance' THEN 2 WHEN 'recheck' THEN 1 ELSE 0 END DESC, "
                     "(state='active') DESC,created DESC LIMIT 1", (WORKSPACE, crew)).fetchone()
    return ({"id": row["id"], "conditionState": row["state"], "severity": row["severity"],
             "ruleId": row["rule_id"]} if row else None)


def _publish(db: sqlite3.Connection, alert_id: str, cause: str) -> None:
    alert = db.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone()
    store.append_event(db, alert["crew_id"], "alert.updated", _document(alert), alert["version"], alert_id, cause)


def _open_episode(db: sqlite3.Connection, crew: str) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM alerts WHERE context_key=? AND crew_id=? AND rule_id=? "
                      "AND rule_version=? AND state IN ('active','unknown')",
                      (WORKSPACE, crew, RULE, VERSION)).fetchone()


def _change_episode(db: sqlite3.Connection, episode: sqlite3.Row | None, state: str,
                    reason: str, inputs: list[str], row: Data) -> str | None:
    if not episode and state != "active":
        return None
    if episode and state == episode["state"] == "unknown":
        return None
    evidence = store.encoded(inputs)
    if episode:
        ident = episode["id"]
        last_matched = row["observedAt"] if state == "active" else episode["last_matched"]
        db.execute("UPDATE alerts SET state=?,updated=?,last_matched=?,reason=?,evidence=?,"
                   "version=version+1 WHERE id=?",
                   (state, row["receivedAt"], last_matched, reason, evidence, ident))
    else:
        from .incidents import publish_emergency

        ident = str(uuid4())
        crew = row["subject"]["id"]
        db.execute("INSERT INTO alerts VALUES(?,?,?,?,?,?,'recheck',?,?,?,?,?,?,1)",
                   (ident, WORKSPACE, crew, RULE, VERSION, state, row["receivedAt"], row["receivedAt"],
                    row["observedAt"], reason, evidence, evidence))
        publish_emergency(db, crew, "sensor", ident)
    _publish(db, ident, row["causationId"])
    return ident


def _save_evaluation(db: sqlite3.Connection, row: Data, status: str, reason: str,
                     inputs: list[str], alert_id: str | None) -> tuple[list[str], list[str]]:
    ident = str(uuid4())
    db.execute("INSERT INTO rule_evaluations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
               (ident, WORKSPACE, row["subject"]["id"], RULE, VERSION, row["id"],
                row["measurementGroupId"], status, reason, store.encoded(inputs),
                row["receivedAt"], alert_id))
    return [ident], [alert_id] if alert_id else []


def evaluate_heart_rate(db: sqlite3.Connection, row: Data, live: bool) -> tuple[list[str], list[str]]:
    source = row["provenance"]
    if (row["metricCode"] != "heart_rate" or row["runId"] is not None or row["mode"] != "training"
            or row["subject"]["type"] != "crew" or row["deliveryKind"] != "live" or not live
            or source["source"] != "mock" or source["dataOrigin"] != "synthetic"
            or source["isSynthetic"] is not True):
        return [], []

    crew, measurement = row["subject"]["id"], row["id"]
    scope = (WORKSPACE, crew, RULE, VERSION)
    duplicate = db.execute("SELECT id FROM rule_evaluations WHERE context_key=? AND crew_id=? "
                           "AND rule_id=? AND rule_version=? AND (measurement_id=? OR sample_group=?)",
                           (*scope, measurement, row["measurementGroupId"])).fetchone()
    if duplicate:
        return [duplicate["id"]], []

    observed = datetime.fromisoformat(row["observedAt"]).timestamp()
    received = datetime.fromisoformat(row["receivedAt"]).timestamp()
    expires = min(observed, received) + FRESH_SECONDS
    progress = db.execute("SELECT * FROM rule_progress WHERE context_key=? AND crew_id=? "
                          "AND rule_id=? AND rule_version=?", scope).fetchone()
    if expires <= store.time.time() or (progress and observed < progress["observed"]):
        return [], []

    stream = store.encoded([source["deviceId"], source["assignmentId"], row["method"]])
    bucket = int(observed)
    previous_bucket = int(progress["observed"]) if progress else None
    continuous = bool(progress and stream == progress["stream"] and previous_bucket == bucket - 1
                      and progress["expires"] is not None and progress["expires"] > received)
    rest = row["context"].get("activity") == "rest"
    usable = rest and row["quality"] == "good" and row["value"] is not None
    if (usable and previous_bucket == bucket and progress and stream == progress["stream"]
            and progress["streak"] != "interrupted"):
        db.execute("UPDATE rule_progress SET observed=?,expires=? WHERE context_key=? AND crew_id=? "
                   "AND rule_id=? AND rule_version=?", (observed, expires, *scope))
        return _save_evaluation(db, row, "not_applicable", "該秒已有心率樣本。", [measurement], None)

    current = _open_episode(db, crew)
    alert_id = None
    evidence = [measurement]
    deadline: float | None = expires
    if not usable:
        streak, deadline = "interrupted", None
        status = "incomplete" if rest else "not_applicable"
        reason = BAD_QUALITY if rest else "最新量測非靜息情境，等待有效靜息心率。"
        alert_id = _change_episode(db, current, "unknown", reason, evidence, row)
    else:
        if current and not continuous:
            alert_id = _change_episode(db, current, "unknown", INTERRUPTED, evidence, row)
        streak = "high" if row["value"] > THRESHOLD else "recovery"
        if continuous and progress and streak == progress["streak"]:
            evidence = (json.loads(progress["evidence"]) + evidence)[-REQUIRED_BUCKETS:]
        status, reason = "not_matched", WAITING
        if len(evidence) == REQUIRED_BUCKETS:
            if streak == "high":
                status, reason = "matched", MATCHED
                alert_id = _change_episode(db, current, "active", reason, evidence, row)
            else:
                reason = RECOVERED
                alert_id = _change_episode(db, current, "cleared", reason, evidence, row)

    db.execute("INSERT OR REPLACE INTO rule_progress VALUES(?,?,?,?,?,?,?,?,?)",
               (*scope, stream, observed, streak, store.encoded(evidence), deadline))
    return _save_evaluation(db, row, status, reason, evidence, alert_id)


def expire_alerts(db: sqlite3.Connection, now: float) -> set[str]:
    due = db.execute("SELECT crew_id FROM rule_progress WHERE context_key=? AND rule_id=? "
                     "AND rule_version=? AND expires<=?", (WORKSPACE, RULE, VERSION, now)).fetchall()
    changed = set()
    stamp = utc_text(datetime.fromtimestamp(now, UTC))
    for (crew,) in due:
        db.execute("UPDATE rule_progress SET streak='interrupted',evidence='[]',expires=NULL "
                   "WHERE context_key=? AND crew_id=? AND rule_id=? AND rule_version=?",
                   (WORKSPACE, crew, RULE, VERSION))
        episode = _open_episode(db, crew)
        if episode and episode["state"] == "active":
            db.execute("UPDATE alerts SET state='unknown',reason=?,updated=?,version=version+1 WHERE id=?",
                       (INTERRUPTED, stamp, episode["id"]))
            _publish(db, episode["id"], "freshness")
            changed.add(crew)
    return changed
