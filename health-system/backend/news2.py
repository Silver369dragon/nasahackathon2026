"""Versioned scoring records for explicitly grouped synthetic NEWS2 observations."""
import json
import math
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Request
from pydantic import (
    AwareDatetime,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    field_validator,
    model_validator,
)

from .models import Contract, Identifier, canonical_measurement, utc_text
from .news2_scoring import configuration, score_inputs
from .store import Data, Problem, append_event, connection, digest, encoded, now_text

SCHEMA = """
CREATE TABLE IF NOT EXISTS news2_versions(
    crew TEXT NOT NULL REFERENCES crew(id), id TEXT NOT NULL, version INTEGER NOT NULL,
    command TEXT NOT NULL, hash TEXT NOT NULL, observed TEXT NOT NULL, document TEXT NOT NULL,
    PRIMARY KEY(crew,id,version), UNIQUE(crew,command));
CREATE INDEX IF NOT EXISTS news2_history ON news2_versions(crew,observed DESC,id,version DESC);
"""
VITALS = Literal["heart_rate", "spo2", "blood_pressure_systolic", "temperature", "respiratory_rate"]
LABELS = {
    "respiratory_rate": ("respiratory rate", "呼吸頻率"), "spo2": ("oxygen saturation", "血氧飽和度"),
    "spo2_scale": ("prescribed SpO₂ scale", "適用血氧尺度"),
    "blood_pressure_systolic": ("systolic pressure", "收縮壓"), "heart_rate": ("heart rate", "心率"),
    "neurological_assessment": ("consciousness", "意識狀態"), "temperature": ("temperature", "體溫"),
    "supplemental_oxygen": ("supplemental oxygen status", "補氧／給氧狀態"),
}
DETAILS = {
    "observationSeconds": ("breathing observation duration", "呼吸觀察秒數"),
    "temperatureSite": ("temperature site", "體溫量測部位"),
    "temperatureMethod": ("temperature method", "體溫量測方法"),
    "scale2Documented": ("documented clinical selection of Scale 2", "尺度 2 的醫療指定紀錄"),
}
# This is a grouping tolerance for linked training records, not a clinical assessment interval.
LINK_WINDOW = timedelta(minutes=5)


class Inputs(Contract):
    respiratory_rate: Annotated[StrictFloat, Field(ge=0)] | None = None
    observationSeconds: Annotated[StrictFloat, Field(gt=0)] | None = None
    spo2: Annotated[StrictFloat, Field(ge=0, le=100)] | None = None
    blood_pressure_systolic: Annotated[StrictFloat, Field(ge=0)] | None = None
    heart_rate: Annotated[StrictFloat, Field(ge=0)] | None = None
    temperature: StrictFloat | None = None
    temperatureSite: Literal["oral", "axillary", "tympanic"] | None = None
    temperatureMethod: Identifier | None = None
    spo2_scale: Literal["scale1", "scale2"] | None = None
    scale2Documented: StrictBool | None = None
    neurological_assessment: Literal["A", "C", "V", "P", "U"] | None = None
    supplemental_oxygen: StrictBool | None = None


class SaveAssessment(Contract):
    id: Identifier
    commandId: Identifier
    expectedVersion: Annotated[StrictInt, Field(ge=0)]
    observedAt: AwareDatetime
    inputs: Inputs
    measurementIds: dict[VITALS, Identifier] = Field(default_factory=dict)
    poorQuality: list[Literal["respiratory_rate", "spo2", "blood_pressure_systolic",
                              "heart_rate", "temperature"]] = Field(default_factory=list, max_length=5)

    @field_validator("observedAt")
    @classmethod
    def valid_time(cls, value: datetime) -> datetime:
        if value > datetime.now(UTC) + timedelta(seconds=30):
            raise ValueError("Observation time is in the future")
        return value

    @model_validator(mode="after")
    def check_sources(self):
        if any(getattr(self.inputs, field) is not None for field in self.measurementIds):
            raise ValueError("Choose one source per vital sign")
        if (self.inputs.scale2Documented is not None and self.inputs.spo2_scale != "scale2"):
            raise ValueError("Scale 2 documentation requires Scale 2")
        return self


def summaries(db: sqlite3.Connection, crew: str | None = None) -> list[Data]:
    # Updating an older observation never makes it a crew member's latest assessment.
    rows = db.execute("""SELECT document FROM (
        SELECT document,row_number() OVER (PARTITION BY crew ORDER BY observed DESC,rowid DESC) AS pos
        FROM news2_versions WHERE (? IS NULL OR crew=?)) WHERE pos=1""", (crew, crew))
    return [summary(json.loads(row[0])) for row in rows]


def summary(item: Data) -> Data:
    public = {k: item[k] for k in ("id", "crewId", "version", "observedAt", "updatedAt", "assessmentStatus",
                                   "missingInputs", "invalidInputs", "missingDetails", "news2Score", "validCount")}
    public["vitalReadings"] = {k: item["effectiveInputs"][k] for k in
                               ("respiratory_rate", "spo2", "blood_pressure_systolic", "heart_rate", "temperature")
                               if item["effectiveInputs"][k] is not None and k not in item["invalidInputs"]}
    # Historical documents remain historical: never infer a score while reading.
    public.update({k: item[k] for k in ("requestedProfile", "ruleSetVersion", "normalizationVersion",
                                      "configurationIssues", "componentScores", "scoringInputs",
                                      "singleHighParameters", "riskBand", "interpretationVersion",
                                      "scoringSource", "interpretationSource") if k in item})
    return public


def read(db: sqlite3.Connection, crew: str, ident: str, version: int | None = None) -> Data:
    row = db.execute("""SELECT document FROM news2_versions WHERE crew=? AND id=?
                        AND (? IS NULL OR version=?) ORDER BY version DESC LIMIT 1""",
                     (crew, ident, version, version)).fetchone()
    if not row:
        raise Problem(404, "NOT_FOUND", "Assessment unavailable.")
    return json.loads(row[0])


def assess(db: sqlite3.Connection, crew: str, body: SaveAssessment) -> Data:
    inputs = body.inputs.model_dump()
    effective = dict(inputs)
    evidence = {}
    invalid: dict[str, str] = {}
    for field, ident in body.measurementIds.items():
        row = db.execute("SELECT document FROM measurements WHERE crew_id=? AND id=? AND metric=?",
                         (crew, ident, field)).fetchone()
        if not row:
            raise Problem(422, "INVALID_MEASUREMENT", "A linked measurement is unavailable for this field.")
        m = canonical_measurement(json.loads(row[0]))
        effective[field] = m["value"]
        evidence[field] = {k: m[k] for k in ("id", "value", "unit", "observedAt", "method", "quality")}
        evidence[field]["source"] = m["provenance"]["source"]
        if field == "respiratory_rate":
            duration = m["context"].get("observationDuration")
            usable = (not isinstance(duration, bool) and isinstance(duration, (int, float))
                      and math.isfinite(duration) and duration > 0)
            effective["observationSeconds"] = duration if usable else None
            evidence[field]["observationSeconds"] = effective["observationSeconds"]
        if field == "temperature":
            effective["temperatureSite"] = m["context"].get("measurementSite")
            effective["temperatureMethod"] = m["method"]
        if m["quality"] != "good" or m["value"] is None:
            invalid[field] = "unusable_quality"
        elif abs(datetime.fromisoformat(m["observedAt"]) - body.observedAt) > LINK_WINDOW:
            invalid[field] = "outside_training_window"
    for poor_field in body.poorQuality:
        if effective[poor_field] is not None:
            invalid.setdefault(poor_field, "unusable_quality")
    missing = [k for k in LABELS if effective[k] is None and k not in invalid]
    details = []
    if effective["respiratory_rate"] is not None and not effective["observationSeconds"]:
        details.append("observationSeconds")
        invalid.setdefault("respiratory_rate", "missing_context")
    if effective["temperature"] is not None:
        for k in ("temperatureSite", "temperatureMethod"):
            if not effective[k]:
                details.append(k)
                invalid.setdefault("temperature", "missing_context")
    if effective["spo2_scale"] == "scale2" and effective["scale2Documented"] is not True:
        details.append("scale2Documented")
        invalid["spo2_scale"] = "missing_context"
    scoring = score_inputs(effective, invalid, complete=not missing and not invalid)
    status = "incomplete" if missing or invalid else "scored" if scoring["news2Score"] is not None else "configuration_required"
    return {"assessmentType": "news2", "id": body.id, "crewId": crew, "version": body.expectedVersion + 1,
            "observedAt": utc_text(body.observedAt), "updatedAt": now_text(), "source": "manual",
            "isSynthetic": True, "inputs": inputs, "effectiveInputs": effective, "linkedRecords": evidence,
            "measurementIds": body.measurementIds, "poorQuality": body.poorQuality,
            "assessmentStatus": status,
            "missingInputs": missing, "invalidInputs": list(invalid), "invalidReasons": invalid,
            "missingDetails": details, "validCount": len(LABELS) - len(missing) - len(invalid),
            **scoring, "consciousnessScaleVersion": "RCP-ACVPU-2017"}


def register_news2(app: FastAPI, path: Path) -> None:
    from .main import current, require_workspace, response

    def owner(request: Request, write: bool = False) -> str:
        user = current(request, write=write)
        require_workspace(request.query_params.get("runId"))
        if not user["crewId"]:
            raise Problem(403, "FORBIDDEN", "Personal assessment access requires a crew account.")
        return user["crewId"]

    @app.get("/v1/news2")
    def history(request: Request):
        crew = owner(request)
        with connection(path) as db:
            rows = db.execute("""SELECT document FROM (
                SELECT document, observed, rowid AS seq,
                       row_number() OVER (PARTITION BY id ORDER BY version DESC) AS pos
                FROM news2_versions WHERE crew=?) WHERE pos=1 ORDER BY observed DESC,seq DESC""", (crew,))
            return response({"items": [summary(json.loads(row[0])) for row in rows]})

    @app.get("/v1/news2/config/current")
    def config(request: Request):
        owner(request)
        return response(configuration())

    @app.get("/v1/news2/{ident}")
    def one(request: Request, ident: str, version: int | None = None):
        crew = owner(request)
        with connection(path) as db:
            return response(read(db, crew, ident, version))

    @app.post("/v1/news2")
    def save(request: Request, body: SaveAssessment):
        crew = owner(request, write=True)
        signature = digest(encoded(body.model_dump(mode="json")))
        with connection(path, write=True) as db:
            prior = db.execute("SELECT hash,document FROM news2_versions WHERE crew=? AND command=?",
                               (crew, body.commandId)).fetchone()
            if prior:
                if prior["hash"] != signature:
                    raise Problem(409, "IDEMPOTENCY_CONFLICT", "The command has different content.")
                return response(json.loads(prior["document"]), replayed=True)
            version = db.execute("SELECT COALESCE(MAX(version),0) FROM news2_versions WHERE crew=? AND id=?",
                                 (crew, body.id)).fetchone()[0]
            if version != body.expectedVersion:
                raise Problem(409, "VERSION_CONFLICT", "The assessment changed. Reload to edit the latest version.")
            if version and utc_text(body.observedAt) != read(db, crew, body.id)["observedAt"]:
                raise Problem(422, "OBSERVATION_CHANGED", "A different observation requires a new assessment.")
            item = assess(db, crew, body)
            db.execute("INSERT INTO news2_versions VALUES(?,?,?,?,?,?,?)", (crew, body.id, item["version"],
                       body.commandId, signature, item["observedAt"], encoded(item)))
            latest, = summaries(db, crew)
            append_event(db, crew, "news2.updated", latest, latest["version"], latest["id"], body.commandId)
        return response(item, 201 if version == 0 else 200)
