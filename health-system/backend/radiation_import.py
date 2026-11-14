"""Validated synthetic history archives; imports never replace the active mission."""
import json
import re
import sqlite3
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    Field,
    StrictInt,
    field_serializer,
    field_validator,
    model_validator,
)

from .models import utc_text
from .radiation import Contract, EventType
from .radiation_store import mission, publish
from .store import CREW, Data, Problem, digest, encoded

Number = Annotated[Decimal, Field(ge=0, le=1_000_000_000_000, allow_inf_nan=False)]
RecordId = Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')]
TOLERANCE = Decimal('0.000000001')


def seconds_between(start, end) -> Decimal:
    delta = end - start
    return (Decimal(delta.days * 86400 + delta.seconds)
            + Decimal(delta.microseconds) / Decimal(1_000_000))


class SyntheticRecord(Contract):
    isSimulated: Literal[True]

    @field_validator('isSimulated', mode='before')
    @classmethod
    def synthetic_only(cls, value):
        if value is not True:
            raise ValueError('Only explicitly synthetic records are supported.')
        return value


class HistoricalExposure(SyntheticRecord):
    id: RecordId
    missionLabel: Annotated[str, Field(min_length=1, max_length=200)]
    startAt: AwareDatetime
    endAt: AwareDatetime
    exposureDays: Number
    referenceRateUsvH: Number
    doseEquivalentMsv: Number
    quantity: Literal['dose_equivalent_estimate'] = 'dose_equivalent_estimate'
    unit: Literal['mSv'] = 'mSv'
    comparabilityKey: Literal['demo-dose-equivalent-v1'] = 'demo-dose-equivalent-v1'

    @field_serializer('exposureDays', 'referenceRateUsvH', 'doseEquivalentMsv')
    def serialize_number(self, value: Decimal) -> float:
        return float(value)

    @model_validator(mode='after')
    def consistent_exposure(self):
        duration = seconds_between(self.startAt, self.endAt)
        if duration <= 0:
            raise ValueError('Historical exposure must end after its start.')
        if abs(self.exposureDays - duration / Decimal(86400)) > TOLERANCE:
            raise ValueError('exposureDays must match the historical interval.')
        expected = self.referenceRateUsvH * duration / Decimal(3_600_000)
        if abs(self.doseEquivalentMsv - expected) > TOLERANCE:
            raise ValueError('Historical dose must equal rate in uSv/h times hours divided by 1000.')
        return self


class HistoricalProfile(Contract):
    crewId: Literal['mira', 'kai', 'lin', 'noa', 'sol']
    experienceYears: Annotated[StrictInt, Field(ge=0, le=100)]
    history: Annotated[list[HistoricalExposure], Field(min_length=1, max_length=1000)]

    @model_validator(mode='after')
    def chronological_history(self):
        ids = [record.id for record in self.history]
        if len(set(ids)) != len(ids):
            raise ValueError('Historical record IDs must be unique per crew.')
        for previous, current in zip(self.history, self.history[1:]):
            if current.startAt < previous.endAt:
                raise ValueError('Historical intervals must be chronological and cannot overlap.')
        return self


class HistoricalEnvironmentPoint(SyntheticRecord):
    timestamp: AwareDatetime
    rateUsvH: Number
    cumulativeMsv: Number
    radiationEvent: EventType

    @field_serializer('rateUsvH', 'cumulativeMsv')
    def serialize_number(self, value: Decimal) -> float:
        return float(value)


class RadiationImport(Contract):
    profiles: Annotated[list[HistoricalProfile], Field(min_length=5, max_length=5)]
    environment: Annotated[list[HistoricalEnvironmentPoint], Field(min_length=2, max_length=100_000)]

    @model_validator(mode='after')
    def validate_history(self):
        if {profile.crewId for profile in self.profiles} != set(CREW):
            raise ValueError('Radiation profiles must contain each of the five crew exactly once.')
        now = datetime.now(UTC)
        if any(point.timestamp > now for point in self.environment):
            raise ValueError('Archived environment timestamps cannot be in the future.')
        for profile in self.profiles:
            for record in profile.history:
                if record.endAt > now:
                    raise ValueError('Historical exposure cannot end in the future.')
                if record.endAt > self.environment[0].timestamp:
                    raise ValueError('Historical exposure must be prior to the archived environment.')
        if self.environment[0].cumulativeMsv != 0:
            raise ValueError('The archived environment must start with zero cumulative dose.')
        for previous, current in zip(self.environment, self.environment[1:]):
            duration = seconds_between(previous.timestamp, current.timestamp)
            if duration <= 0:
                raise ValueError('Environment timestamps must be strictly chronological.')
            expected = previous.cumulativeMsv + previous.rateUsvH * duration / Decimal(3_600_000)
            if current.cumulativeMsv < previous.cumulativeMsv or abs(current.cumulativeMsv - expected) > TOLERANCE:
                raise ValueError('Environment cumulative dose must match the preceding rate interval.')
        return self


def archive_document(section: RadiationImport, dataset_id: str) -> Data:
    profiles = []
    for profile in section.profiles:
        document = profile.model_dump(mode='json')
        document.update(
            importedHistoryMsv=float(sum((row.doseEquivalentMsv for row in profile.history), Decimal(0))),
            importedHistoryDays=float(sum((row.exposureDays for row in profile.history), Decimal(0))),
        )
        profiles.append(document)
    return {'datasetId': dataset_id, 'isSimulated': True, 'profiles': profiles,
            'environment': [point.model_dump(mode='json') for point in section.environment],
            'historyMode': 'append', 'activeMissionPreserved': True}


def import_counts(section: RadiationImport) -> Data:
    return {'profiles': len(section.profiles),
            'historyRecords': sum(len(profile.history) for profile in section.profiles),
            'environmentSamples': len(section.environment)}


def apply_radiation_import(db: sqlite3.Connection, section: RadiationImport, dataset_id: str) -> Data:
    """Participate in the caller's transaction; require its radiation runtime lock."""
    if not db.in_transaction:
        raise ValueError('Radiation import requires an existing transaction.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', dataset_id):
        raise ValueError('Invalid dataset ID.')
    state = mission(db)
    if state is None:
        raise Problem(409, 'RADIATION_NOT_STARTED', 'Initialize radiation monitoring before importing history.')
    fingerprint = digest(section.model_dump_json())
    db.execute('CREATE TABLE IF NOT EXISTS radiation_import_archives('
               'dataset_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, document TEXT NOT NULL)')
    prior = db.execute('SELECT fingerprint FROM radiation_import_archives WHERE dataset_id=?', (dataset_id,)).fetchone()
    if prior:
        if prior[0] != fingerprint:
            raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'This dataset ID has different radiation history.')
        return import_counts(section)
    for profile in section.profiles:
        db.execute('UPDATE radiation_profiles SET experience_years=? WHERE crew_id=?',
                   (profile.experienceYears, profile.crewId))
        for record in profile.history:
            document = record.model_dump(mode='json')
            record_id = f'import:{dataset_id}:{profile.crewId}:{record.id}'
            document.update(id=record_id, crewId=profile.crewId, datasetId=dataset_id,
                            method='synthetic-historical-import-v1', modelVersion='synthetic-historical-import-v1',
                            startAt=utc_text(record.startAt), endAt=utc_text(record.endAt))
            db.execute('INSERT INTO radiation_history VALUES(?,?,?,?,?)',
                       (record_id, profile.crewId, document['startAt'], document['endAt'], encoded(document)))
    db.execute('INSERT INTO radiation_import_archives VALUES(?,?,?)',
               (dataset_id, fingerprint, encoded(archive_document(section, dataset_id))))
    state['version'] += 1
    publish(db, state, 'historical-import:' + dataset_id)
    return import_counts(section)


def read_radiation_import(db: sqlite3.Connection, dataset_id: str) -> Data:
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='radiation_import_archives'").fetchone()
    row = db.execute('SELECT document FROM radiation_import_archives WHERE dataset_id=?', (dataset_id,)).fetchone() if exists else None
    if row is None:
        raise Problem(404, 'NOT_FOUND', 'No archived radiation history exists for this dataset.')
    return json.loads(row[0])
