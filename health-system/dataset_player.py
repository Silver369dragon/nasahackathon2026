"""Validate and play a live-only crew dataset on the local server's clock."""
import argparse
import asyncio
import copy
import hashlib
import json
import math
import sys
import time
import zipfile
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from backend.credentials import mock_token
from backend.models import Telemetry, utc_text

CREW = ("mira", "kai", "lin", "noa", "sol")
Data = dict[str, Any]


def validate_scope(manifest: Data) -> None:
    if manifest.get("deliveryWindows") or [f["path"] for f in manifest["files"]] != ["live.jsonl"]:
        raise ValueError("This live-only player does not yet support history or deliveryWindows")
    if manifest.get("tickMs") != 1000 or manifest.get("playbackRate") != 1 or manifest.get("timeUnit") != "ms":
        raise ValueError("Playback requires one-second ticks at real-time speed")
    duration = manifest["liveDurationMs"]
    if type(duration) is not int or not 1000 <= duration <= 600000 or duration % 1000:
        raise ValueError("Invalid liveDurationMs")
    bindings = [{"crewId": c, "deviceId": f"mock-{c}", "assignmentId": f"assignment-{c}"} for c in CREW]
    if manifest["crew"] != bindings:
        raise ValueError("The five crew/device bindings do not match the medical system")


def load_dataset(archive: Path) -> Data:
    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
        if len(names) != len(set(names)) or sum(i.file_size for i in bundle.infolist()) > 20_000_000:
            raise ValueError("Duplicate ZIP entries or dataset too large")
        manifests = [n for n in names if n.endswith("/manifest.json") or n == "manifest.json"]
        if len(manifests) != 1:
            raise ValueError("Expected exactly one manifest.json")
        prefix = manifests[0][:-len("manifest.json")]
        checksums = {}
        for line in bundle.read(prefix + "SHA256SUMS.txt").decode("utf-8").splitlines():
            expected, name = line.split("  ", 1)
            if hashlib.sha256(bundle.read(prefix + name)).hexdigest() != expected:
                raise ValueError(f"SHA-256 mismatch: {name}")
            checksums[name] = expected
        if not {"manifest.json", "live.jsonl"} <= checksums.keys():
            raise ValueError("SHA-256 manifest must cover manifest.json and live.jsonl")
        manifest = json.loads(bundle.read(manifests[0]).decode("utf-8"))
        validate_scope(manifest)
        rows = [json.loads(line) for line in bundle.read(prefix + "live.jsonl").decode("utf-8").splitlines()]
    seconds = manifest["liveDurationMs"] // 1000
    expected_count = seconds * len(CREW)
    count = sum(len(row["metrics"]) for row in rows)
    declared = manifest["files"][0]
    if len(rows) != expected_count or declared["sampleCount"] != len(rows) or declared["metricCount"] != count:
        raise ValueError("Dataset sample/metric count does not match the manifest")
    for index, row in enumerate(rows):
        second, crew_index = divmod(index, len(CREW))
        crew = CREW[crew_index]
        if (row["crewId"], row["tMs"], row["sampleId"]) != (crew, second * 1000, f"{crew}:L:{second:06d}"):
            raise ValueError(f"Invalid crew, order, time or identity at line {index + 1}")
    dataset = {"manifest": manifest, "rows": rows, "checksums": checksums}
    # Validate every row against the actual receiver, anchored in the past.
    origin = datetime.now(UTC).replace(microsecond=0) - timedelta(seconds=seconds)
    for packet in build_packets(dataset, "validation", origin):
        Telemetry.model_validate(packet)
    return dataset


def build_packets(dataset: Data, playback_id: str, t0: datetime) -> list[Data]:
    packets = []
    for row in dataset["rows"]:
        crew = row["crewId"]
        seq = row["tMs"] // 1000 + 1
        boot = f"{playback_id}-{crew}-b1"
        metrics = copy.deepcopy(row["metrics"])
        for metric in metrics:
            if metric.get("measurementGroupId"):
                metric["measurementGroupId"] = playback_id + ":" + metric["measurementGroupId"]
        packets.append({
            "schemaVersion": dataset["manifest"]["telemetrySchemaVersion"], "runId": None,
            "messageId": f"mock-{crew}:{boot}:{seq}", "deviceId": f"mock-{crew}",
            "assignmentId": f"assignment-{crew}", "bootId": boot, "seq": seq,
            "observedAt": utc_text(t0 + timedelta(milliseconds=row["tMs"])),
            "deviceUptimeMs": row["tMs"] + 604800000, "clockStatus": "synced",
            "mode": "training", "source": "mock", "dataOrigin": "synthetic", "transport": "http",
            "isSynthetic": True, "deliveryKind": "live", "upstreamSampleId": playback_id + ":" + row["sampleId"],
            "metrics": metrics,
        })
    return packets


def describe(dataset: Data) -> Data:
    manifest = dataset["manifest"]
    warnings = ["Live-only sample: no seven-day history, alert, exercise, missing-data or disconnect acceptance."]
    if manifest["telemetrySchemaVersion"] == "1.2":
        warnings.append("Legacy schema 1.2: respiratory_rate and work_of_breathing are absent; no values are invented.")
    return {"datasetId": manifest["datasetId"], "datasetVersion": manifest["datasetVersion"],
            "telemetrySchemaVersion": manifest["telemetrySchemaVersion"],
            "durationMs": manifest["liveDurationMs"], "sampleCount": len(dataset["rows"]),
            "metricCount": sum(len(row["metrics"]) for row in dataset["rows"]),
            "hashesVerified": len(dataset["checksums"]), "checksums": dataset["checksums"], "warnings": warnings}


def emit(value: Data) -> None:
    print(json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)


async def send_packet(client: httpx.AsyncClient, packet: Data, row: Data, token: str,
                      report: Data, totals: Data, log) -> None:
    for attempt in range(1, 5):
        send_at = datetime.now(UTC)
        record = {"sampleId": row["sampleId"], "crewId": row["crewId"], "tMs": row["tMs"],
                  "seq": packet["seq"], "deliveryKind": packet["deliveryKind"], "attempt": attempt,
                  "sendAt": utc_text(send_at)}
        delay = [0.5, 1, 2, 2][attempt - 1]
        retryable = True
        try:
            reply = await client.post("/v1/telemetry", json=packet, headers={"Authorization": "Bearer " + token})
            body = reply.json()
            record.update(httpStatus=reply.status_code, requestId=body.get("requestId"),
                          acceptedAt=body.get("serverTime"), measurementIds=body.get("data", {}).get("measurementIds", []),
                          error=body.get("error"))
            success = reply.status_code == 201 or reply.status_code == 200 and body.get("meta", {}).get("replayed") is True
            retryable = reply.status_code in (408, 429) or reply.status_code >= 500
            if retryable and reply.headers.get("Retry-After", "").isdigit():
                delay = max(delay, float(reply.headers["Retry-After"]))
            if success:
                observed = datetime.fromisoformat(packet["observedAt"])
                accepted = datetime.fromisoformat(body["serverTime"])
                latency = (accepted - observed).total_seconds() * 1000
                record["latencyMs"] = round(latency, 3)
                report["accepted"] += 1
                report["acceptedMetrics"] += len(record["measurementIds"])
                totals["totalAccepted"] += 1
                totals["totalAcceptedMetrics"] += len(record["measurementIds"])
                report["latenciesMs"].append(latency)
                report["perCrew"][row["crewId"]] += 1
        except (httpx.HTTPError, ValueError) as error:
            success = False
            record.update(httpStatus=None, error=type(error).__name__)
        log.write(json.dumps(record, ensure_ascii=True) + "\n")
        log.flush()
        if success:
            return
        if not retryable or attempt == 4:
            raise RuntimeError(f"{row['sampleId']}: HTTP {record['httpStatus']} {record.get('error')}")
        report["retries"] += 1
        await asyncio.sleep(delay)


async def play(dataset: Data, url: str, output: Path, *, loop: bool = False) -> Data:
    tokens = {crew: mock_token(crew) for crew in CREW}
    async with httpx.AsyncClient(base_url=url, timeout=5, trust_env=False) as client:
        before = time.time()
        ready = await client.get("/v1/health/ready")
        ready.raise_for_status()
        server_time = datetime.fromisoformat(ready.json()["serverTime"]).timestamp()
        if abs(server_time - (before + time.time()) / 2) > 1:
            raise ValueError("Sender/receiver clocks differ by more than one second")
        origin = datetime.fromtimestamp(math.ceil(time.time()) + 1, UTC)
        start = time.monotonic() + origin.timestamp() - time.time()
        duration = dataset["manifest"]["liveDurationMs"] / 1000
        current_cycle = 0
        totals = {"totalAccepted": 0, "totalAcceptedMetrics": 0}
        pending: set[asyncio.Task] = set()
        output.mkdir(parents=True, exist_ok=True)

        async def play_cycle(cycle: int) -> Data:
            t0 = origin + timedelta(seconds=(cycle - 1) * duration)
            cycle_start = start + (cycle - 1) * duration
            playback_id = "p" + uuid4().hex
            packets = build_packets(dataset, playback_id, t0)
            report = {**describe(dataset), "playbackId": playback_id, "t0": utc_text(t0), "status": "playing",
                      "loop": loop, "cycle": cycle, "accepted": 0, "acceptedMetrics": 0, "elapsedMs": 0,
                      **totals,
                      "retries": 0, "lateSamples": 0, "latenciesMs": [], "timingWarning": None,
                      "perCrew": Counter({crew: 0 for crew in CREW})}
            result_path = output / f"{playback_id}.json"
            emit({k: v for k, v in report.items() if k != "latenciesMs"})
            with (output / f"{playback_id}.jsonl").open("w", encoding="utf-8") as log:
                try:
                    async with asyncio.TaskGroup() as tasks:
                        for offset in range(0, len(packets), len(CREW)):
                            row = dataset["rows"][offset]
                            deadline = cycle_start + row["tMs"] / 1000
                            await asyncio.sleep(max(0, deadline - time.monotonic()))
                            for packet, sample in zip(packets[offset:offset + 5], dataset["rows"][offset:offset + 5]):
                                if time.monotonic() - deadline >= 3:
                                    packet["deliveryKind"] = "backfill"
                                    report["lateSamples"] += 1
                                tasks.create_task(send_packet(client, packet, sample, tokens[sample["crewId"]], report, totals, log))
                            emit({"status": "playing", "elapsedMs": row["tMs"], "accepted": report["accepted"],
                                  "acceptedMetrics": report["acceptedMetrics"], "retries": report["retries"],
                                  **totals})
                    report["status"] = "completed"
                except (ExceptionGroup, OSError, ValueError, RuntimeError) as error:
                    detail = str(error.exceptions[0]) if isinstance(error, ExceptionGroup) else str(error)
                    report.update(status="failed", error=detail)
            report.update(totals)
            latencies = sorted(report.pop("latenciesMs"))
            report["maxLatencyMs"] = round(max(latencies, default=0), 3)
            report["p95LatencyMs"] = round(latencies[max(0, math.ceil(len(latencies) * .95) - 1)], 3) if latencies else None
            report["timingPassed"] = not report["lateSamples"] and report["maxLatencyMs"] < 1000
            if not report["timingPassed"]:
                report["timingWarning"] = "部分資料接收延遲超過一秒，延遲已記錄。"
                if not loop and report["status"] == "completed":
                    report.update(status="failed", error=report["timingWarning"])
            result_path.write_text(json.dumps(report, indent=2, ensure_ascii=True), encoding="utf-8")
            continuing = loop and report["status"] == "completed"
            if cycle == current_cycle or not continuing:
                emit({**report, "status": "playing" if continuing else report["status"]})
            else:
                # A late reply from an older cycle must not rewind the displayed cycle.
                emit({"status": "playing", **totals, "maxLatencyMs": report["maxLatencyMs"],
                      "p95LatencyMs": report["p95LatencyMs"], "timingPassed": report["timingPassed"],
                      "timingWarning": report["timingWarning"]})
            if loop and report["status"] == "failed":
                raise RuntimeError(report["error"])
            return report

        if not loop:
            current_cycle = 1
            return await play_cycle(1)

        try:
            async with asyncio.TaskGroup() as cycles:
                while True:
                    await asyncio.sleep(max(0, start + current_cycle * duration - time.monotonic()))
                    if len(pending) >= 3:
                        raise RuntimeError("Medical-system replies remain pending across three playback cycles")
                    current_cycle += 1
                    # Schedule the next cycle independently of earlier HTTP responses.
                    task = cycles.create_task(play_cycle(current_cycle))
                    pending.add(task)
                    task.add_done_callback(pending.discard)
        except ExceptionGroup as error:
            failure = {"status": "failed", "error": str(error.exceptions[0]), **totals}
            emit(failure)
            return failure


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--loop", action="store_true", help="Repeat the dataset with fresh timestamps and identities until stopped")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / ".qa" / "dataset-playback")
    args = parser.parse_args()
    try:
        dataset = load_dataset(args.dataset)
        if args.inspect:
            emit(describe(dataset))
            return 0
        report = asyncio.run(play(dataset, args.url, args.output, loop=args.loop))
        return 0 if report["status"] == "completed" else 1
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, httpx.HTTPError) as error:
        emit({"status": "failed", "error": str(error)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
