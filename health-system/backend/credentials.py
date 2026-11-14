"""Per-device credentials shared by the local API and its synthetic telemetry client."""

import hashlib
import hmac
import os
import secrets
import tempfile
import time
from pathlib import Path


def _key_path() -> Path:
    database = os.environ.get("HEALTH_DB_PATH")
    if database and database != ":memory:":
        return Path(database).expanduser().resolve().with_name("mock-device.key")
    local_data = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_DATA_HOME")
    root = Path(local_data) if local_data else Path.home() / ".local" / "share"
    return root / "NasaHealthSystem" / "mock-device.key"


def _installation_secret() -> bytes:
    configured = os.environ.get("HEALTH_MOCK_SECRET")
    if configured:
        return configured.encode("utf-8")

    key_path = _key_path()
    try:
        secret = _read_key(key_path)
    except FileNotFoundError:
        key_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, candidate_path = tempfile.mkstemp(dir=key_path.parent)
        try:
            with os.fdopen(descriptor, "wb") as candidate:
                candidate.write(secrets.token_bytes(32))
                candidate.flush()
                os.fsync(candidate.fileno())
            # Publish a complete key once, even when API and adapter start together.
            try:
                if os.name == "nt":
                    # Windows rename refuses to replace an existing destination.
                    os.rename(candidate_path, key_path)
                else:
                    os.link(candidate_path, key_path)
            except FileExistsError:
                pass
        finally:
            Path(candidate_path).unlink(missing_ok=True)
        secret = _read_key(key_path)
    if len(secret) != 32:
        raise ValueError(f"Invalid local mock device key at {key_path}")
    return secret


def _read_key(path: Path) -> bytes:
    # A concurrent Windows rename can briefly deny reads of the published file.
    deadline = time.monotonic() + 1
    while True:
        try:
            return path.read_bytes()
        except PermissionError:
            if os.name != "nt" or time.monotonic() >= deadline:
                raise
            time.sleep(0.01)


def mock_token(crew_id: str) -> str:
    message = f"health-telemetry-v1:mock-{crew_id}".encode()
    return hmac.new(_installation_secret(), message, hashlib.sha256).hexdigest()
