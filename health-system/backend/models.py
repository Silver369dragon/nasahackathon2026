"""Contracts shared by manual entry and registered synthetic devices."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictFloat,
    StrictInt,
    StrictStr,
    StringConstraints,
    field_validator,
    model_validator,
)

Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=180)]
MetricCode = Literal["heart_rate", "spo2", "blood_pressure_systolic", "blood_pressure_diastolic", "temperature"]
View = Literal["personal", "system", "system_display"]
BP = ("blood_pressure_systolic", "blood_pressure_diastolic")
UNITS = {"heart_rate": "bpm", "spo2": "%", **dict.fromkeys(BP, "mmHg"), "temperature": "Cel"}
CONTEXT_REQUIRED = {
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


class Metric(Contract):
    code: MetricCode
    value: StrictFloat | None
    unit: Identifier
    quality: Literal["good", "poor", "invalid", "missing"]
    qualityReason: Identifier | None = None
    missingReason: Identifier | None = None
    method: Identifier | None = None
    context: dict[str, Identifier | bool | None] = Field(default_factory=dict)
    measurementGroupId: Identifier | None = None

    @model_validator(mode="after")
    def validate_value(self):
        if self.unit != UNITS[self.code]:
            raise ValueError(f"{self.code} requires unit {UNITS[self.code]}")
        if self.quality == "missing":
            if self.value is not None or not (self.qualityReason or self.missingReason):
                raise ValueError("missing requires a null value and a reason")
            return self
        if self.value is None:
            raise ValueError("A null value requires missing quality")
        if self.quality in ("poor", "invalid") and not self.qualityReason:
            raise ValueError("Poor or invalid data requires a qualityReason")
        if self.code == "spo2" and not 0 <= self.value <= 100:
            raise ValueError("Percentage must be between 0 and 100")
        if self.code in ("heart_rate", *BP) and self.value < 0:
            raise ValueError("Value must be nonnegative")
        return self


class Batch(Contract):
    schemaVersion: Literal["1.2"]
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
        codes = [m.code for m in self.metrics]
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
    context: dict[str, Identifier | bool | None]

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


def check_context(code: str, context: dict[str, str | bool | None]) -> None:
    for key in CONTEXT_REQUIRED[code]:
        if not isinstance(context.get(key), str) or not context[key]:
            raise ValueError(f"{code} requires context.{key}")
