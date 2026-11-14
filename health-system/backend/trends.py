"""Personal, source-separated training trends over the selected observation period."""
import json
import math
import sqlite3
from datetime import UTC, datetime, timedelta
from itertools import groupby
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Query, Request
from pydantic import AwareDatetime

from .models import CONTEXT_REQUIRED, MetricCode, utc_text
from .store import Data, Problem, connection


def series_key(metric: str, doc: Data) -> tuple:
    p = doc["provenance"]
    fields = dict.fromkeys((*CONTEXT_REQUIRED[metric], "activity", "measurementSite"))
    context = tuple((k, doc["context"][k]) for k in fields if doc["context"].get(k))
    return p["source"], doc["method"], p["isSynthetic"], p["dataOrigin"], doc["unit"], context


def readings(db: sqlite3.Connection, crew: str, metric: str, start: datetime, end: datetime):
    rows = db.execute("""SELECT document FROM measurements WHERE crew_id=? AND metric=?
                         AND observed>=? AND observed<? ORDER BY observed,row_id""",
                      (crew, metric, utc_text(start), utc_text(end)))
    documents = (json.loads(row[0]) for row in rows)
    for _, bucket in groupby(documents, lambda doc: doc["observedAt"][:19]):
        # Preserve manual ordering. For a continuous series, use one representative per UTC second.
        continuous: dict[tuple, Data] = {}
        for doc in bucket:
            key = series_key(metric, doc)
            if key[0] != "mock":
                yield key, doc
            elif doc["quality"] == "good" or key not in continuous or continuous[key]["quality"] != "good":
                continuous[key] = doc
        yield from continuous.items()


class Reference:
    def __init__(self):
        self.count = 0
        self.mean = self.sum_squares = 0.0

    def add(self, value: float):
        self.count += 1
        delta = value - self.mean
        self.mean += delta / self.count
        self.sum_squares += delta * (value - self.mean)

    @property
    def deviation(self) -> float:
        return math.sqrt(max(0.0, self.sum_squares) / (self.count - 1)) if self.count > 1 else 0.0


class Series:
    def __init__(self, key: tuple, ref: Reference):
        self.key, self.ref = key, ref
        self.count = self.valid = self.segment = 0
        self.last_valid: float | None = None
        self.latest: Data | None = None
        self.ewma: float | None = None
        self.z: float | None = None
        self.buckets: dict[int, list[Data]] = {}

    def add(self, doc: Data, instant: float, slot: int):
        self.count += 1
        good = doc["quality"] == "good" and doc["value"] is not None
        point = {k: doc[k] for k in ("id", "observedAt", "quality", "value")}
        self.latest = point
        if not good:
            self.last_valid = self.ewma = self.z = None
            self.segment += 1
            return
        if self.key[0] == "mock" and self.last_valid is not None and int(instant) - int(self.last_valid) > 4:
            self.segment += 1
            self.ewma = None
        self.last_valid = instant
        self.valid += 1
        point["segment"] = self.segment
        value = doc["value"]
        if self.ref.count >= 30 and self.ref.deviation > 1e-9:
            self.z = (value - self.ref.mean) / self.ref.deviation
            self.ewma = self.z if self.ewma is None else .2 * self.z + .8 * self.ewma
        # Preserve endpoints and extremes of each display bucket, with their original IDs.
        b = self.buckets.setdefault(slot, [point, point, point, point])
        if value < b[1]["value"]:
            b[1] = point
        if value > b[2]["value"]:
            b[2] = point
        b[3] = point

    def document(self) -> Data:
        source, method, synthetic, origin, unit, context = self.key
        points = {p["id"]: p for bucket in self.buckets.values() for p in bucket}
        return {"source": source, "method": method, "synthetic": synthetic, "origin": origin,
                "unit": unit, "context": dict(context), "count": self.count, "valid": self.valid,
                "points": sorted(points.values(), key=lambda p: p["observedAt"]), "latest": self.latest,
                "reference": {"count": self.ref.count, "mean": self.ref.mean if self.ref.count else None,
                              "sd": self.ref.deviation if self.ref.count >= 2 else None,
                              "z": self.z, "ewma": self.ewma}}


def personal_trends(db: sqlite3.Connection, crew: str, metric: str, start: datetime, end: datetime) -> Data:
    baseline_start = start - timedelta(days=7)
    baseline: dict[tuple, Reference] = {}
    for key, doc in readings(db, crew, metric, baseline_start, start):
        if doc["quality"] == "good" and doc["value"] is not None:
            baseline.setdefault(key, Reference()).add(doc["value"])
    series: dict[tuple, Series] = {}
    width = (end - start).total_seconds() / 120
    epoch = start.timestamp()
    for key, doc in readings(db, crew, metric, start, end):
        if key not in series:
            series[key] = Series(key, baseline.get(key) or Reference())
        instant = datetime.fromisoformat(doc["observedAt"]).timestamp()
        series[key].add(doc, instant, int((instant - epoch) / width))
    return {"from": utc_text(start), "to": utc_text(end), "referenceFrom": utc_text(baseline_start),
            "referenceTo": utc_text(start), "algorithmVersion": "training-window-v1",
            "series": [group.document() for group in series.values()]}


def register_trends(app: FastAPI, path: Path) -> None:
    from .main import current, require_workspace, response

    @app.get("/v1/trends")
    def trends(request: Request, metricCode: MetricCode, period: Literal["1h","24h","7d","30d","custom"] = "24h",
               start: Annotated[AwareDatetime | None, Query(alias="from")] = None,
               end: Annotated[AwareDatetime | None, Query(alias="to")] = None,
               crewId: str | None = None, runId: str | None = None):
        crew = current(request)["crewId"]
        if not crew or (crewId and crewId != crew):
            raise Problem(403, "FORBIDDEN", "Personal trends require the signed-in crew member.")
        require_workspace(runId)
        if period != "custom":
            end = datetime.now(UTC)
            start = end - timedelta(hours={"1h":1,"24h":24,"7d":168,"30d":720}[period])
        if start is None or end is None or start >= end or start.year <= 1:
            raise Problem(422, "INVALID_RANGE", "Choose a valid start and end time.")
        with connection(path) as db:
            return response(personal_trends(db, crew, metricCode, start, end))
