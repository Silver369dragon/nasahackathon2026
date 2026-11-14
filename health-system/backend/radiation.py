"""Synthetic dose-equivalent contracts; no clinical thresholds or vital-sign effects."""
import math
from datetime import timedelta
from decimal import Decimal, localcontext
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    model_validator,
)

from .store import Data

COMPARABILITY = 'demo-dose-equivalent-v1'
MODEL = 'shared-cabin-exposure-v1'
EventType = Literal['background', 'elevated_exposure', 'radiation_event']
Number = Annotated[Decimal, Field(ge=0, allow_inf_nan=False)]
Identifier = Annotated[str, Field(min_length=1, max_length=128)]


def integrate_dose(rate_usv_h: Decimal, elapsed_ms: int) -> Decimal:
    if not rate_usv_h.is_finite() or rate_usv_h < 0 or elapsed_ms < 0:
        raise ValueError('Dose integration requires a finite nonnegative rate and duration.')
    with localcontext() as context:
        context.prec = 28
        return rate_usv_h * Decimal(elapsed_ms) / Decimal(3_600_000_000)


def history_total(records: list[Data]) -> Data:
    compatible = [r for r in records if r.get('quantity') == 'dose_equivalent_estimate'
                  and r.get('unit') == 'mSv' and r.get('comparabilityKey') == COMPARABILITY]
    complete = bool(records) and len(compatible) == len(records)
    total = sum((Decimal(str(r['doseEquivalentMsv'])) for r in compatible), Decimal(0))
    return {'historyMsv': float(total) if complete else None,
            'knownHistoryMsv': float(total) if compatible else None,
            'historyDays': sum(r['exposureDays'] for r in compatible),
            'historyStatus': 'complete' if complete else 'partial' if compatible else 'unknown'}


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RadiationSample(Contract):
    timestamp: AwareDatetime
    missionElapsedMs: Annotated[StrictInt, Field(ge=0, le=9_007_199_254_740_991)]
    radiation_rate_usv_h: Number | None
    cumulative_radiation_msv: Number | None = None
    radiation_event: EventType
    is_simulated: Literal[True]
    missingReason: Annotated[str, Field(max_length=200)] | None = None

    @model_validator(mode='after')
    def serializable_numbers(self):
        for value in (self.radiation_rate_usv_h, self.cumulative_radiation_msv):
            if value is not None and not math.isfinite(float(value)):
                raise ValueError('The number must fit a finite JSON number.')
        try:
            self.timestamp - timedelta(milliseconds=self.missionElapsedMs)
        except OverflowError:
            raise ValueError('Mission time is outside the timestamp range.') from None
        return self


class SampleCommand(Contract):
    schemaVersion: Literal['radiation/1'] = 'radiation/1'
    missionId: Identifier
    sourceId: Identifier
    messageId: Identifier
    sample: RadiationSample


class RadiationEventAction(Contract):
    commandId: Identifier
    expectedControlVersion: Annotated[StrictInt, Field(ge=0)]
    action: Literal['start', 'end']
    preset: Literal['elevated', 'spe'] | None = None
    eventId: Identifier | None = None

    @model_validator(mode='after')
    def action_fields(self):
        if self.action == 'start' and (self.preset is None or self.eventId is not None):
            raise ValueError('Start requires a preset and no eventId.')
        if self.action == 'end' and (self.eventId is None or self.preset is not None):
            raise ValueError('End requires an eventId and no preset.')
        return self


class RadiationSnapshot(Contract):
    schemaVersion: Literal['radiation/1'] = 'radiation/1'
    missionId: str
    version: int
    controlVersion: int
    startedAt: str
    elapsedMs: int
    checkpointAt: str
    serverTime: str
    mode: Literal['training'] = 'training'
    isSimulated: Literal[True] = True
    sourceMode: Literal['simulation', 'json']
    environment: Data
    sharedExposure: Data
    crewExposure: list[Data]
    activeEvent: Data | None
    recentRatePoints: list[Data]


def project_radiation(snapshot: Data, view: str, crew_id: str | None) -> Data:
    people = snapshot['crewExposure']
    if view == 'system_display':
        people = []
    elif view == 'personal':
        people = [p for p in people if p['crewId'] == crew_id]
    return {**snapshot, 'crewExposure': people}
