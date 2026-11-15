"""Owner-scoped immutable training snapshots; all clinical/statistical results are already saved."""
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, Request
from pydantic import Field, StrictInt, model_validator

from . import alerts, baselines, news2
from .knowledge import _document, search_knowledge
from .models import Contract, Identifier, canonical_measurement
from .store import WORKSPACE, Data, Problem, connection, digest, encoded, now_text

TEMPLATE_VERSION = 'health-report-v1'
METRICS = ('heart_rate', 'spo2', 'respiratory_rate', 'blood_pressure_systolic',
           'blood_pressure_diastolic', 'temperature')
METRIC_LABELS = news2.LABELS | {'blood_pressure_diastolic': ('diastolic pressure', '舒張壓')}
SCHEMA = '''
CREATE TABLE IF NOT EXISTS health_reports(
 id TEXT PRIMARY KEY, crew TEXT NOT NULL REFERENCES crew(id), command TEXT NOT NULL,
 hash TEXT NOT NULL, created TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(crew,command));
CREATE INDEX IF NOT EXISTS health_report_history ON health_reports(crew,created);
'''


class SaveReport(Contract):
    commandId: Identifier
    assessmentId: Identifier | None = None
    assessmentVersion: Annotated[StrictInt, Field(ge=1)] | None = None

    @model_validator(mode='after')
    def version_requires_id(self):
        if self.assessmentVersion is not None and self.assessmentId is None:
            raise ValueError('An assessment version requires its assessment ID.')
        return self


def read(db: sqlite3.Connection, crew: str, ident: str) -> Data:
    row = db.execute('SELECT document FROM health_reports WHERE crew=? AND id=?', (crew, ident)).fetchone()
    if not row:
        raise Problem(404, 'NOT_FOUND', 'Saved health report unavailable.')
    return json.loads(row[0])


def summaries(db: sqlite3.Connection, crew: str | None) -> list[Data]:
    if crew is None:
        rows = db.execute("""SELECT json_extract(document,'$.summary') FROM (
            SELECT document,created,rowid AS sequence,
                   row_number() OVER (PARTITION BY crew ORDER BY created DESC,rowid DESC) AS position
            FROM health_reports) WHERE position=1 ORDER BY created DESC,sequence DESC""")
        return [json.loads(row[0]) for row in rows]
    rows = db.execute("SELECT json_extract(document,'$.summary') FROM health_reports "
                      'WHERE crew=? ORDER BY created DESC,rowid DESC LIMIT 100', (crew,))
    return [json.loads(row[0]) for row in rows]


def limitation(code: str, en: str, zh: str, metric: str | None = None) -> Data:
    item: Data = {'code': code, 'text': {'en': en, 'zh-TW': zh}}
    if metric:
        item['metricCode'] = metric
    return item


def selected_measurements(db: sqlite3.Connection, crew: str, assessment: Data | None) -> list[Data]:
    result = []
    for metric in METRICS:
        if assessment is not None:
            ident = assessment['measurementIds'].get(metric)
            if not ident:
                continue
            row = db.execute('SELECT document FROM measurements WHERE crew_id=? AND metric=? AND id=?',
                             (crew, metric, ident)).fetchone()
        else:
            row = db.execute('SELECT document FROM measurements WHERE crew_id=? AND metric=? '
                             'ORDER BY observed DESC,row_id DESC LIMIT 1', (crew, metric)).fetchone()
        if row:
            result.append(canonical_measurement(json.loads(row[0])))
    return result


def statistical_snapshot(db: sqlite3.Connection, crew: str, measurements: list[Data],
                         stamp: str, assessment: Data | None, limits: list[Data]) -> list[Data]:
    by_metric = {m['metricCode']: m for m in measurements}
    result = []
    for metric in METRICS:
        en, zh = METRIC_LABELS[metric]
        m = by_metric.get(metric)
        saved = baselines.analysis_for(db, m['id']) if m else None
        analysis = baselines.read(db, crew, saved['id']) if saved else None
        status = 'missing_measurement' if m is None else 'missing_analysis' if analysis is None else 'saved'
        reason = None if analysis else 'no_matching_saved_analysis' if m else 'no_linked_measurement'
        outside_news2 = assessment is not None and metric == 'blood_pressure_diastolic'
        if outside_news2:
            reason = 'outside_news2_scope'
        age = max(0, (datetime.fromisoformat(stamp) - datetime.fromisoformat(m['observedAt'])).total_seconds()) if m else None
        result.append({'metricCode': metric, 'measurementId': m['id'] if m else None,
                       'analysis': analysis, 'status': status, 'reason': reason,
                       'observedAt': m['observedAt'] if m else None, 'quality': m['quality'] if m else None,
                       'source': m['provenance']['source'] if m else None,
                       'context': m['context'] if m else None, 'ageSeconds': age})
        if m is None:
            if outside_news2:
                limits.append(limitation('outside_news2_scope',
                    'Diastolic pressure is not a NEWS2 input. This report retains only the assessment-linked measurements; '
                    'an unrelated diastolic analysis is not substituted, so this is not a missing NEWS2 entry.',
                    '舒張壓不是 NEWS2 輸入項目。本報告僅保留該次評估連結的量測，不補入無關的舒張壓分析；這不代表 NEWS2 漏填。', metric))
                continue
            unlinked = assessment is not None and assessment['effectiveInputs'].get(metric) is not None
            limits.append(limitation('unlinked_input' if unlinked else 'missing_measurement',
                f'{en}: no linked measurement ID; no statistical evidence can be matched.',
                f'{zh}：未連結量測 ID，沒有可精確對應的統計證據。', metric))
            continue
        if analysis is None:
            limits.append(limitation('missing_analysis', f'{en}: no saved analysis for this exact measurement.',
                f'{zh}：這個量測 ID 沒有已保存分析。', metric))
        elif analysis['status'] != 'ready' or analysis['z'] is None or analysis['ewma'] is None:
            limits.append(limitation('unusable_analysis', f'{en}: saved statistics are unavailable ({analysis["status"]}).',
                f'{zh}：保存統計無法使用（{analysis["status"]}）。', metric))
        if m['quality'] != 'good' or m['value'] is None:
            limits.append(limitation('unusable_quality', f'{en}: input quality is {m["quality"]}.',
                f'{zh}：輸入品質為 {m["quality"]}。', metric))
        if not m['context'].get('activity'):
            limits.append(limitation('missing_context', f'{en}: activity context was not recorded.',
                f'{zh}：未記錄活動情境。', metric))
        cadence = m['context'].get('analysisCadenceSeconds')
        if isinstance(cadence, (float, int)) and not isinstance(cadence, bool) and cadence > 0 and age is not None and age > cadence * 4:
            limits.append(limitation('historical_measurement',
                f'{en}: age {age:.0f} seconds exceeds four saved sampling intervals; this is historical evidence.',
                f'{zh}：資料距保存時間 {age:.0f} 秒，超過四倍已記錄取樣間隔，屬歷史證據。', metric))
    return result


def evaluation_snapshot(db: sqlite3.Connection, crew: str, measurements: list[Data]) -> list[Data]:
    ids = [m['id'] for m in measurements]
    if not ids:
        return []
    slots = ','.join('?' for _ in ids)
    rows = db.execute('SELECT e.*,r.document AS rule FROM rule_evaluations e JOIN rule_definitions r '
                      'ON r.rule_id=e.rule_id AND r.rule_version=e.rule_version '
                      f'WHERE e.context_key=? AND e.crew_id=? AND e.measurement_id IN ({slots}) '
                      'ORDER BY e.evaluated_at,e.rowid', (WORKSPACE, crew, *ids))
    return [{'id': r['id'], 'ruleId': r['rule_id'], 'ruleVersion': r['rule_version'],
             'measurementId': r['measurement_id'], 'status': r['status'], 'reason': r['reason'],
             'inputIds': json.loads(r['input_ids']), 'evaluatedAt': r['evaluated_at'],
             'alertId': r['alert_id'], 'rule': json.loads(r['rule'])} for r in rows]


def snapshot(db: sqlite3.Connection, crew: str, body: SaveReport) -> Data:
    ident, stamp = str(uuid4()), now_text()
    assessment = None
    if body.assessmentId:
        assessment = news2.read(db, crew, body.assessmentId, body.assessmentVersion)
    else:
        latest = news2.summaries(db, crew)
        if latest:
            assessment = news2.read(db, crew, latest[0]['id'], latest[0]['version'])
    limits = [limitation('training_only',
        'Synthetic training only. NEWS2, statistical deviation and educational text are separate evidence; '
        'no combined health score, diagnosis, treatment or new notification is produced.',
        '僅供合成資料訓練。NEWS2、統計偏離與教育文字分開呈現，不產生綜合健康分數、診斷、治療或新通知。'),
        limitation('snapshot_time',
        f'Saved at {stamp}. Each reading retains its own time, source and context; these may not be comparable. '
        'Alert states reflect the save time and are not a new evaluation of the selected NEWS2 observation.',
        f'保存時間 {stamp}。每筆量測保留各自時間、來源與情境，可能無法互相比較；警示狀態反映保存當下，並非對選定 NEWS2 的重新判定。')]
    if assessment is None:
        limits.append(limitation('missing_news2', 'No NEWS2 record is available; score is unknown. Latest readings are shown separately.',
            '沒有 NEWS2 紀錄，分數未知。各指標最新量測分別呈現。'))
    elif assessment['missingInputs'] or assessment['invalidInputs'] or assessment['missingDetails']:
        limits.append(limitation('incomplete_news2',
            'The selected NEWS2 record has missing, unusable or incomplete-context inputs; missing values are not zero.',
            '選定 NEWS2 有缺漏、品質不足或情境未齊輸入；缺值不視為零。'))
    measurements = selected_measurements(db, crew, assessment)
    statistics = statistical_snapshot(db, crew, measurements, stamp, assessment, limits)
    contexts = {(m['context'].get('activity'), m['provenance']['source'], m['method']) for m in measurements}
    if len(contexts) > 1:
        limits.append(limitation('mixed_context', 'Readings have different activity, source or method; do not combine them as one comparable series.',
            '量測的活動、來源或方法不同，不可合併為同一可比較序列。'))
    if len({m['observedAt'] for m in measurements}) > 1:
        limits.append(limitation('different_observation_times', 'Readings were observed at different times; this snapshot is not a simultaneous measurement.',
            '量測時間不同，這份快照並非同時量測。'))
    saved_alerts = alerts.list_alerts(db, crew)
    knowledge = search_knowledge(db, 'NEWS2 baseline statistics', topic='assessment', kind='education')
    procedures = [_document(db, doc, version) for doc, version in sorted({
        (a['procedureId'], a['procedureVersion']) for a in saved_alerts})]
    summary = {'id': ident, 'crewId': crew, 'version': 1, 'createdAt': stamp,
               'assessmentId': assessment['id'] if assessment else None,
               'assessmentVersion': assessment['version'] if assessment else None,
               'news2Score': assessment['news2Score'] if assessment else None,
               'news2Status': assessment['assessmentStatus'] if assessment else 'unknown',
               'statisticsAvailable': sum(bool(s['analysis'] and s['analysis']['status'] == 'ready'
                   and s['analysis']['z'] is not None and s['analysis']['ewma'] is not None) for s in statistics),
               'statisticsTotal': len(METRICS),
               'activeAlertCount': sum(a['conditionState'] == 'active' for a in saved_alerts),
               'knowledgeVersions': [{'documentId': d, 'version': v} for d, v in sorted({
                   (k['documentId'], k['version']) for k in knowledge})],
               'limitCodes': list(dict.fromkeys(item['code'] for item in limits))}
    return {'id': ident, 'crewId': crew, 'version': 1, 'createdAt': stamp, 'mode': 'training',
            'templateVersion': TEMPLATE_VERSION, 'news2': assessment, 'measurements': measurements,
            'statistics': statistics, 'ruleEvaluations': evaluation_snapshot(db, crew, measurements),
            'alerts': saved_alerts, 'knowledge': knowledge, 'procedures': procedures,
            'limits': limits, 'summary': summary}


def register_health_reports(app: FastAPI, path: Path) -> None:
    from .main import current, require_workspace, response

    def account(request: Request, write: bool = False, details: bool = True) -> Data:
        user = current(request, write=write)
        require_workspace(request.query_params.get('runId'))
        if ('crew' in user['roles'] and user['crewId']) or (not details and not write and 'monitor' in user['roles']):
            return user
        raise Problem(403, 'FORBIDDEN', 'Health report details require the owning crew account.')

    @app.post('/v1/health-reports')
    def save(request: Request, body: SaveReport):
        crew = account(request, write=True)['crewId']
        signature = digest(encoded(body.model_dump(mode='json')))
        with connection(path, write=True) as db:
            old = db.execute('SELECT hash,document FROM health_reports WHERE crew=? AND command=?',
                             (crew, body.commandId)).fetchone()
            if old:
                if old['hash'] != signature:
                    raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'The report command has different content.')
                return response(json.loads(old['document']), replayed=True)
            item = snapshot(db, crew, body)
            db.execute('INSERT INTO health_reports VALUES(?,?,?,?,?,?)',
                       (item['id'], crew, body.commandId, signature, item['createdAt'], encoded(item)))
        return response(item, 201)

    @app.get('/v1/health-reports')
    def history(request: Request, crewId: str | None = None):
        user = account(request, details=False)
        crew = user['crewId'] if 'crew' in user['roles'] else crewId
        if 'crew' in user['roles'] and crewId and crewId != crew:
            raise Problem(403, 'FORBIDDEN', 'Crew report history is private.')
        with connection(path) as db:
            return response({'items': summaries(db, crew)})

    @app.get('/v1/health-reports/{ident}')
    def one(request: Request, ident: str):
        crew = account(request)['crewId']
        with connection(path) as db:
            return response(read(db, crew, ident))
