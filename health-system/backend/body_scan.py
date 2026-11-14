"""Owner-scoped immutable synthetic body scans; separate from vital-sign telemetry."""
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import FastAPI, Query, Request
from pydantic import AwareDatetime, Field, StrictFloat, model_validator

from .models import Contract, Identifier, utc_text
from .store import (
    CREW,
    Data,
    Problem,
    connection,
    cursor_position,
    cursor_token,
    encoded,
)

RegionCode = Literal[
    'head', 'neck', 'chest', 'abdomen', 'pelvis', 'back',
    'left_shoulder', 'right_shoulder', 'left_upper_arm', 'right_upper_arm',
    'left_forearm', 'right_forearm', 'left_hand', 'right_hand',
    'left_thigh', 'right_thigh', 'left_knee', 'right_knee',
    'left_lower_leg', 'right_lower_leg', 'left_foot', 'right_foot',
]
Preset = Literal['baseline', 'training_strain', 'recovery', 'partial']
Mass = Annotated[StrictFloat, Field(ge=0, le=500)]
SCHEMA = """
CREATE TABLE IF NOT EXISTS body_scans(
    id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crew(id),
    observed TEXT NOT NULL, request_id TEXT NOT NULL, preset TEXT NOT NULL,
    document TEXT NOT NULL, UNIQUE(crew_id,request_id)
);
CREATE INDEX IF NOT EXISTS body_scan_history ON body_scans(crew_id,observed DESC,id DESC);
"""


class Totals(Contract):
    bodyMassKg: Mass | None
    muscleMassKg: Mass | None
    fatMassKg: Mass | None

    @model_validator(mode='after')
    def validate_mass(self):
        if self.bodyMassKg is not None:
            if any(v is not None and v > self.bodyMassKg for v in (self.muscleMassKg, self.fatMassKg)):
                raise ValueError('A tissue mass cannot exceed whole-body mass')
            if (self.muscleMassKg is not None and self.fatMassKg is not None
                    and self.muscleMassKg + self.fatMassKg > self.bodyMassKg):
                raise ValueError('Muscle and fat cannot exceed whole-body mass')
        return self


class RegionReading(Contract):
    muscleMassKg: Mass | None
    fatMassKg: Mass | None
    quality: Literal['good', 'poor', 'missing']
    missingReason: Identifier | None

    @model_validator(mode='after')
    def validate_quality(self):
        if self.quality == 'good' and (self.muscleMassKg is None or self.fatMassKg is None):
            raise ValueError('Good regional readings require both values')
        if self.quality != 'good' and not self.missingReason:
            raise ValueError('Unavailable or poor readings require a reason')
        if self.quality == 'missing' and (self.muscleMassKg is not None or self.fatMassKg is not None):
            raise ValueError('Missing readings must contain null values')
        return self


class Finding(Contract):
    id: Identifier
    regionCode: RegionCode
    kind: Literal['strain', 'bruise', 'abrasion']
    severity: Literal['mild', 'moderate', 'severe']
    status: Literal['active', 'recovering', 'resolved']
    onsetAt: AwareDatetime
    functionalImpact: Identifier


class BodyScan(Contract):
    id: Identifier
    crewId: Identifier
    schemaVersion: Literal['body-scan/1'] = 'body-scan/1'
    runId: None = None
    mode: Literal['training'] = 'training'
    synthetic: Literal[True] = True
    source: Literal['mock'] = 'mock'
    method: Literal['orbital-bioscan-v1'] = 'orbital-bioscan-v1'
    observedAt: AwareDatetime
    receivedAt: AwareDatetime
    totals: Totals
    regions: dict[RegionCode, RegionReading]
    findings: list[Finding]


class DemoCommand(Contract):
    requestId: Identifier
    preset: Preset


def demo_enabled() -> bool:
    return os.getenv('HEALTH_BODY_SCAN_DEMO', '0') == '1'


def make_scan(crew: str, preset: Preset, onset: str | None = None) -> Data:
    """Fixed presets define a fictional scan, without deriving injuries from masses."""
    now = datetime.now(UTC)
    person = CREW.index(crew)
    muscle = 32.4 + person * 1.2 + {'baseline': 0, 'training_strain': -.4, 'recovery': .3, 'partial': 0}[preset]
    fat = 14.8 + person * .7 + {'baseline': 0, 'training_strain': -.2, 'recovery': -.6, 'partial': 0}[preset]
    weights = {'head': .018, 'neck': .012, 'chest': .14, 'abdomen': .07, 'pelvis': .08, 'back': .13}
    for side in ('left_', 'right_'):
        for part, weight in {'shoulder': .023, 'upper_arm': .025, 'forearm': .017, 'hand': .006,
                             'thigh': .135, 'knee': .005, 'lower_leg': .045, 'foot': .008}.items():
            weights[side + part] = weight
    total = sum(weights.values())
    fat_weights = {key: value * (1.7 if key in ('abdomen', 'pelvis') else .8 if 'arm' in key else 1)
                   for key, value in weights.items()}
    fat_total = sum(fat_weights.values())
    regions: Data = {key: {'muscleMassKg': round(muscle * weight / total, 3),
                           'fatMassKg': round(fat * fat_weights[key] / fat_total, 3),
                           'quality': 'good', 'missingReason': None} for key, weight in weights.items()}
    findings = []
    if preset in ('training_strain', 'recovery'):
        findings.append({'id': crew + '-demo-thigh', 'regionCode': 'left_thigh', 'kind': 'strain',
                         'severity': 'moderate' if preset == 'training_strain' else 'mild',
                         'status': 'active' if preset == 'training_strain' else 'recovering',
                         'onsetAt': onset or utc_text(now - timedelta(days=1)),
                         'functionalImpact': 'reduced_load' if preset == 'training_strain' else 'improving_mobility'})
    if preset == 'partial':
        regions['left_forearm'] = {'muscleMassKg': None, 'fatMassKg': None,
                                   'quality': 'missing', 'missingReason': 'scan_obstructed'}
        regions['back']['quality'] = 'poor'
        regions['back']['missingReason'] = 'motion'
    scan = BodyScan.model_validate({'id': str(uuid4()), 'crewId': crew, 'observedAt': now,
        'receivedAt': now, 'totals': {'bodyMassKg': 70.2 + person * 2.1, 'muscleMassKg': muscle,
                                     'fatMassKg': fat}, 'regions': regions, 'findings': findings})
    return scan.model_dump(mode='json')


def register_body_scans(app: FastAPI, path: Path) -> None:
    from .main import current, require_workspace, response

    def owner(request: Request, write: bool = False) -> str:
        user = current(request, write=write)
        require_workspace(request.query_params.get('runId'))
        if not user['crewId'] or 'crew' not in user['roles']:
            raise Problem(403, 'FORBIDDEN', 'Body scans are private to the crew member.')
        return user['crewId']

    @app.get('/v1/body-scans/latest')
    def latest(request: Request):
        crew = owner(request)
        with connection(path) as db:
            row = db.execute('SELECT document FROM body_scans WHERE crew_id=? ORDER BY observed DESC,id DESC LIMIT 1',
                             (crew,)).fetchone()
        return response({'scan': json.loads(row[0]) if row else None, 'demoEnabled': demo_enabled()})

    @app.get('/v1/body-scans')
    def history(request: Request, limit: Annotated[int, Query(ge=1, le=50)] = 20, cursor: str | None = None):
        crew = owner(request)
        args: list = [crew]
        query = 'SELECT document,observed,id FROM body_scans WHERE crew_id=?'
        scope = ['body-scans', crew]
        if cursor:
            try:
                position = cursor_position(app.state.secret, scope, cursor)
            except Problem as exc:
                raise Problem(400, 'INVALID_CURSOR', 'The history cursor is invalid.') from exc
            if not isinstance(position, list) or len(position) != 2 or not all(isinstance(p, str) for p in position):
                raise Problem(400, 'INVALID_CURSOR', 'The history cursor is invalid.')
            query += ' AND (observed,id) < (?,?)'
            args.extend(position)
        args.append(limit + 1)
        with connection(path) as db:
            rows = db.execute(query + ' ORDER BY observed DESC,id DESC LIMIT ?', args).fetchall()
        page = rows[:limit]
        next_cursor = cursor_token(app.state.secret, scope, [page[-1]['observed'], page[-1]['id']]) if len(rows) > limit else None
        return response({'items': [json.loads(row['document']) for row in page], 'nextCursor': next_cursor})

    @app.get('/v1/body-scans/{ident}')
    def one(request: Request, ident: str):
        crew = owner(request)
        with connection(path) as db:
            row = db.execute('SELECT document FROM body_scans WHERE crew_id=? AND id=?', (crew, ident)).fetchone()
        if not row:
            raise Problem(404, 'NOT_FOUND', 'This scan is unavailable.')
        return response({'scan': json.loads(row[0])})

    @app.post('/v1/body-scans/demo')
    def save_demo(request: Request, body: DemoCommand):
        crew = owner(request, write=True)
        if not demo_enabled():
            raise Problem(403, 'BODY_DEMO_DISABLED', 'Synthetic scans are disabled on this server.')
        with connection(path, write=True) as db:
            prior = db.execute('SELECT preset,document FROM body_scans WHERE crew_id=? AND request_id=?',
                               (crew, body.requestId)).fetchone()
            if prior:
                if prior['preset'] != body.preset:
                    raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'This request has different scan settings.')
                return response({'scan': json.loads(prior['document'])}, replayed=True)
            last = db.execute('SELECT document FROM body_scans WHERE crew_id=? AND preset IN (?,?) '
                              'ORDER BY observed DESC,id DESC LIMIT 1',
                              (crew, 'training_strain', 'recovery')).fetchone()
            previous_findings = json.loads(last[0])['findings'] if last else []
            onset = previous_findings[0]['onsetAt'] if previous_findings else None
            scan = make_scan(crew, body.preset, onset)
            db.execute('INSERT INTO body_scans VALUES(?,?,?,?,?,?)',
                       (scan['id'], crew, scan['observedAt'], body.requestId, body.preset, encoded(scan)))
        return response({'scan': scan}, 201)
