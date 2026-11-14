"""Durable crew emergency broadcasts for manual calls and sensor alerts."""
import sqlite3
from typing import Literal
from uuid import uuid4

from .store import Data, append_event, digest, now_text

EmergencySource = Literal["manual", "sensor"]
EMERGENCY_SCHEMA = """
CREATE TABLE IF NOT EXISTS emergencies(
    id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crew(id),
    source TEXT NOT NULL CHECK(source IN ('manual','sensor')),
    key_hash TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(crew_id,source,key_hash)
);
"""


def broadcast(row: sqlite3.Row) -> Data:
    return {"id": row["id"], "crewId": row["crew_id"], "source": row["source"], "createdAt": row["created"]}


def publish_emergency(db: sqlite3.Connection, crew: str, source: EmergencySource, key: str) -> Data:
    """Persist one signal and its SSE frame in the caller's write transaction."""
    key_hash = digest(key)
    row = db.execute("""INSERT INTO emergencies(id,crew_id,source,key_hash,created) VALUES(?,?,?,?,?)
                        ON CONFLICT(crew_id,source,key_hash) DO NOTHING RETURNING *""",
                     (str(uuid4()), crew, source, key_hash, now_text())).fetchone()
    if row is None:
        prior = db.execute("SELECT * FROM emergencies WHERE crew_id=? AND source=? AND key_hash=?",
                           (crew, source, key_hash)).fetchone()
        return broadcast(prior)
    item = broadcast(row)
    append_event(db, crew, "emergency.created", item, 1, item["id"], item["id"])
    db.execute("""INSERT INTO push_queue(emergency_id, subscription_id)
                  SELECT ?, p.id FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session
                  WHERE s.expires>unixepoch() AND (?='sensor' OR s.username!=?)""", (item["id"], source, crew))
    return item


def list_emergencies(db: sqlite3.Connection) -> list[Data]:
    return [broadcast(row) for row in db.execute("SELECT * FROM emergencies ORDER BY rowid DESC LIMIT 50")]
