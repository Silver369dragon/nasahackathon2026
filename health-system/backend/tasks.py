"""UTC daily training tasks, private evidence, reminders and participation badges."""
import json
import sqlite3
import time
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import Field, StrictFloat, StrictInt, StringConstraints

from .models import Contract, Identifier, utc_text
from .store import WORKSPACE, Data, Problem, append_event, digest, encoded

ACTIVITIES = ("cycle", "resistance", "treadmill")
KINDS = ("exercise", "measurement", "self_check")
OPEN = ("pending", "in_progress")
BADGES = ((1, "first_exercise"), (3, "exercise_3_days"), (7, "exercise_7_days"))
TASK_SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_tasks(
    id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crew(id), day TEXT NOT NULL,
    kind TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    due TEXT NOT NULL, activity TEXT, started TEXT, completed TEXT,
    reminded TEXT, snoozed_until TEXT, evidence TEXT, replaces_id TEXT REFERENCES daily_tasks(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS active_daily_task ON daily_tasks(crew_id, day, kind)
    WHERE status!='replaced';
CREATE INDEX IF NOT EXISTS tasks_for_day ON daily_tasks(day, status);
CREATE TABLE IF NOT EXISTS task_days(day TEXT PRIMARY KEY, team_version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS task_badges(
    crew_id TEXT NOT NULL REFERENCES crew(id), code TEXT NOT NULL, rule_version INTEGER NOT NULL,
    qualifying_id TEXT NOT NULL REFERENCES daily_tasks(id), awarded TEXT NOT NULL,
    PRIMARY KEY(crew_id, code, rule_version), UNIQUE(crew_id, code, rule_version, qualifying_id)
);
"""

TaskStatus = Literal["pending", "in_progress", "completed", "skipped", "exempt"]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class TaskAction(Contract):
    commandId: Identifier
    expectedVersion: Annotated[StrictInt, Field(ge=1)]
    action: Literal["start", "complete", "skip", "snooze"]
    activity: Literal["cycle", "resistance", "treadmill"] | None = None
    durationMinutes: Annotated[StrictFloat, Field(gt=0, le=1440)] | None = None
    rating: Literal["good", "fatigued", "unwell"] | None = None
    note: ShortText | None = None
    reason: ShortText | None = None


def clock() -> datetime:
    return datetime.fromtimestamp(time.time(), UTC)


def task_document(row: sqlite3.Row, now: datetime) -> Data:
    open_today = row["day"] == now.date().isoformat() and row["status"] in OPEN
    return {
        "id": row["id"], "date": row["day"], "kind": row["kind"], "status": row["status"],
        "version": row["version"], "dueAt": row["due"], "activity": row["activity"],
        "startedAt": row["started"], "completedAt": row["completed"], "remindedAt": row["reminded"],
        "snoozedUntil": row["snoozed_until"], "overdue": row["status"] in OPEN and row["due"] <= utc_text(now),
        "reminderActive": bool(open_today and row["reminded"] and not row["snoozed_until"]),
        "evidence": json.loads(row["evidence"]) if row["evidence"] else None,
    }


def get_task(db: sqlite3.Connection, crew: str, task_id: str) -> Data:
    row = db.execute("SELECT * FROM daily_tasks WHERE id=? AND crew_id=?", (task_id, crew)).fetchone()
    if not row:
        raise Problem(404, "NOT_FOUND", "This task is unavailable.")
    return task_document(row, clock())


def team_tasks(db: sqlite3.Connection, day: date) -> Data:
    counts: Data = {"date": day.isoformat(), "completed": 0, "pending": 0, "skipped": 0, "exempt": 0}
    rows = db.execute("""SELECT status,count(*) AS n FROM daily_tasks
                         WHERE day=? AND status!='replaced' GROUP BY status""", (day.isoformat(),))
    for row in rows:
        key = "pending" if row["status"] in OPEN else row["status"]
        counts[key] += row["n"]
    return counts


def publish_team(db: sqlite3.Connection, day: date) -> None:
    # Public events must not carry a crew ID, task ID or a client-controlled command ID.
    version = db.execute("UPDATE task_days SET team_version=team_version+1 WHERE day=? RETURNING team_version",
                         (day.isoformat(),)).fetchone()[0]
    append_event(db, "", "team_tasks.updated", team_tasks(db, day), version, day.isoformat(), "team-total")


def publish_task(db: sqlite3.Connection, row: sqlite3.Row, now: datetime, cause: str) -> Data:
    task = task_document(row, now)
    append_event(db, row["crew_id"], "task.updated", task, row["version"], row["id"], cause)
    return task


def existing_manual_evidence(db: sqlite3.Connection, crew: str, day: date) -> tuple[str, list[str]] | None:
    """Recover one complete, receipt-backed manual batch created before daily tasks existed."""
    start = utc_text(datetime.combine(day, datetime.min.time(), UTC))
    end = utc_text(datetime.combine(day + timedelta(days=1), datetime.min.time(), UTC))
    candidates = db.execute("""SELECT m.id,m.document,r.result FROM measurements m
        JOIN receipts r ON r.context_key=? AND r.actor=m.crew_id AND r.command=json_extract(m.document,'$.causationId')
        WHERE m.crew_id=? AND m.observed>=? AND m.observed<? AND m.live=1
          AND json_extract(m.document,'$.provenance.source')='manual'
          AND json_extract(m.document,'$.actorId')=m.crew_id ORDER BY m.row_id""", (WORKSPACE, crew, start, end))
    for candidate in candidates:
        sample, receipt = json.loads(candidate["document"]), json.loads(candidate["result"])
        received = sample.get("receivedAt")
        ids = receipt.get("measurementIds")
        cause = sample["causationId"]
        if (not isinstance(received, str) or not start <= received < end or
            receipt.get("messageId") != cause or receipt.get("status") != "accepted" or
            not isinstance(ids, list) or not 1 <= len(ids) <= 100 or
            not all(isinstance(mid, str) for mid in ids) or ids[0] != candidate["id"] or len(set(ids)) != len(ids)):
            continue
        try:
            if utc_text(datetime.fromisoformat(received)) != received:
                continue
        except ValueError:
            continue
        # Check every returned ID against the same subject, batch, observation day and save time.
        verified = db.execute("""SELECT id FROM measurements
            WHERE crew_id=? AND live=1 AND observed>=? AND observed<? AND json_extract(document,'$.actorId')=?
              AND json_extract(document,'$.provenance.source')='manual' AND json_extract(document,'$.causationId')=?
              AND json_extract(document,'$.receivedAt')=? AND json_extract(document,'$.subject.id')=crew_id
              AND json_extract(document,'$.runId') IS NULL ORDER BY row_id""", (crew, start, end, crew, cause, received))
        if [r["id"] for r in verified] == ids:
            return received, ids
    return None


def ensure_day(db: sqlite3.Connection, now: datetime) -> None:
    day = now.date()
    if db.execute("SELECT 1 FROM task_days WHERE day=?", (day.isoformat(),)).fetchone():
        return
    db.execute("INSERT INTO task_days(day) VALUES(?)", (day.isoformat(),))
    due = utc_text(now.replace(hour=18, minute=0, second=0, microsecond=0))
    activity = ACTIVITIES[(day - date(1970, 1, 1)).days % len(ACTIVITIES)]
    for (crew,) in db.execute("SELECT id FROM crew ORDER BY rowid").fetchall():
        for kind in KINDS:
            row = db.execute("""INSERT INTO daily_tasks(id,crew_id,day,kind,status,due,activity)
                                VALUES(?,?,?,?,'pending',?,?) RETURNING *""",
                             (str(uuid4()), crew, day.isoformat(), kind, due,
                              activity if kind == "exercise" else None)).fetchone()
            if kind == "measurement" and (evidence := existing_manual_evidence(db, crew, day)):
                stamp, ids = evidence
                row = finish(db, row, stamp, "completed", {"measurementIds": ids, "actorId": crew})
            publish_task(db, row, now, "daily-schedule")
    publish_team(db, day)


def maintain_tasks(db: sqlite3.Connection, now: datetime) -> None:
    ensure_day(db, now)
    stamp = utc_text(now)
    reminders = db.execute("""UPDATE daily_tasks SET reminded=?,snoozed_until=NULL,version=version+1
        WHERE day=? AND status IN ('pending','in_progress') AND due<=?
          AND (reminded IS NULL OR snoozed_until<=?) RETURNING *""",
                           (stamp, now.date().isoformat(), stamp, stamp)).fetchall()
    for row in reminders:
        publish_task(db, row, now, "scheduled-reminder")


def personal_tasks(db: sqlite3.Connection, crew: str, day: date | None = None) -> Data:
    """Read only this person's tasks and actual history, for the UI and local assistant."""
    now = clock()
    day = day or now.date()
    history: dict[str, Data] = {}
    for offset in range(6, -1, -1):
        stamp = (day - timedelta(days=offset)).isoformat()
        history[stamp] = {"date": stamp, "completed": 0, "pending": 0, "skipped": 0,
                          "exempt": 0, "exerciseCompleted": False, "exerciseTaskId": None}
    rows = db.execute("""SELECT * FROM daily_tasks WHERE crew_id=? AND day BETWEEN ? AND ?
                         AND status!='replaced' ORDER BY day,kind""",
                      (crew, next(iter(history)), day.isoformat())).fetchall()
    items = []
    for row in rows:
        if row["day"] == day.isoformat():
            items.append(task_document(row, now))
        record = history[row["day"]]
        record["pending" if row["status"] in OPEN else row["status"]] += 1
        if row["kind"] == "exercise":
            record["exerciseTaskId"] = row["id"]
            record["exerciseCompleted"] = row["status"] == "completed"
    badges = [{"code": r["code"], "awardedAt": r["awarded"], "qualifyingRecordId": r["qualifying_id"]}
              for r in db.execute("SELECT * FROM task_badges WHERE crew_id=? ORDER BY rowid", (crew,))]
    return {"date": day.isoformat(), "timezone": "UTC", "items": items, "history": list(history.values()),
            "badges": badges}


def award_exercise(db: sqlite3.Connection, row: sqlite3.Row, stamp: str) -> None:
    count = db.execute("""SELECT count(DISTINCT day) FROM daily_tasks
                          WHERE crew_id=? AND kind='exercise' AND status='completed'""", (row["crew_id"],)).fetchone()[0]
    for threshold, code in BADGES:
        if count == threshold:
            db.execute("INSERT OR IGNORE INTO task_badges VALUES(?,?,1,?,?)",
                       (row["crew_id"], code, row["id"], stamp))


def complete_measurement(db: sqlite3.Connection, crew: str, observed: str, received: str,
                         measurement_ids: list[str], cause: str) -> None:
    now = datetime.fromisoformat(received)
    # Older observations and replays never finish a new day's measurement task.
    if datetime.fromisoformat(observed).date() != now.date():
        return
    ensure_day(db, now)
    row = db.execute("""UPDATE daily_tasks SET status='completed',version=version+1,completed=?,
                        snoozed_until=NULL,evidence=? WHERE crew_id=? AND day=? AND kind='measurement'
                        AND status='pending' RETURNING *""",
                     (received, encoded({"measurementIds": measurement_ids, "actorId": crew}),
                      crew, now.date().isoformat())).fetchone()
    if row:
        publish_task(db, row, now, cause)
        publish_team(db, now.date())


def only_fields(action: TaskAction, *optional: str) -> None:
    supplied = action.model_dump(exclude_none=True).keys()
    if supplied - {"action", "commandId", "expectedVersion", *optional}:
        raise Problem(422, "VALIDATION_ERROR", "These fields do not apply to this task action.")


def exercise_action(db: sqlite3.Connection, row: sqlite3.Row, action: TaskAction, now: datetime) -> sqlite3.Row:
    only_fields(action, "activity", *(("durationMinutes",) if action.action == "complete" else ()))
    running = row["status"] == "in_progress"
    if running and (action.action == "start" or action.durationMinutes is not None
                    or (action.activity and action.activity != row["activity"])):
        raise Problem(409, "TASK_STATE_CONFLICT", "Finish the running activity with its original timer.")
    if action.action == "complete" and not running and action.durationMinutes is None:
        raise Problem(422, "VALIDATION_ERROR", "Enter the recorded duration in minutes.")
    if action.activity and action.activity != row["activity"]:
        db.execute("UPDATE daily_tasks SET status='replaced',version=version+1 WHERE id=?", (row["id"],))
        row = db.execute("""INSERT INTO daily_tasks
            (id,crew_id,day,kind,status,due,activity,reminded,snoozed_until,replaces_id)
            VALUES(?,?,?,'exercise','pending',?,?,?,?,?) RETURNING *""",
                         (str(uuid4()), row["crew_id"], row["day"], row["due"], action.activity,
                          row["reminded"], row["snoozed_until"], row["id"])).fetchone()
    stamp = utc_text(now)
    evidence: Data = {"activity": row["activity"], "actorId": row["crew_id"]}
    if row["replaces_id"]:
        evidence["replacesTaskId"] = row["replaces_id"]
    if action.action == "start":
        return db.execute("""UPDATE daily_tasks SET status='in_progress',version=version+1,started=?,evidence=?
                             WHERE id=? RETURNING *""", (stamp, encoded(evidence), row["id"])).fetchone()
    if running:
        seconds = max(0.0, (now - datetime.fromisoformat(row["started"])).total_seconds())
        evidence.update(source="timer", durationSeconds=round(seconds, 3))
    else:
        assert action.durationMinutes is not None
        evidence.update(source="manual", durationSeconds=action.durationMinutes * 60)
    row = finish(db, row, stamp, "completed", evidence)
    award_exercise(db, row, stamp)
    return row


def finish(db: sqlite3.Connection, row: sqlite3.Row, stamp: str, status: str, evidence: Data) -> sqlite3.Row:
    return db.execute("""UPDATE daily_tasks SET status=?,version=version+1,completed=?,snoozed_until=NULL,
                         evidence=? WHERE id=? RETURNING *""", (status, stamp, encoded(evidence), row["id"])).fetchone()


def apply_action(db: sqlite3.Connection, row: sqlite3.Row, action: TaskAction, now: datetime) -> sqlite3.Row:
    if row["day"] != now.date().isoformat() or row["status"] not in OPEN:
        raise Problem(409, "TASK_STATE_CONFLICT", "The task is closed or belongs to another UTC day.")
    if row["version"] != action.expectedVersion:
        raise Problem(409, "VERSION_CONFLICT", "Refresh the task before retrying.",
                      current_version=row["version"], resource_ref=row["id"])
    if action.action == "snooze":
        only_fields(action)
        if not row["reminded"] or row["snoozed_until"]:
            raise Problem(409, "TASK_STATE_CONFLICT", "There is no active reminder to postpone.")
        return db.execute("""UPDATE daily_tasks SET version=version+1,snoozed_until=? WHERE id=? RETURNING *""",
                          (utc_text(now + timedelta(minutes=15)), row["id"])).fetchone()
    if action.action == "skip":
        only_fields(action, "reason")
        if not action.reason:
            raise Problem(422, "VALIDATION_ERROR", "A reason is required to skip a task.")
        evidence: Data = {"reason": action.reason, "actorId": row["crew_id"]}
        if row["replaces_id"]:
            evidence["replacesTaskId"] = row["replaces_id"]
        return finish(db, row, utc_text(now), "skipped", evidence)
    if row["kind"] == "exercise":
        return exercise_action(db, row, action, now)
    if row["kind"] == "self_check" and action.action == "complete":
        only_fields(action, "rating", "note")
        if action.rating is None:
            raise Problem(422, "VALIDATION_ERROR", "Select a self-check response.")
        return finish(db, row, utc_text(now), "completed", {"rating": action.rating,
                      "note": action.note or "", "actorId": row["crew_id"]})
    raise Problem(422, "VALIDATION_ERROR", "This action does not apply to this task.")


def task_command(db: sqlite3.Connection, crew: str, task_id: str, action: TaskAction) -> tuple[Data, bool]:
    fingerprint = digest(encoded([task_id, action.model_dump(exclude_none=True)]))
    key = (WORKSPACE, crew, action.commandId)
    receipt = db.execute("SELECT hash,result FROM receipts WHERE context_key=? AND actor=? AND command=?", key).fetchone()
    if receipt:
        if receipt["hash"] != fingerprint:
            raise Problem(409, "IDEMPOTENCY_CONFLICT", "This command ID was used for different content.")
        return json.loads(receipt["result"]), True
    row = db.execute("SELECT * FROM daily_tasks WHERE id=? AND crew_id=?", (task_id, crew)).fetchone()
    if row is None:
        raise Problem(404, "NOT_FOUND", "This task is unavailable.")
    now = clock()
    changed = apply_action(db, row, action, now)
    result = {"task": publish_task(db, changed, now, action.commandId)}
    if changed["status"] in ("completed", "skipped"):
        publish_team(db, now.date())
    db.execute("INSERT INTO receipts VALUES(?,?,?,?,?)", (*key, fingerprint, encoded(result)))
    return result, False
