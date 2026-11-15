"""Explicit, audited training baseline lifecycle; fixed evidence is never overwritten."""
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, Request
from pydantic import AwareDatetime, Field

from .models import Contract, Identifier, canonical_measurement, utc_text
from .store import WORKSPACE, Data, Problem, connection, digest, encoded, now_text

SCHEMA = '''
CREATE TABLE IF NOT EXISTS baseline_versions(
 id TEXT PRIMARY KEY, crew TEXT NOT NULL, series TEXT NOT NULL, document TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS baseline_version_series ON baseline_versions(crew,series);
CREATE INDEX IF NOT EXISTS baseline_version_compact
 ON baseline_versions(crew,series,json_remove(document,'$.sampleIds'));
CREATE TABLE IF NOT EXISTS baseline_heads(
 crew TEXT NOT NULL, series TEXT NOT NULL, active_id TEXT, candidate_id TEXT,
 revision INTEGER NOT NULL, PRIMARY KEY(crew,series));
CREATE TABLE IF NOT EXISTS baseline_states(
 id TEXT PRIMARY KEY, status TEXT NOT NULL, document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS baseline_exclusions(
 id TEXT PRIMARY KEY, crew TEXT NOT NULL, series TEXT NOT NULL, document TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS baseline_exclusion_series ON baseline_exclusions(crew,series);
CREATE TABLE IF NOT EXISTS baseline_audit(
 id TEXT PRIMARY KEY, crew TEXT NOT NULL, series TEXT NOT NULL, revision INTEGER NOT NULL,
 document TEXT NOT NULL, UNIQUE(crew,series,revision));
CREATE TABLE IF NOT EXISTS baseline_lifecycle_commands(
 crew TEXT NOT NULL, command TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL,
 PRIMARY KEY(crew,command));
CREATE TABLE IF NOT EXISTS analysis_revisions(
 id TEXT PRIMARY KEY, measurement TEXT NOT NULL, crew TEXT NOT NULL, baseline TEXT NOT NULL,
 observed TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL,
 UNIQUE(measurement,revision));
CREATE INDEX IF NOT EXISTS analysis_revision_series ON analysis_revisions(baseline,observed);
CREATE INDEX IF NOT EXISTS analysis_revision_advancing ON analysis_revisions(baseline,observed)
 WHERE revision=1 AND json_extract(document,'$.status') IN ('ready','unusable_quality');
CREATE VIEW IF NOT EXISTS baseline_records AS
 SELECT id,crew,series,document FROM fixed_baselines UNION ALL
 SELECT id,crew,series,document FROM baseline_versions;
CREATE VIEW IF NOT EXISTS analysis_records AS
 SELECT id,measurement,crew,baseline,observed,document,1 AS revision FROM fixed_analyses UNION ALL
 SELECT id,measurement,crew,baseline,observed,document,revision FROM analysis_revisions;
CREATE VIEW IF NOT EXISTS analysis_current AS
 SELECT a.* FROM analysis_records a WHERE NOT EXISTS
 (SELECT 1 FROM analysis_revisions r WHERE r.measurement=a.measurement AND r.revision>a.revision);
'''

PROFILE = {'id': 'training-fixed-v1', 'minimumSamples': 30, 'varianceEpsilon': 1e-9,
           'ewmaLambda': .2, 'rollingUpdates': False, 'representativePolicy': 'first_valid_per_utc_second'}


def _state(db: sqlite3.Connection, ident: str, status: str, reason: str,
           trigger: str | None = None) -> None:
    previous = db.execute('SELECT document FROM baseline_states WHERE id=?', (ident,)).fetchone()
    old = json.loads(previous[0]) if previous else {}
    doc = {'status': status, 'reason': reason, 'updatedAt': now_text(),
           'activatedAt': old.get('activatedAt') or (now_text() if status == 'active' else None),
           'frozenAt': (old.get('frozenAt') or now_text()) if status == 'frozen' else None,
           'triggerEventId': trigger}
    db.execute('INSERT INTO baseline_states VALUES(?,?,?) ON CONFLICT(id) DO UPDATE '
               'SET status=excluded.status,document=excluded.document', (ident, status, encoded(doc)))


def _audit(db: sqlite3.Connection, crew: str, series: str, ident: str, revision: int,
           action: str, reason: str, trigger: str | None = None) -> None:
    entry = {'id': str(uuid4()), 'baselineId': ident, 'revision': revision, 'action': action,
             'reason': reason, 'triggerEventId': trigger, 'createdAt': now_text()}
    db.execute('INSERT INTO baseline_audit VALUES(?,?,?,?,?)',
               (entry['id'], crew, series, revision, encoded(entry)))


def register_legacy(db: sqlite3.Connection, doc: Data, series: str) -> None:
    """Initialize lifecycle metadata on writes/migration without rewriting saved documents."""
    crew, ident = doc['crewId'], doc['id']
    existing = db.execute('SELECT 1 FROM baseline_heads WHERE crew=? AND series=?', (crew, series)).fetchone()
    if existing:
        return
    db.execute('INSERT INTO baseline_heads VALUES(?,?,?,NULL,1)', (crew, series, ident))
    _state(db, ident, 'active', 'legacy_explicit_creation')
    _audit(db, crew, series, ident, 1, 'activate', 'legacy_explicit_creation')
    alert = _related_alert(db, crew, series)
    if alert:
        freeze_for_alert(db, alert['id'])


def migrate(db: sqlite3.Connection) -> None:
    for row in db.execute('SELECT series,document FROM fixed_baselines').fetchall():
        register_legacy(db, json.loads(row['document']), row['series'])


def _head(db: sqlite3.Connection, crew: str, series: str) -> Data:
    row = db.execute('SELECT * FROM baseline_heads WHERE crew=? AND series=?', (crew, series)).fetchone()
    return dict(row) if row else {'crew': crew, 'series': series, 'active_id': None,
                                  'candidate_id': None, 'revision': 0}


def _check_revision(head: Data, expected: int) -> None:
    if head['revision'] != expected:
        raise Problem(409, 'REVISION_CONFLICT', 'Baseline lifecycle changed; reload before reviewing.',
                      current_version=head['revision'])


def _record(db: sqlite3.Connection, crew: str, ident: str) -> sqlite3.Row:
    row = db.execute('SELECT * FROM baseline_records WHERE id=? AND crew=?', (ident, crew)).fetchone()
    if not row:
        raise Problem(404, 'NOT_FOUND', 'Owned baseline required.')
    return row


def _sample(db: sqlite3.Connection, crew: str, ident: str) -> Data:
    from .baselines import METRICS
    row = db.execute('SELECT document FROM measurements WHERE id=? AND crew_id=?', (ident, crew)).fetchone()
    if not row:
        raise Problem(404, 'NOT_FOUND', 'Owned measurement required.')
    sample = canonical_measurement(json.loads(row[0]))
    if sample['metricCode'] not in METRICS:
        raise Problem(422, 'NON_NUMERIC_METRIC', 'Numeric vital sign required.')
    return sample


def baseline_sample(doc: Data) -> Data:
    return {'metricCode': doc['metricCode'], 'method': doc['method'], 'unit': doc['unit'],
            'context': doc['context'], 'provenance': {'source': doc['source'],
                'isSynthetic': doc['synthetic'], 'dataOrigin': doc['origin']}}


def exclusions(db: sqlite3.Connection, crew: str, series: str) -> list[Data]:
    return [json.loads(row[0]) for row in db.execute(
        'SELECT document FROM baseline_exclusions WHERE crew=? AND series=? ORDER BY rowid', (crew, series))]


def snapshot(db: sqlite3.Connection, crew: str, series: str) -> Data:
    head = _head(db, crew, series)
    versions = []
    for row in db.execute('SELECT b.document,s.document AS state FROM baseline_records b '
                          'LEFT JOIN baseline_states s ON s.id=b.id WHERE b.crew=? AND b.series=? '
                          "ORDER BY json_extract(b.document,'$.version')", (crew, series)):
        versions.append({**json.loads(row['document']), **(json.loads(row['state']) if row['state'] else {})})
    active = next((v for v in versions if v['id'] == head['active_id']), None)
    candidate = next((v for v in versions if v['id'] == head['candidate_id']), None)
    status = 'rebuilding' if active and candidate else (active or candidate or {}).get('status', 'collecting')
    if versions and not active and not candidate:
        status = 'retired'
    return {'seriesKey': series, 'revision': head['revision'], 'activeId': head['active_id'],
            'candidateId': head['candidate_id'], 'status': status, 'baseline': active, 'candidate': candidate,
            'versions': versions, 'exclusions': exclusions(db, crew, series),
            'audit': [json.loads(row[0]) for row in db.execute(
                'SELECT document FROM baseline_audit WHERE crew=? AND series=? ORDER BY revision', (crew, series))]}


def _replay(db: sqlite3.Connection, crew: str, command: str, payload: Data) -> tuple[str, Data | None]:
    fingerprint = digest(encoded(payload))
    row = db.execute('SELECT hash,result FROM baseline_lifecycle_commands WHERE crew=? AND command=?',
                      (crew, command)).fetchone()
    if row and row['hash'] != fingerprint:
        raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'This command has different content.')
    return fingerprint, json.loads(row['result']) if row else None


def _receipt(db: sqlite3.Connection, crew: str, command: str, fingerprint: str, result: Data) -> None:
    db.execute('INSERT INTO baseline_lifecycle_commands VALUES(?,?,?,?)', (crew, command, fingerprint, encoded(result)))


def _cutoff(cutoff: datetime) -> None:
    if cutoff.year <= 1 or cutoff > datetime.now(UTC):
        raise Problem(422, 'INVALID_REFERENCE', 'Choose a past cutoff allowing a seven-day history.')


def _eligibility(sample: Data, stats: Data) -> str | None:
    p = sample['provenance']
    if p['isSynthetic'] is not True or sample.get('mode', 'training') != 'training':
        return 'profile_required'
    if stats['count'] < PROFILE['minimumSamples']:
        return 'insufficient_samples'
    if stats['sd'] == 0:
        return 'zero_variance'
    if stats['sd'] is None or stats['sd'] <= PROFILE['varianceEpsilon']:
        return 'variance_too_small'
    return None


class NewCandidate(Contract):
    commandId: Identifier
    measurementId: Identifier
    referenceTo: AwareDatetime
    expectedRevision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=500)


class Action(Contract):
    commandId: Identifier
    expectedRevision: int = Field(ge=0)
    action: Literal['activate', 'freeze', 'resume', 'retire', 'rebuild', 'exclude', 'unwell']
    reason: str = Field(min_length=1, max_length=500)
    referenceTo: AwareDatetime | None = None
    start: AwareDatetime | None = Field(None, alias='from')
    end: AwareDatetime | None = Field(None, alias='to')


class Recalculate(Contract):
    commandId: Identifier
    baselineId: Identifier
    expectedRevision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=500)


def _build(db: sqlite3.Connection, crew: str, sample: Data, cutoff: datetime, head: Data, reason: str) -> str:
    from .baselines import ALGORITHM, candidate, series_key
    _cutoff(cutoff)
    stats = candidate(db, crew, sample, cutoff)
    eligible = _eligibility(sample, stats)
    version = db.execute("SELECT COALESCE(MAX(json_extract(document,'$.version')),0)+1 FROM baseline_records "
                         'WHERE crew=? AND series=?', (crew, head['series'])).fetchone()[0]
    p = sample['provenance']
    doc = {'id': str(uuid4()), 'version': version, 'crewId': crew, 'metricCode': sample['metricCode'], **stats,
           'source': p['source'], 'method': sample['method'], 'origin': p['dataOrigin'],
           'synthetic': p['isSynthetic'], 'unit': sample['unit'], 'context': dict(series_key(sample)[-1]),
           'algorithmVersion': ALGORITHM, 'createdAt': now_text(), 'profile': PROFILE,
           'eligibilityReason': eligible, 'requiredSampleCount': PROFILE['minimumSamples']}
    if head['candidate_id']:
        _state(db, head['candidate_id'], 'retired', 'superseded_candidate')
    db.execute('INSERT INTO baseline_versions VALUES(?,?,?,?)', (doc['id'], crew, head['series'], encoded(doc)))
    _state(db, doc['id'], 'collecting' if eligible else 'ready_for_review', reason)
    db.execute('INSERT INTO baseline_heads VALUES(?,?,?,?,?) ON CONFLICT(crew,series) DO UPDATE '
               'SET candidate_id=excluded.candidate_id,revision=excluded.revision',
               (crew, head['series'], head['active_id'], doc['id'], head['revision'] + 1))
    return str(doc['id'])


def new_candidate(db: sqlite3.Connection, crew: str, body: NewCandidate) -> tuple[Data, bool]:
    from .baselines import series_token
    fingerprint, prior = _replay(db, crew, body.commandId, {'route': 'candidate', **body.model_dump(mode='json')})
    if prior:
        return prior, True
    sample = _sample(db, crew, body.measurementId)
    series = series_token(sample)
    head = _head(db, crew, series)
    _check_revision(head, body.expectedRevision)
    ident = _build(db, crew, sample, body.referenceTo, head, body.reason)
    _audit(db, crew, series, ident, head['revision'] + 1, 'candidate', body.reason)
    result = snapshot(db, crew, series)
    _receipt(db, crew, body.commandId, fingerprint, result)
    return result, False


def _related_alert(db: sqlite3.Connection, crew: str, series: str) -> sqlite3.Row | None:
    from .alerts import RULE
    from .baselines import series_token
    for alert in db.execute('SELECT * FROM alerts WHERE crew_id=? AND context_key=? AND rule_id=? AND state=?',
                            (crew, WORKSPACE, RULE, 'active')):
        for ident in json.loads(alert['evidence']):
            sample = _sample(db, crew, ident)
            if series_token(sample) == series:
                return alert
    return None


def _exclude(db: sqlite3.Connection, crew: str, head: Data, body: Action) -> None:
    if body.start is None or body.end is None or body.start >= body.end:
        raise Problem(422, 'INVALID_RANGE', 'Exclusion requires a valid from/to range.')
    entry = {'id': str(uuid4()), 'from': utc_text(body.start), 'to': utc_text(body.end),
             'kind': 'unwell' if body.action == 'unwell' else 'exclusion', 'reason': body.reason, 'createdAt': now_text()}
    db.execute('INSERT INTO baseline_exclusions VALUES(?,?,?,?)', (entry['id'], crew, head['series'], encoded(entry)))
    if head['candidate_id']:
        _state(db, head['candidate_id'], 'retired', 'exclusions_changed_rebuild_required')
        db.execute('UPDATE baseline_heads SET candidate_id=NULL WHERE crew=? AND series=?', (crew, head['series']))


def _activate(db: sqlite3.Connection, crew: str, head: Data, ident: str, reason: str) -> None:
    if head['candidate_id'] != ident:
        raise Problem(409, 'NOT_CANDIDATE', 'Only the current reviewed candidate can be activated.')
    state = db.execute('SELECT status FROM baseline_states WHERE id=?', (ident,)).fetchone()[0]
    if state != 'ready_for_review':
        raise Problem(422, 'BASELINE_NOT_READY', 'Candidate does not meet baseline profile requirements.')
    if head['active_id']:
        active = db.execute('SELECT status FROM baseline_states WHERE id=?', (head['active_id'],)).fetchone()[0]
        if active == 'frozen':
            raise Problem(409, 'BASELINE_FROZEN', 'Explicitly resume the frozen baseline before replacement.')
    if _related_alert(db, crew, head['series']):
        raise Problem(409, 'ACTIVE_ALERT', 'A related active alert prevents activation.')
    if head['active_id']:
        _state(db, head['active_id'], 'retired', 'replaced_by_reviewed_version', ident)
    _state(db, ident, 'active', reason)
    db.execute('UPDATE baseline_heads SET active_id=?,candidate_id=NULL WHERE crew=? AND series=?',
               (ident, crew, head['series']))


def act(db: sqlite3.Connection, crew: str, ident: str, body: Action) -> tuple[Data, bool]:
    fingerprint, prior = _replay(db, crew, body.commandId, {'route': ident, **body.model_dump(mode='json', by_alias=True)})
    if prior:
        return prior, True
    record = _record(db, crew, ident)
    series = record['series']
    head = _head(db, crew, series)
    _check_revision(head, body.expectedRevision)
    if body.action == 'rebuild':
        if body.referenceTo is None:
            raise Problem(422, 'INVALID_REFERENCE', 'Rebuild requires referenceTo.')
        ident = _build(db, crew, baseline_sample(json.loads(record['document'])), body.referenceTo, head, body.reason)
    else:
        if body.action == 'activate':
            _activate(db, crew, head, ident, body.reason)
        elif ident == head['candidate_id'] and (body.action == 'exclude' or (
                body.action == 'unwell' and (body.start is not None or body.end is not None))):
            _exclude(db, crew, head, body)
            if head['active_id']:
                _state(db, head['active_id'], 'frozen', body.reason)
        elif body.action == 'retire':
            if ident not in (head['active_id'], head['candidate_id']):
                raise Problem(409, 'INVALID_STATE', 'This version is already retired.')
            _state(db, ident, 'retired', body.reason)
            db.execute('UPDATE baseline_heads SET active_id=CASE WHEN active_id=? THEN NULL ELSE active_id END,'
                       'candidate_id=CASE WHEN candidate_id=? THEN NULL ELSE candidate_id END WHERE crew=? AND series=?',
                       (ident, ident, crew, series))
        else:
            if head['active_id'] != ident:
                raise Problem(409, 'INVALID_STATE', 'This action requires the currently active version.')
            if body.action == 'resume':
                if _related_alert(db, crew, series):
                    raise Problem(409, 'ACTIVE_ALERT', 'Resolve the related active alert before explicitly resuming.')
                state = db.execute('SELECT status FROM baseline_states WHERE id=?', (ident,)).fetchone()[0]
                if state != 'frozen':
                    raise Problem(409, 'INVALID_STATE', 'Only a frozen baseline can resume.')
                _state(db, ident, 'active', body.reason)
            else:
                if body.action == 'exclude' or body.start is not None or body.end is not None:
                    _exclude(db, crew, head, body)
                _state(db, ident, 'frozen', body.reason)
        db.execute('UPDATE baseline_heads SET revision=revision+1 WHERE crew=? AND series=?', (crew, series))
    _audit(db, crew, series, ident, head['revision'] + 1, body.action, body.reason)
    result = snapshot(db, crew, series)
    _receipt(db, crew, body.commandId, fingerprint, result)
    return result, False


def freeze_for_alert(db: sqlite3.Connection, alert_id: str) -> None:
    """Only the alert's exact HR comparison series is affected; clearing never resumes it."""
    from .alerts import RULE
    from .baselines import series_token
    alert = db.execute('SELECT * FROM alerts WHERE id=? AND context_key=? AND rule_id=? AND state=?',
                        (alert_id, WORKSPACE, RULE, 'active')).fetchone()
    if not alert:
        return
    series_set = {series_token(_sample(db, alert['crew_id'], ident)) for ident in json.loads(alert['evidence'])}
    for series in series_set:
        head = _head(db, alert['crew_id'], series)
        if not head['active_id']:
            continue
        state = db.execute('SELECT status FROM baseline_states WHERE id=?', (head['active_id'],)).fetchone()[0]
        if state == 'frozen':
            continue
        _state(db, head['active_id'], 'frozen', 'related_active_hr_alert', alert_id)
        db.execute('UPDATE baseline_heads SET revision=revision+1 WHERE crew=? AND series=?', (alert['crew_id'], series))
        _audit(db, alert['crew_id'], series, head['active_id'], head['revision'] + 1,
               'automatic_freeze', 'related_active_hr_alert', alert_id)


def recalculate(db: sqlite3.Connection, crew: str, ident: str, body: Recalculate) -> tuple[Data, bool]:
    from .baselines import ALGORITHM, analysis_cadence, analysis_for, read, series_token
    fingerprint, prior = _replay(db, crew, body.commandId, {'route': f'analysis:{ident}', **body.model_dump(mode='json')})
    if prior:
        return prior, True
    previous = read(db, crew, ident)
    baseline = json.loads(_record(db, crew, body.baselineId)['document'])
    sample = _sample(db, crew, previous['measurementId'])
    series = series_token(sample)
    if series != series_token(baseline_sample(baseline)):
        raise Problem(422, 'INCOMPARABLE_BASELINE', 'Recalculation requires the exact measurement comparison series.')
    _check_revision(_head(db, crew, series), body.expectedRevision)
    state = json.loads(db.execute('SELECT document FROM baseline_states WHERE id=?', (baseline['id'],)).fetchone()[0])
    if not state.get('activatedAt') or _eligibility(sample, baseline):
        raise Problem(422, 'BASELINE_NOT_READY', 'Recalculation requires an eligible previously activated version.')
    # Explicit historical reanalysis starts a new segment; it cannot rewrite ingestion-time EWMA.
    latest = analysis_for(db, sample['id'])
    assert latest is not None
    excluded = previous['status'] in ('duplicate_bucket', 'out_of_order')
    good = not excluded and sample['quality'] == 'good' and isinstance(sample['value'], (int, float))
    z = (sample['value'] - baseline['mean']) / baseline['sd'] if good else None
    result = {'id': str(uuid4()), 'crewId': crew, 'metricCode': sample['metricCode'], 'measurementId': sample['id'],
              'observedAt': sample['observedAt'], 'value': sample['value'], 'unit': sample['unit'],
              'status': previous['status'] if excluded else ('ready' if good else 'unusable_quality'),
              'reason': previous['reason'] if excluded else (None if good else 'missing_or_poor_quality'),
              'baselineId': baseline['id'], 'baselineVersion': baseline['version'], 'algorithmVersion': ALGORITHM,
              'analysisCadenceSeconds': analysis_cadence(sample), 'demoRunId': sample.get('context', {}).get('demoRunId'),
              'z': z, 'ewma': z, 'segmentId': str(uuid4()), 'createdAt': now_text(),
              'analysisRevision': latest.get('analysisRevision', 1) + 1, 'previousAnalysisId': ident,
              'recalculationScope': 'single_measurement', 'recalculationReason': body.reason}
    db.execute('INSERT INTO analysis_revisions VALUES(?,?,?,?,?,?,?)',
               (result['id'], sample['id'], crew, baseline['id'], sample['observedAt'], encoded(result), result['analysisRevision']))
    _receipt(db, crew, body.commandId, fingerprint, result)
    return result, False


def register_lifecycle(app: FastAPI, path: Path) -> None:
    from .main import current, require_workspace, response

    def owner(request: Request, write: bool = False) -> str:
        user = current(request, write=write)
        require_workspace(request.query_params.get('runId'))
        if not user['crewId'] or 'crew' not in user['roles']:
            raise Problem(403, 'FORBIDDEN', 'Personal baseline requires a crew account.')
        return str(user['crewId'])

    @app.get('/v1/baselines')
    def list_versions(request: Request, measurementId: str | None = None):
        from .baselines import series_token
        crew = owner(request)
        with connection(path) as db:
            if measurementId:
                return response(snapshot(db, crew, series_token(_sample(db, crew, measurementId))))
            return response({'items': [snapshot(db, crew, row[0]) for row in db.execute(
                'SELECT series FROM baseline_heads WHERE crew=? ORDER BY series', (crew,))]})

    @app.post('/v1/baselines/candidates/new')
    def prepare(request: Request, body: NewCandidate):
        crew = owner(request, True)
        with connection(path, write=True) as db:
            result, replay = new_candidate(db, crew, body)
            return response(result, 200 if replay else 201, replayed=replay)

    @app.post('/v1/baselines/{ident}/actions')
    def actions(request: Request, ident: str, body: Action):
        crew = owner(request, True)
        with connection(path, write=True) as db:
            result, replay = act(db, crew, ident, body)
            return response(result, replayed=replay)

    @app.post('/v1/analyses/{ident}/recalculate')
    def recalc(request: Request, ident: str, body: Recalculate):
        crew = owner(request, True)
        with connection(path, write=True) as db:
            result, replay = recalculate(db, crew, ident, body)
            return response(result, 200 if replay else 201, replayed=replay)
