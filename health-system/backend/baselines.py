"""Immutable personal numeric baselines and ingestion-time analysis."""
import json
import math
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Request
from pydantic import AwareDatetime

from .models import Contract, Identifier, canonical_measurement, utc_text
from .store import Data, Problem, connection, digest, encoded, now_text

ALGORITHM = 'fixed-baseline-v2'
METRICS = frozenset(('heart_rate', 'spo2', 'respiratory_rate', 'blood_pressure_systolic',
                     'blood_pressure_diastolic', 'temperature'))
# Saved states that advance the displayed series; late/duplicate evidence stays explicitly readable.
REPRESENTATIVE_STATUSES = ('ready', 'unusable_quality')
SCHEMA = '''
CREATE INDEX IF NOT EXISTS measurement_metric_history ON measurements(crew_id,metric,observed,row_id);
CREATE TABLE IF NOT EXISTS fixed_baselines(
 id TEXT PRIMARY KEY, crew TEXT NOT NULL, series TEXT NOT NULL, document TEXT NOT NULL,
 UNIQUE(crew,series));
CREATE INDEX IF NOT EXISTS fixed_baseline_compact
 ON fixed_baselines(crew,series,json_remove(document,'$.sampleIds'));
CREATE TABLE IF NOT EXISTS fixed_analyses(
 id TEXT PRIMARY KEY, measurement TEXT UNIQUE NOT NULL, crew TEXT NOT NULL,
 baseline TEXT NOT NULL REFERENCES fixed_baselines(id), observed TEXT NOT NULL, document TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS fixed_analysis_series ON fixed_analyses(baseline,observed);
CREATE INDEX IF NOT EXISTS fixed_analysis_advancing ON fixed_analyses(baseline,observed)
 WHERE json_extract(document,'$.status') IN ('ready','unusable_quality');
CREATE TABLE IF NOT EXISTS baseline_commands(
 crew TEXT NOT NULL, command TEXT NOT NULL, hash TEXT NOT NULL, baseline TEXT NOT NULL,
 PRIMARY KEY(crew,command));
'''


def series_key(doc: Data) -> tuple:
    from .trends import series_key as key
    return key(doc.get('metricCode', 'heart_rate'), doc)


def series_token(doc: Data) -> str:
    # Preserve existing heart-rate identifiers; other metrics need their own namespace.
    metric = doc.get('metricCode', 'heart_rate')
    key = series_key(doc)
    return encoded(key if metric == 'heart_rate' else (metric, *key))


def baseline_for(db: sqlite3.Connection, crew: str, doc: Data, *, compact: bool = False) -> Data | None:
    if doc['provenance']['isSynthetic'] is not True:
        return None
    series = series_token(doc)
    if compact:
        projection = "json_remove(document,'$.sampleIds')"
        active = 'SELECT active_id FROM baseline_heads WHERE crew=? AND series=?'
        row = db.execute(f'SELECT {projection} FROM fixed_baselines INDEXED BY fixed_baseline_compact '
                         f'WHERE crew=? AND series=? AND id=({active}) UNION ALL '
                         f'SELECT {projection} FROM baseline_versions INDEXED BY baseline_version_compact '
                         f'WHERE crew=? AND series=? AND id=({active})', (crew, series) * 4).fetchone()
    else:
        row = db.execute('SELECT b.document FROM baseline_heads h JOIN baseline_records b ON b.id=h.active_id '
                         'WHERE h.crew=? AND h.series=?', (crew, series)).fetchone()
    return json.loads(row[0]) if row else None


def read(db: sqlite3.Connection, crew: str, ident: str, *, baseline: bool = False) -> Data:
    table = 'baseline_records' if baseline else 'analysis_records'
    row = db.execute(f'SELECT document FROM {table} WHERE id=? AND crew=?', (ident, crew)).fetchone()
    if not row:
        raise Problem(404, 'NOT_FOUND', 'Personal analysis record unavailable.')
    doc = json.loads(row[0])
    if not baseline:
        doc['baseline'] = read(db, crew, doc['baselineId'], baseline=True)
    return doc


def analysis_for(db: sqlite3.Connection, measurement: str) -> Data | None:
    row = db.execute('SELECT document FROM analysis_current WHERE measurement=?', (measurement,)).fetchone()
    return json.loads(row[0]) if row else None


def analysis_cadence(doc: Data) -> float:
    value = doc.get('context', {}).get('analysisCadenceSeconds', 1)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
        return float(value)
    return 1.0


def analysis_table(db: sqlite3.Connection, baseline_id: str) -> str:
    # Original baselines keep their indexed ingestion stream; revisions never advance it.
    legacy = db.execute('SELECT 1 FROM fixed_baselines WHERE id=?', (baseline_id,)).fetchone()
    return 'fixed_analyses' if legacy else 'analysis_revisions'


def previous_version_state(db: sqlite3.Connection, crew: str, sample: Data, baseline_id: str) -> tuple[Data | None, bool]:
    # Only used on version entry/same-second input, not on the normal cross-second hot path.
    newest = None
    representative = False
    bucket = datetime.fromisoformat(sample['observedAt']).replace(microsecond=0)
    run_id = sample.get('context', {}).get('demoRunId')
    versions = db.execute('SELECT id FROM baseline_records WHERE crew=? AND series=? AND id<>?',
                          (crew, series_token(sample), baseline_id)).fetchall()
    for version in versions:
        table = analysis_table(db, version['id'])
        revision_clause = 'AND revision=1 ' if table == 'analysis_revisions' else ''
        row = db.execute(f"SELECT document FROM {table} WHERE baseline=? {revision_clause}"
                         "AND json_extract(document,'$.status') IN ('ready','unusable_quality') "
                         "ORDER BY observed DESC,rowid DESC LIMIT 1", (version['id'],)).fetchone()
        if row:
            saved = json.loads(row[0])
            if newest is None or saved['observedAt'] > newest['observedAt']:
                newest = saved
        if sample['provenance']['source'] == 'mock' and not representative:
            representative = db.execute(f"SELECT 1 FROM {table} WHERE baseline=? {revision_clause}"
                "AND observed>=? AND observed<? AND json_extract(document,'$.status')='ready' "
                "AND json_extract(document,'$.demoRunId') IS ? LIMIT 1",
                (version['id'], utc_text(bucket), utc_text(bucket + timedelta(seconds=1)), run_id)).fetchone() is not None
    return newest, representative


def analyze(db: sqlite3.Connection, doc: Data, baseline: Data | None = None) -> Data | None:
    if doc['metricCode'] not in METRICS:
        return None
    crew = doc['subject']['id']
    baseline = baseline or baseline_for(db, crew, doc, compact=True)
    if not baseline or doc['observedAt'] < baseline['to']:
        return None
    existing = analysis_for(db, doc['id'])
    if existing:
        return existing
    table = analysis_table(db, baseline['id'])
    revision_clause = 'AND revision=1 ' if table == 'analysis_revisions' else ''
    row = db.execute(f"SELECT document FROM {table} WHERE baseline=? {revision_clause}"
                     "AND json_extract(document,'$.status') IN ('ready','unusable_quality') "
                     "ORDER BY observed DESC,rowid DESC LIMIT 1", (baseline['id'],)).fetchone()
    last = json.loads(row[0]) if row else None
    ordering_last = last
    prior_representative = False
    if baseline['version'] > 1 and (last is None or last['observedAt'][:19] == doc['observedAt'][:19]):
        prior_state, prior_representative = previous_version_state(db, crew, doc, baseline['id'])
        ordering_last = last or prior_state
    run_id = doc.get('context', {}).get('demoRunId')
    bucket = datetime.fromisoformat(doc['observedAt']).replace(microsecond=0)
    representative = db.execute(f"SELECT 1 FROM {table} WHERE baseline=? {revision_clause}AND observed>=? AND observed<? "
                                "AND json_extract(document,'$.status')='ready' "
                                "AND json_extract(document,'$.demoRunId') IS ? LIMIT 1",
                                (baseline['id'], utc_text(bucket), utc_text(bucket + timedelta(seconds=1)), run_id)).fetchone()
    segment = last['segmentId'] if last else str(uuid4())
    status, reason, z, ewma = 'ready', None, None, None
    instant = datetime.fromisoformat(doc['observedAt']).timestamp()
    cadence = analysis_cadence(doc)
    if ordering_last and doc['observedAt'] < ordering_last['observedAt']:
        status, reason = 'out_of_order', 'late_input_preserves_saved_state'
    elif doc['quality'] != 'good' or not isinstance(doc['value'], (int, float)):
        status, reason, segment = 'unusable_quality', 'missing_or_poor_quality', str(uuid4())
    elif baseline['source'] == 'mock' and (representative or prior_representative):
        status, reason = 'duplicate_bucket', 'first_valid_sample_per_utc_second'
    else:
        if last and (cadence != last.get('analysisCadenceSeconds', 1) or run_id != last.get('demoRunId')
                     or instant - datetime.fromisoformat(last['observedAt']).timestamp() > 4 * cadence):
            segment = str(uuid4())
        z = (doc['value'] - baseline['mean']) / baseline['sd']
        previous = last['ewma'] if last and last['status'] == 'ready' and segment == last['segmentId'] else None
        ewma = z if previous is None else .2 * z + .8 * previous
    result = {'id': str(uuid4()), 'crewId': crew, 'metricCode': doc['metricCode'], 'measurementId': doc['id'],
              'observedAt': doc['observedAt'], 'value': doc['value'], 'unit': doc['unit'], 'status': status,
              'reason': reason, 'baselineId': baseline['id'], 'baselineVersion': baseline['version'],
              'algorithmVersion': ALGORITHM, 'analysisCadenceSeconds': cadence, 'demoRunId': run_id,
              'z': z, 'ewma': ewma, 'segmentId': segment, 'createdAt': now_text()}
    if table == 'fixed_analyses':
        db.execute('INSERT INTO fixed_analyses VALUES(?,?,?,?,?,?)',
                   (result['id'], doc['id'], crew, baseline['id'], doc['observedAt'], encoded(result)))
    else:
        result['analysisRevision'] = 1
        db.execute('INSERT INTO analysis_revisions VALUES(?,?,?,?,?,?,1)',
                   (result['id'], doc['id'], crew, baseline['id'], doc['observedAt'], encoded(result)))
    db.execute("UPDATE measurements SET document=json_set(document,'$.analysisId',?) WHERE id=?",
               (result["id"], doc["id"]))
    return result


def candidate(db: sqlite3.Connection, crew: str, doc: Data, cutoff: datetime) -> Data:
    from .baseline_lifecycle import exclusions
    start = cutoff - timedelta(days=7)
    key = series_key(doc)
    omitted = exclusions(db, crew, series_token(doc))
    excluded_count = 0
    rows = db.execute('SELECT document FROM measurements WHERE crew_id=? AND metric=? AND observed>=? AND observed<? '
                      'ORDER BY observed,row_id', (crew, doc.get('metricCode', 'heart_rate'), utc_text(start), utc_text(cutoff)))
    samples, buckets = [], set()
    for row in rows:
        sample = canonical_measurement(json.loads(row[0]))
        if (series_key(sample) != key or sample['quality'] != 'good'
                or not isinstance(sample['value'], (int, float))):
            continue
        bucket = sample['observedAt'][:19]
        if doc['provenance']['source'] == 'mock' and bucket in buckets:
            continue
        buckets.add(bucket)
        if any(item['from'] <= sample['observedAt'] < item['to'] for item in omitted):
            excluded_count += 1
            continue
        samples.append(sample)
    values = [s['value'] for s in samples]
    mean = sum(values) / len(values) if values else None
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1)) if len(values) > 1 else None
    return {'from': utc_text(start), 'to': utc_text(cutoff), 'count': len(values), 'mean': mean, 'sd': sd,
            'sampleIds': [s['id'] for s in samples], 'excludedCount': excluded_count}


class CreateBaseline(Contract):
    commandId: Identifier
    measurementId: Identifier
    referenceTo: AwareDatetime


def create(db: sqlite3.Connection, crew: str, body: CreateBaseline) -> tuple[Data, bool]:
    fingerprint = digest(encoded(body.model_dump(mode='json')))
    prior = db.execute('SELECT hash,baseline FROM baseline_commands WHERE crew=? AND command=?',
                       (crew, body.commandId)).fetchone()
    if prior:
        if prior['hash'] != fingerprint:
            raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'This command has different content.')
        return read(db, crew, prior['baseline'], baseline=True), True
    if body.referenceTo.year <= 1:
        raise Problem(422, 'INVALID_REFERENCE', 'Reference cutoff must allow a seven-day history.')
    if body.referenceTo > datetime.now(UTC):
        raise Problem(422, 'FUTURE_REFERENCE', 'Reference cutoff must not be in the future.')
    row = db.execute('SELECT document FROM measurements WHERE id=? AND crew_id=?',
                     (body.measurementId, crew)).fetchone()
    if not row:
        raise Problem(404, 'NOT_FOUND', 'Owned numeric measurement required.')
    sample = canonical_measurement(json.loads(row[0]))
    if sample['metricCode'] not in METRICS:
        raise Problem(422, 'NON_NUMERIC_METRIC', 'Fixed baselines require a numeric vital sign.')
    if sample['provenance']['isSynthetic'] is not True or sample.get('mode', 'training') != 'training':
        raise Problem(422, 'PROFILE_REQUIRED', 'Real measurements require a separately approved baseline profile.')
    if db.execute('SELECT 1 FROM baseline_heads WHERE crew=? AND series=?', (crew, series_token(sample))).fetchone():
        raise Problem(409, 'BASELINE_EXISTS', 'The series already has an immutable baseline.')
    stats = candidate(db, crew, sample, body.referenceTo)
    if stats['count'] < 30 or stats['sd'] is None or stats['sd'] <= 1e-9:
        raise Problem(422, 'INSUFFICIENT_BASELINE', 'At least 30 valid samples with nonzero sample deviation are required.')
    from .baseline_lifecycle import PROFILE, register_legacy
    p = sample['provenance']
    baseline = {'id': str(uuid4()), 'version': 1, 'crewId': crew, 'metricCode': sample['metricCode'], **stats,
                'source': p['source'], 'method': sample['method'], 'origin': p['dataOrigin'],
                'synthetic': p['isSynthetic'], 'unit': sample['unit'], 'context': dict(series_key(sample)[-1]),
                'algorithmVersion': ALGORITHM, 'createdAt': now_text(), 'profile': PROFILE}
    db.execute('INSERT INTO fixed_baselines VALUES(?,?,?,?)',
               (baseline['id'], crew, series_token(sample), encoded(baseline)))
    register_legacy(db, baseline, series_token(sample))
    db.execute('INSERT INTO baseline_commands VALUES(?,?,?,?)', (crew, body.commandId, fingerprint, baseline['id']))
    rows = db.execute('SELECT document FROM measurements WHERE crew_id=? AND metric=? AND observed>=? ORDER BY observed,row_id',
                      (crew, sample['metricCode'], baseline['to'])).fetchall()
    for row in rows:
        doc = canonical_measurement(json.loads(row[0]))
        if series_key(doc) == series_key(sample):
            analyze(db, doc, baseline)
    return baseline, False


def register_baselines(app: FastAPI, path: Path) -> None:
    from .baseline_lifecycle import register_lifecycle
    from .main import current, require_workspace, response
    register_lifecycle(app, path)

    def owner(request: Request, write: bool = False) -> str:
        user = current(request, write=write)
        require_workspace(request.query_params.get('runId'))
        if not user['crewId'] or 'crew' not in user['roles']:
            raise Problem(403, 'FORBIDDEN', 'Personal baseline requires a crew account.')
        return user['crewId']

    @app.post('/v1/baselines')
    def save(request: Request, body: CreateBaseline):
        crew = owner(request, True)
        with connection(path, write=True) as db:
            result, replayed = create(db, crew, body)
            return response(result, 200 if replayed else 201, replayed=replayed)

    @app.get('/v1/baselines/{ident}')
    def baseline(request: Request, ident: str):
        crew = owner(request)
        with connection(path) as db:
            return response(read(db, crew, ident, baseline=True))

    @app.get('/v1/analyses/{ident}')
    def analysis(request: Request, ident: str):
        crew = owner(request)
        with connection(path) as db:
            return response(read(db, crew, ident))
