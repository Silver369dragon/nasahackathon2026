"""Contracts shared by manual entry and registered synthetic devices."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    StringConstraints,
    field_validator,
    model_validator,
)

Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=180)]
MetricCode = Literal["heart_rate", "spo2", "blood_pressure_systolic", "blood_pressure_diastolic",
                     "temperature", "respiratory_rate", "work_of_breathing"]
InputMetricCode = MetricCode | Literal["respiration_rate"]
Context = dict[str, Identifier | StrictFloat | StrictBool | None]
View = Literal["personal", "system", "system_display"]
BP = ("blood_pressure_systolic", "blood_pressure_diastolic")
LEGACY_UNITS = {"heart_rate": "bpm", "spo2": "%", **dict.fromkeys(BP, "mmHg"), "temperature": "Cel"}
UNITS = {**LEGACY_UNITS, "heart_rate": "/min", **dict.fromkeys(BP, "mm[Hg]"),
         "respiratory_rate": "/min", "work_of_breathing": "1"}


def canonical_code(code: str) -> str:
    return "respiratory_rate" if code == "respiration_rate" else code


def canonical_measurement(document: dict) -> dict:
    code = canonical_code(document["metricCode"])
    return {**document, "metricCode": code, "unit": UNITS.get(code, document["unit"]),
            "schemaVersion": "1.3"}
CONTEXT_REQUIRED = {
    "respiratory_rate": ("observationDuration",), "work_of_breathing": (),
    "heart_rate": ("activity",), "spo2": ("measurementSite",),
    **dict.fromkeys(BP, ("posture",)), "temperature": ("measurementSite", "temperatureType"),
}


def utc_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Login(Contract):
    username: Identifier
    password: Annotated[StrictStr, Field(max_length=1024)]


class WorkOfBreathing(Contract):
    dyspnea: Identifier | None = None
    accessoryMuscleUse: StrictBool | None = None
    speakingAbility: Identifier | None = None
    scaleId: Identifier | None = None
    scaleVersion: Identifier | None = None
    score: StrictFloat | None = None
    notes: Identifier | None = None

    @model_validator(mode="after")
    def validate_record(self):
        if not any(value is not None for value in
                   (self.dyspnea, self.accessoryMuscleUse, self.speakingAbility, self.score, self.notes)):
            raise ValueError("Work of breathing requires an observation or score")
        if self.score is not None and not (self.scaleId and self.scaleVersion):
            raise ValueError("A score requires scaleId and scaleVersion; clinical interpretation is not enabled")
        if bool(self.scaleId) != bool(self.scaleVersion):
            raise ValueError("scaleId and scaleVersion must be supplied together")
        return self


class Metric(Contract):
    code: InputMetricCode
    value: StrictFloat | WorkOfBreathing | None
    unit: Identifier
    quality: Literal["good", "poor", "invalid", "missing"]
    qualityReason: Identifier | None = None
    missingReason: Identifier | None = None
    method: Identifier | None = None
    context: Context = Field(default_factory=dict)
    measurementGroupId: Identifier | None = None

    @model_validator(mode="after")
    def validate_value(self):
        code = canonical_code(self.code)
        if self.unit not in (UNITS[code], LEGACY_UNITS.get(code)):
            raise ValueError(f"{code} requires unit {UNITS[code]}")
        if self.quality == "missing":
            if self.value is not None or not (self.qualityReason or self.missingReason):
                raise ValueError("missing requires a null value and a reason")
            return self
        if self.value is None:
            raise ValueError("A null value requires missing quality")
        if self.quality in ("poor", "invalid") and not self.qualityReason:
            raise ValueError("Poor or invalid data requires a qualityReason")
        if code == "work_of_breathing":
            if not isinstance(self.value, WorkOfBreathing):
                raise ValueError("work_of_breathing requires a structured record")
            return self
        if isinstance(self.value, WorkOfBreathing):
            raise ValueError("Numeric metrics require a number")  # noqa: TRY004 (Pydantic validation)
        if code == "spo2" and not 0 <= self.value <= 100:
            raise ValueError("Percentage must be between 0 and 100")
        if code in ("heart_rate", "respiratory_rate", *BP) and self.value < 0:
            raise ValueError("Value must be nonnegative")
        return self


class Batch(Contract):
    schemaVersion: Literal["1.2", "1.3"]
    runId: Identifier | None = None
    observedAt: AwareDatetime
    isSynthetic: Literal[True]
    measurementGroupId: Identifier | None = None
    metrics: list[Metric] = Field(min_length=1, max_length=100)

    @field_validator("observedAt", mode="before")
    @classmethod
    def require_iso_time(cls, value):
        if not isinstance(value, str):
            raise ValueError("observedAt requires an ISO 8601 timestamp")  # noqa: TRY004 (Pydantic validation)
        return value

    @field_validator("observedAt")
    @classmethod
    def check_clock_skew(cls, value: datetime) -> datetime:
        if value > datetime.now(UTC) + timedelta(seconds=30):
            raise ValueError("Observation time exceeds the 30-second training clock tolerance")
        return value

    @field_validator("isSynthetic", mode="before")
    @classmethod
    def require_synthetic(cls, value):
        if value is not True:
            raise ValueError("Only synthetic training measurements are supported")
        return value

    @model_validator(mode="after")
    def validate_group(self):
        for metric in self.metrics:
            units = LEGACY_UNITS if self.schemaVersion == "1.2" else UNITS
            code = metric.code if self.schemaVersion == "1.2" else canonical_code(metric.code)
            if code not in units or metric.unit != units[code]:
                raise ValueError(f"schema {self.schemaVersion} requires supported codes and units: {units}")
        codes = [canonical_code(m.code) for m in self.metrics]
        if len(set(codes)) != len(codes):
            raise ValueError("Metric codes must be unique within a packet")
        bp = [m for m in self.metrics if m.code in BP]
        if len(bp) == 1:
            raise ValueError("Both blood pressure components are required; mark an absent value missing")
        groups = {m.measurementGroupId for m in bp if m.measurementGroupId}
        if self.measurementGroupId:
            groups.add(self.measurementGroupId)
        if len(groups) > 1:
            raise ValueError("Blood pressure components must have the same group")
        return self


class ManualBatch(Batch):
    commandId: Identifier
    crewId: Identifier
    method: Identifier
    context: Context

    @model_validator(mode="after")
    def validate_manual_context(self):
        for m in self.metrics:
            if m.method or m.context:
                raise ValueError("Manual context and method are supplied at the packet level")
            if m.code in BP and not (self.measurementGroupId or m.measurementGroupId):
                raise ValueError("Manual blood pressure requires a measurementGroupId")
            check_context(m.code, self.context)
        return self


class Telemetry(Batch):
    messageId: Identifier
    deviceId: Identifier
    assignmentId: Identifier
    bootId: Identifier
    seq: Annotated[StrictInt, Field(ge=0, le=2**63 - 1)]
    deviceUptimeMs: Annotated[StrictInt, Field(ge=0)]
    clockStatus: Literal["synced", "unsynced", "estimated"]
    mode: Literal["training"]
    source: Literal["mock"]
    dataOrigin: Literal["synthetic"]
    transport: Literal["http"]
    scenarioId: None = None
    scenarioVersion: None = None
    scenarioTimeMs: None = None
    causationId: Identifier | None = None
    upstreamSampleId: Identifier | None = None
    deliveryKind: Literal["live", "backfill"]

    @model_validator(mode="after")
    def validate_device_context(self):
        for m in self.metrics:
            if not m.method:
                raise ValueError("Device metrics require a method")
            check_context(m.code, m.context)
        return self


def check_context(code: str, context: Context) -> None:
    code = canonical_code(code)
    if code == "respiratory_rate":
        duration = context.get("observationDuration")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration <= 0:
            raise ValueError("respiratory_rate requires a positive numeric context.observationDuration in seconds")
        return
    for key in CONTEXT_REQUIRED[code]:
        if not isinstance(context.get(key), str) or not context[key]:
            raise ValueError(f"{code} requires context.{key}")
