"""One atomic, monitor-owned import for synthetic historical demonstration data."""
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Request
from pydantic import AwareDatetime, Field, model_validator

from .body_import import BodyImport, apply_body_import
from .models import Contract, Identifier, Metric, Telemetry, utc_text
from .radiation_import import (
    RadiationImport,
    apply_radiation_import,
    read_radiation_import,
)
from .radiation_runtime import RadiationRuntime
from .radiation_store import ensure_radiation_started
from .store import Data, Problem, connection, digest, encoded, write_measurements

CrewId = Literal['mira', 'kai', 'lin', 'noa', 'sol']


class ImportedMeasurement(Contract):
    id: Identifier
    crewId: CrewId
    observedAt: AwareDatetime
    metrics: Annotated[list[Metric], Field(min_length=1, max_length=7)]

    def packet(self, dataset_id: str, seq: int) -> Telemetry:
        identity = digest(dataset_id + ':' + self.crewId)
        metrics = [m.model_dump(mode='json') for m in self.metrics]
        for metric in metrics:
            if metric.get('measurementGroupId'):
                metric['measurementGroupId'] = digest(dataset_id + ':' + str(metric['measurementGroupId']))
        return Telemetry.model_validate({
            'schemaVersion': '1.3', 'messageId': digest(dataset_id + ':' + self.id),
            'deviceId': 'mock-' + self.crewId, 'assignmentId': 'assignment-' + self.crewId,
            'bootId': identity, 'seq': seq, 'deviceUptimeMs': 0, 'clockStatus': 'synced',
            'mode': 'training', 'source': 'mock', 'dataOrigin': 'synthetic', 'transport': 'http',
            'isSynthetic': True, 'deliveryKind': 'backfill', 'observedAt': utc_text(self.observedAt),
            'upstreamSampleId': digest(dataset_id + ':' + self.id), 'metrics': metrics})


class DatasetImport(Contract):
    schemaVersion: Literal['crew-dataset/1']
    datasetId: Annotated[str, Field(min_length=1, max_length=80, pattern=r'^[a-zA-Z0-9][a-zA-Z0-9_-]*$')]
    radiation: RadiationImport | None = None
    body: BodyImport | None = None
    measurements: Annotated[list[ImportedMeasurement], Field(max_length=16000)] = Field(default_factory=list)

    @model_validator(mode='after')
    def validate_dataset(self):
        if self.radiation is None and self.body is None and not self.measurements:
            raise ValueError('Provide radiation, body or measurements')
        ids = [row.id for row in self.measurements]
        if len(ids) != len(set(ids)):
            raise ValueError('Measurement IDs must be unique')
        now = datetime.now(UTC)
        for seq, row in enumerate(self.measurements, 1):
            if row.observedAt > now:
                raise ValueError('Import historical observations only; future playback is not supported')
            row.packet(self.datasetId, seq)
        return self


def register_dataset_import(app: FastAPI, path: Path, runtime: RadiationRuntime) -> None:
    from .main import current, response

    def monitor(request: Request, write: bool = False):
        user = current(request, write=write)
        if 'monitor' not in user['roles']:
            raise Problem(403, 'FORBIDDEN', 'Only monitoring staff may import or inspect datasets.')
        return user

    @app.post('/v1/datasets/import')
    def import_dataset(request: Request, body: DatasetImport):
        monitor(request, write=True)
        raw = encoded(body.model_dump(mode='json'))
        fingerprint = digest(raw)
        initial_anchor = runtime.monotonic_ms()
        with runtime.lock, connection(path, write=True) as db:
            from .demo_store import other_source_blocked
            if other_source_blocked(db):
                raise Problem(409, 'DEMO_SOURCE_ACTIVE', 'Stop the demonstration before importing another dataset.')
            db.execute('CREATE TABLE IF NOT EXISTS dataset_imports(id TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL)')
            prior = db.execute('SELECT hash,result FROM dataset_imports WHERE id=?', (body.datasetId,)).fetchone()
            if prior:
                if prior['hash'] != fingerprint:
                    raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'This dataset ID already has different content. Use a new ID for new data.')
                return response(json.loads(prior['result']), replayed=True)
            result: Data = {'datasetId': body.datasetId, 'measurements': 0, 'radiation': None, 'body': None}
            if body.radiation is not None:
                mode = os.getenv('HEALTH_RADIATION_SOURCE', 'simulation')
                if mode not in ('simulation', 'json'):
                    raise Problem(503, 'RADIATION_CONFIG_INVALID', 'Unknown radiation source configuration.')
                ensure_radiation_started(db, datetime.now(UTC), mode, os.getenv('HEALTH_RADIATION_SOURCE_ID', 'demo'))
                result['radiation'] = apply_radiation_import(db, body.radiation, body.datasetId)
            if body.body is not None:
                result['body'] = apply_body_import(db, body.body, body.datasetId)
            for seq, row in enumerate(body.measurements, 1):
                packet = row.packet(body.datasetId, seq)
                write_measurements(db, packet, packet.deviceId, row.crewId, False)
                result['measurements'] += len(row.metrics)
            db.execute('INSERT INTO dataset_imports VALUES(?,?,?)', (body.datasetId, fingerprint, encoded(result)))
        if body.radiation is not None:
            with runtime.lock:
                if runtime.anchor is None:
                    runtime.anchor = initial_anchor
        return response(result, 201)

    @app.get('/v1/datasets/radiation')
    def imported_radiation(request: Request, datasetId: str):
        monitor(request)
        with connection(path) as db:
            return response(read_radiation_import(db, datasetId))
