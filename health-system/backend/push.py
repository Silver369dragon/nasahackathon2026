"""Device subscriptions and durable Web Push delivery for crew emergencies."""
import asyncio
import base64
import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import requests
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi import FastAPI, Request
from pydantic import Field, field_validator
from pywebpush import WebPushException, webpush  # type: ignore[import-untyped]

from .models import Contract
from .store import Data, connection, digest, encoded

PUSH_SCHEMA = """
CREATE TABLE IF NOT EXISTS push_subscriptions(
    id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT UNIQUE NOT NULL, session TEXT NOT NULL
    REFERENCES sessions(token_hash) ON DELETE CASCADE, keys_json TEXT NOT NULL, lang TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_queue(
    emergency_id TEXT NOT NULL REFERENCES emergencies(id), subscription_id INTEGER NOT NULL
    REFERENCES push_subscriptions(id) ON DELETE CASCADE, attempts INTEGER NOT NULL DEFAULT 0,
    next_try INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(emergency_id,subscription_id));
"""
PROVIDERS = {"fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com",
             "push.services.mozilla.com", "notify.windows.com"}


class Keys(Contract):
    auth: str = Field(min_length=22, max_length=24, pattern=r"^[A-Za-z0-9_-]+=*$")
    p256dh: str = Field(min_length=87, max_length=88, pattern=r"^[A-Za-z0-9_-]+=*$")

    @field_validator("p256dh")
    @classmethod
    def valid_curve(cls, value: str) -> str:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), base64.urlsafe_b64decode(value + "=="))
        return value

    @field_validator("auth")
    @classmethod
    def valid_secret(cls, value: str) -> str:
        if len(base64.urlsafe_b64decode(value + "==")) != 16:
            raise ValueError("Invalid push auth key")
        return value


class Subscription(Contract):
    endpoint: str = Field(max_length=3072)
    keys: Keys
    lang: Literal["en", "zh-TW"]

    @field_validator("endpoint")
    @classmethod
    def vendor_endpoint(cls, value: str) -> str:
        url = urlsplit(value)
        host = url.hostname or ""
        if (url.scheme != "https" or url.username is not None or url.port not in (None, 443)
                or url.fragment or not url.path.strip("/") or "\\" in value
                or not any(host == domain or host.endswith("." + domain) for domain in PROVIDERS)):
            raise ValueError("Unsupported push service endpoint")
        return value


def encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def signing_keys(db: sqlite3.Connection) -> tuple[str, str]:
    row = db.execute("SELECT value FROM settings WHERE key='push_keys'").fetchone()
    if row is not None:
        private, public = json.loads(row[0])
        return private, public
    key = ec.generate_private_key(ec.SECP256R1())
    private = encode(key.private_numbers().private_value.to_bytes(32, "big"))
    public = encode(key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint))
    db.execute("INSERT INTO settings VALUES('push_keys',?)", (encoded([private, public]),))
    return private, public


def register_push(app: FastAPI, path: Path) -> None:
    from .main import SESSION, current, response

    @app.get("/v1/push/device")
    def device(request: Request):
        current(request)
        token = digest(request.cookies[SESSION])
        with connection(path, write=True) as db:
            _, public = signing_keys(db)
            enabled = db.execute("SELECT 1 FROM push_subscriptions WHERE session=?", (token,)).fetchone()
        return response({"publicKey": public, "enabled": bool(enabled)})

    @app.post("/v1/push/subscribe")
    def subscribe(request: Request, data: Subscription):
        current(request, write=True)
        token = digest(request.cookies[SESSION])
        with connection(path, write=True) as db:
            signing_keys(db)
            # Remove pending deliveries when this browser changes accounts or subscriptions.
            db.execute("DELETE FROM push_subscriptions WHERE (endpoint=? AND session!=?) OR (session=? AND endpoint!=?)",
                       (data.endpoint, token, token, data.endpoint))
            db.execute("""INSERT INTO push_subscriptions(endpoint,session,keys_json,lang) VALUES(?,?,?,?)
                          ON CONFLICT(endpoint) DO UPDATE SET keys_json=excluded.keys_json,lang=excluded.lang""",
                       (data.endpoint, token, data.keys.model_dump_json(), data.lang))
        return response({"enabled": True})

    @app.post("/v1/push/disable")
    def disable(request: Request):
        current(request, write=True)
        with connection(path, write=True) as db:
            db.execute("DELETE FROM push_subscriptions WHERE session=?", (digest(request.cookies[SESSION]),))
        return response({"enabled": False})


class NoRedirects(requests.Session):
    def post(self, url, *args, **kwargs):
        kwargs["allow_redirects"] = False
        return super().post(url, *args, **kwargs)


def dispatch(job: Data) -> int:
    payload = {k: job[k] for k in ("id", "crew", "source", "lang", "created", "recipient")}
    with NoRedirects() as session:
        try:
            webpush({"endpoint": job["endpoint"], "keys": json.loads(job["keys_json"])}, encoded(payload),
                    vapid_private_key=job["private"],
                    vapid_claims={"sub": os.getenv("HEALTH_PUSH_CONTACT", "mailto:crew-health@example.org")},
                    ttl=max(1, 120 - int((datetime.now(UTC) - datetime.fromisoformat(job["created"])).total_seconds())),
                    timeout=4, headers={"Urgency": "high"}, requests_session=session)
            return 201
        except WebPushException as exc:
            return exc.response.status_code if exc.response is not None else 503
        except requests.RequestException:
            return 503


def pending(path: Path) -> list[Data]:
    with connection(path) as db:
        rows = db.execute("""SELECT e.id,e.crew_id AS crew,e.source,e.created,p.id AS device,p.endpoint,
                            p.keys_json,p.lang,s.username AS recipient,q.attempts
                            FROM push_queue q JOIN emergencies e ON e.id=q.emergency_id
                            JOIN push_subscriptions p ON p.id=q.subscription_id JOIN sessions s ON s.token_hash=p.session
                            WHERE s.expires>unixepoch() AND q.next_try<=unixepoch()
                            AND unixepoch(e.created)>unixepoch()-120 ORDER BY q.next_try LIMIT 32""").fetchall()
        if not rows:
            return []
        private, _ = signing_keys(db)
        return [dict(row, private=private) for row in rows]


def deliver(path: Path, job: Data) -> None:
    status = dispatch(job)
    pair = (job["id"], job["device"])
    with connection(path, write=True) as db:
        if status in (404, 410):
            db.execute("DELETE FROM push_subscriptions WHERE id=? AND endpoint=?", (job["device"], job["endpoint"]))
        elif status == 429 or status >= 500:
            db.execute("""UPDATE push_queue SET attempts=attempts+1,next_try=unixepoch()+?
                          WHERE emergency_id=? AND subscription_id=?""", (min(30, 2 ** min(job["attempts"], 5)), *pair))
        else:
            db.execute("DELETE FROM push_queue WHERE emergency_id=? AND subscription_id=?", pair)


def prune(path: Path) -> None:
    with connection(path, write=True) as db:
        db.execute("DELETE FROM sessions WHERE expires<=unixepoch()")
        db.execute("DELETE FROM push_queue WHERE emergency_id IN "
                   "(SELECT id FROM emergencies WHERE unixepoch(created)<=unixepoch()-120)")


async def push_worker(path: Path) -> None:
    sweep = 0
    while True:
        try:
            if sweep % 120 == 0:
                await asyncio.to_thread(prune, path)
            jobs = await asyncio.to_thread(pending, path)
            await asyncio.gather(*(asyncio.to_thread(deliver, path, job) for job in jobs))
        except sqlite3.OperationalError:
            pass  # A busy database can be retried on the next sweep.
        sweep += 1
        await asyncio.sleep(0.5)
