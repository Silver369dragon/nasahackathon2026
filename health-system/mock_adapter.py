"""Send synthetic crew measurements to the local training telemetry endpoint."""

import argparse
import http.client
import json
import sys
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import SplitResult, urlsplit
from uuid import uuid4

from backend.credentials import mock_token

CREW = ("mira", "kai", "lin", "noa", "sol")
SCENARIOS = ("stable", "high", "recovery", "missing", "offline")
DEFAULT_URL = "http://127.0.0.1:8000"


def metric(code: str, value: float | None, unit: str, **context: str | float) -> dict[str, Any]:
    item = {
        "code": code, "value": value, "unit": unit, "method": "mock_generated",
        "quality": "good", "qualityReason": None, "context": context,
    }
    if value is None:
        item.update(quality="missing", qualityReason="synthetic_signal_loss", missingReason="synthetic_signal_loss")
    return item


def build_packet(crew_id: str, scenario: str, boot_id: str, seq: int, observed_at: str) -> dict[str, Any]:
    """Construct one immutable-on-delivery sample; the clock is supplied by the adapter."""
    offset = CREW.index(crew_id)
    if scenario not in ("stable", "high", "recovery", "missing"):
        raise ValueError(f"Scenario {scenario!r} does not produce samples")
    device = f"mock-{crew_id}"
    message_id = f"{device}:{boot_id}:{seq}"
    heart_rate: int | None = 70 + offset * 2 + seq % 3
    if crew_id == "mira":
        if scenario == "high":
            heart_rate = 112
        elif scenario == "missing":
            heart_rate = None
    metrics = [
        metric("heart_rate", heart_rate, "/min", activity="rest"),
        metric("spo2", 97 + offset % 3, "%", measurementSite="finger"),
        metric("temperature", round(36.6 + offset / 10, 1), "Cel", measurementSite="oral", temperatureType="oral"),
    ]
    respiration = metric("respiratory_rate", None if scenario == "missing" and crew_id == "mira" else 16,
                         "/min", observationDuration=60)
    if respiration["value"] is None:
        respiration.update(qualityReason="sensor_not_responding", missingReason="sensor_not_responding")
    effort = metric("work_of_breathing", None, "1")
    effort.update(qualityReason="scale_not_configured", missingReason="scale_not_configured")
    metrics.extend((respiration, effort))
    if crew_id != "mira":
        for code, value in (("systolic", 117 + offset), ("diastolic", 74 + offset)):
            component = metric(f"blood_pressure_{code}", value, "mm[Hg]", posture="seated")
            component["measurementGroupId"] = f"{message_id}:bp"
            metrics.append(component)
    return {
        "schemaVersion": "1.3", "messageId": message_id, "runId": None, "deviceId": device,
        "assignmentId": f"assignment-{crew_id}", "bootId": boot_id, "seq": seq,
        "observedAt": observed_at, "deviceUptimeMs": (seq - 1) * 1000, "clockStatus": "synced",
        "mode": "training", "source": "mock", "dataOrigin": "synthetic", "transport": "http",
        "isSynthetic": True, "scenarioId": None, "scenarioVersion": None, "scenarioTimeMs": None,
        "causationId": f"mock-start-{boot_id}", "upstreamSampleId": message_id,
        "deliveryKind": "live", "metrics": metrics,
    }


def endpoint(value: str) -> SplitResult:
    url = urlsplit(value)
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
        raise argparse.ArgumentTypeError("Use an HTTP(S) API URL without embedded credentials")
    if url.query or url.fragment or url.path.rstrip("/") not in ("", "/v1/telemetry"):
        raise argparse.ArgumentTypeError("Use the API base URL or the full /v1/telemetry URL")
    try:
        _ = url.port
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error
    return url


def post(endpoint_url: SplitResult, token: str, body: bytes) -> None:
    transport = http.client.HTTPSConnection if endpoint_url.scheme == "https" else http.client.HTTPConnection
    for attempt in range(3):
        connection = transport(endpoint_url.hostname or "", endpoint_url.port, timeout=5)
        try:
            connection.request("POST", "/v1/telemetry", body=body, headers={
                "Content-Type": "application/json", "Authorization": f"Bearer {token}",
            })
            response = connection.getresponse()
            detail = response.read(1500).decode("utf-8", errors="replace")
            if response.status in (200, 201):
                return
            if response.status not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise RuntimeError(f"Telemetry rejected (HTTP {response.status}): {detail}")
        except (OSError, http.client.HTTPException) as error:
            if attempt == 2:
                raise RuntimeError(f"Telemetry unavailable: {error}") from error
        finally:
            connection.close()
        time.sleep(0.25 * (2**attempt))


def positive_integer(value: str) -> int:
    count = int(value)
    if count < 1:
        raise argparse.ArgumentTypeError("Tick count must be positive")
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", type=endpoint, default=DEFAULT_URL, help=f"API base URL (default {DEFAULT_URL})")
    parser.add_argument("--scenario", choices=SCENARIOS, default="stable",
                        help="high/recovery default to three samples; offline sends no packets")
    duration = parser.add_mutually_exclusive_group()
    duration.add_argument("--once", action="store_true", help="Send one tick for the crew")
    duration.add_argument("--ticks", type=positive_integer, help="Stop after this many ticks")
    parser.add_argument("--replay", action="store_true", help="Resend each identical packet to test deduplication")
    args = parser.parse_args()
    if args.scenario == "offline":
        print("Offline scenario: no telemetry is sent. Stop any other running adapter.")
        return 0

    ticks = 1 if args.once else args.ticks
    if ticks is None and args.scenario in ("high", "recovery"):
        ticks = 3
    boot_id = uuid4().hex
    try:
        tokens = {crew: mock_token(crew) for crew in CREW}
        started = time.monotonic()
        origin = datetime.now(UTC)
        slot = 0
        sent = 0
        while ticks is None or sent < ticks:
            # Anchor synthetic samples to the 1 Hz clock; skip elapsed slots after a real stall.
            remaining = started + slot - time.monotonic()
            if remaining > 0:
                time.sleep(remaining)
            slot = max(slot, int(time.monotonic() - started))
            observed = origin + timedelta(seconds=slot)
            observed_at = observed.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            for crew, token in tokens.items():
                packet = build_packet(crew, args.scenario, boot_id, slot + 1, observed_at)
                body = json.dumps(packet, separators=(",", ":"), allow_nan=False).encode()
                post(args.url, token, body)
                if args.replay:
                    post(args.url, token, body)
            print(f"{observed_at} {args.scenario} tick {slot + 1}: {len(CREW)} synthetic packets accepted", flush=True)
            sent += 1
            slot += 1
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Mock adapter stopped: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
