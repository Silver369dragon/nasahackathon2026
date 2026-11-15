"""Persistent demonstration metadata; clinical records stay in their existing tables."""
import json
import sqlite3

from .store import Data, encoded

SCHEMA = '''
CREATE TABLE IF NOT EXISTS demo_config(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_profiles(crew_id TEXT PRIMARY KEY REFERENCES crew(id),document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_payload(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL);
'''


def initialize_demo(db: sqlite3.Connection) -> None:
    # execute separately: executescript would implicitly commit a caller transaction.
    for statement in SCHEMA.split(';'):
        if statement.strip():
            db.execute(statement)


def load_config(db: sqlite3.Connection) -> Data | None:
    row = db.execute('SELECT document FROM demo_config WHERE id=1').fetchone()
    return json.loads(row[0]) if row else None


def save_config(db: sqlite3.Connection, document: Data) -> None:
    db.execute('INSERT OR REPLACE INTO demo_config VALUES(1,?)', (encoded(document),))


def latest_run(db: sqlite3.Connection) -> Data | None:
    row = db.execute('SELECT document FROM demo_runs ORDER BY rowid DESC LIMIT 1').fetchone()
    return json.loads(row[0]) if row else None


def save_run(db: sqlite3.Connection, document: Data) -> None:
    db.execute('INSERT INTO demo_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,document=excluded.document',
               (document['id'], document['status'], encoded(document)))


def other_source_blocked(db: sqlite3.Connection) -> bool:
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='demo_runs'").fetchone()
    return bool(exists and db.execute("SELECT 1 FROM demo_runs WHERE status='playing'").fetchone())
