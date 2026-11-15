"""Single backend-owned, persisted, real-time synthetic demonstration clock."""
import json
import sqlite3
import threading
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from .demo_observations import save_observation
from .demo_store import initialize_demo, latest_run, load_config, save_run
from .models import Contract, Identifier, Telemetry, utc_text
from .radiation_store import add_segment, mission, publish
from .store import (
    CREW,
    WORKSPACE,
    Data,
    Problem,
    connection,
    digest,
    encoded,
    now_text,
    write_measurements,
)


def packet_for(row: Data, instance: str, origin: datetime, *, live: bool) -> Telemetry:
    metrics = []
    for raw in row['metrics']:
        metric = {**raw, 'context': {**raw.get('context', {}), 'demoRunId': instance}}
        if metric.get('measurementGroupId'):
            metric['measurementGroupId'] = digest(instance + ':' + metric['measurementGroupId'])
        metrics.append(metric)
    crew = row['crewId']
    return Telemetry.model_validate({
        'schemaVersion': '1.3', 'messageId': digest(instance + ':' + row['id']),
        'deviceId': 'mock-' + crew, 'assignmentId': 'assignment-' + crew,
        'bootId': instance + '-' + crew, 'seq': max(0, row['tMs'] // 1000 + 2592001),
        'deviceUptimeMs': max(0, row['tMs']), 'clockStatus': 'synced',
        'mode': 'training', 'source': 'mock', 'dataOrigin': 'synthetic', 'transport': 'http',
        'isSynthetic': True, 'deliveryKind': 'live' if live else 'backfill',
        'observedAt': utc_text(origin + timedelta(milliseconds=row['tMs'])),
        'upstreamSampleId': digest(instance + ':' + row['id']), 'metrics': metrics,
    })


def accept_packet(db: sqlite3.Connection, packet: Telemetry) -> tuple[Data, bool]:
    """Accept a trusted runtime packet inside its tick transaction, using store.accept's sample identity."""
    actor = packet.deviceId
    command = encoded([packet.bootId, packet.seq])
    request_data = packet.model_dump(mode='json')
    request_hash = digest(encoded(request_data))
    receipt = db.execute('SELECT hash,result FROM receipts WHERE context_key=? AND actor=? AND command=?',
                         (WORKSPACE, actor, command)).fetchone()
    if receipt:
        if receipt['hash'] != request_hash:
            raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'The command was accepted with different content.')
        return json.loads(receipt['result']), True
    sample_hash = digest(encoded({k: v for k, v in request_data.items() if k not in
                                 ('bootId', 'seq', 'messageId', 'deviceUptimeMs', 'deliveryKind', 'causationId')}))
    previous = db.execute('SELECT result,sample_hash FROM packets WHERE context_key=? AND device=? AND boot=? AND seq=?',
                          (WORKSPACE, actor, packet.bootId, packet.seq)).fetchone()
    sample = previous or db.execute('SELECT result,sample_hash FROM packets WHERE context_key=? AND device=? AND upstream=?',
                                   (WORKSPACE, actor, packet.upstreamSampleId)).fetchone()
    if sample:
        if sample['sample_hash'] != sample_hash:
            raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'The upstream sample has different content.')
        if not previous:
            db.execute('INSERT INTO packets VALUES(?,?,?,?,NULL,?,?)',
                       (WORKSPACE, actor, packet.bootId, packet.seq, sample_hash, sample['result']))
        db.execute('INSERT INTO receipts VALUES(?,?,?,?,?)',
                   (WORKSPACE, actor, command, request_hash, sample['result']))
        return json.loads(sample['result']), True
    last_seq = db.execute('SELECT MAX(seq) FROM packets WHERE context_key=? AND device=? AND boot=?',
                          (WORKSPACE, actor, packet.bootId)).fetchone()[0]
    live = packet.deliveryKind == 'live' and (last_seq is None or packet.seq > last_seq)
    if live:
        db.execute('UPDATE devices SET last_seen=? WHERE id=?', (time.time(), actor))
    result = write_measurements(db, packet, actor, actor.removeprefix('mock-'), live)
    saved = encoded(result)
    db.execute('INSERT INTO receipts VALUES(?,?,?,?,?)', (WORKSPACE, actor, command, request_hash, saved))
    db.execute('INSERT INTO packets VALUES(?,?,?,?,?,?,?)',
               (WORKSPACE, actor, packet.bootId, packet.seq, packet.upstreamSampleId, sample_hash, saved))
    return result, False


class DemoCommand(Contract):
    commandId: Identifier


def _current_baseline_analysis(db: sqlite3.Connection, crew: str, baseline: str) -> Data | None:
    candidates = []
    for table, revision in (('fixed_analyses', '1'), ('analysis_revisions', 'a.revision')):
        row = db.execute(f"SELECT a.document FROM {table} a WHERE a.crew=? AND a.baseline=? "
                         "AND json_extract(a.document,'$.status') IN ('ready','unusable_quality') "
                         "AND NOT EXISTS (SELECT 1 FROM analysis_revisions r WHERE r.measurement=a.measurement "
                         f"AND r.revision>{revision}) ORDER BY a.observed DESC,a.rowid DESC LIMIT 1",
                         (crew, baseline)).fetchone()
        if row:
            candidates.append(json.loads(row[0]))
    return max(candidates, key=lambda item: (item['observedAt'], item['createdAt']), default=None)


def assessment_baselines(db: sqlite3.Connection, crew: str) -> list[Data]:
    """Summarize active references with current analyses pinned to that same baseline version."""
    from .baselines import METRICS

    result: list[Data] = []
    for metric in METRICS:
        baseline = db.execute("SELECT json_remove(b.document,'$.sampleIds') AS document "
                              "FROM baseline_heads h JOIN baseline_records b ON b.id=h.active_id "
                              "WHERE h.crew=? AND b.crew=? AND COALESCE(json_extract(b.document,'$.metricCode'),'heart_rate')=? "
                              "ORDER BY json_extract(b.document,'$.createdAt') DESC,h.rowid DESC LIMIT 1",
                              (crew, crew, metric)).fetchone()
        if not baseline:
            result.append({'metricCode': metric, 'baselineId': None, 'analysis': None})
            continue
        document = json.loads(baseline['document'])
        result.append({'metricCode': metric, 'baselineId': document['id'], 'baselineVersion': document['version'],
                       'count': document['count'], 'mean': document['mean'], 'sd': document['sd'],
                       **{key: document[key] for key in ('from', 'to', 'unit', 'context')},
                       'analysis': _current_baseline_analysis(db, crew, document['id'])})
    return result


class DemoRuntime:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.worker: threading.Thread | None = None
        self.run: Data | None = None
        self.config: Data | None = None
        self._pending_finish: tuple[str, str | None] | None = None

    def initialize(self) -> None:
        with connection(self.path, write=True) as db:
            initialize_demo(db)
            self.config = load_config(db)
            self.run = latest_run(db)
            if self.run and self.run['status'] == 'playing':
                self.run.update(status='interrupted', error='Server restarted; start a new demonstration.', endedAt=now_text())
                save_run(db, self.run)

    def status(self) -> Data:
        from .demo_bundle import activity_at
        with self.lock:
            state = dict(self.run or {})
            elapsed = state.get('elapsedMs', 0)
            return {'status': 'ready' if self.config else 'unavailable', 'id': None,
                    'datasetId': self.config['datasetId'] if self.config else None,
                    'preparedAt': self.config['preparedAt'] if self.config else None,
                    'startedAt': None, 'elapsedMs': 0, 'durationMs': 300000, 'accepted': 0,
                    **{k: v for k, v in state.items() if k not in ('latencySamplesMs', 'commandId')},
                    'activities': [activity_at(crew, elapsed) for crew in CREW]}

    def start(self, command: str) -> Data:
        with self.lock:
            if not self.config:
                raise Problem(409, 'DEMO_NOT_PREPARED', 'Prepare the validated demonstration database first.')
            with connection(self.path) as db:
                prior = db.execute("SELECT document FROM demo_runs WHERE json_extract(document,'$.commandId')=?", (command,)).fetchone()
                if prior:
                    return self.status() if self.run and json.loads(prior[0])['id'] == self.run['id'] else json.loads(prior[0])
                payload = db.execute('SELECT document FROM demo_payload WHERE id=1').fetchone()
            if self.run and self.run['status'] == 'playing':
                raise Problem(409, 'DEMO_ALREADY_PLAYING', 'A demonstration is already playing.')
            if self.worker and self.worker.is_alive():
                raise Problem(409, 'DEMO_STOPPING', 'Wait for the previous playback worker to stop.')
            if not payload:
                raise Problem(409, 'DEMO_NOT_PREPARED', 'Validated playback payload is unavailable.')
            content = json.loads(payload[0])
            proposed = {'id': uuid4().hex, 'commandId': command, 'status': 'playing',
                        'datasetId': self.config['datasetId'], 'preparedAt': self.config['preparedAt'],
                        'startedAt': now_text(), 'elapsedMs': 0, 'durationMs': 300000,
                        'accepted': 0, 'lateSamples': 0, 'latencySamplesMs': [], 'error': None}
            with connection(self.path, write=True) as db:
                origin = datetime.now(UTC) + timedelta(seconds=1)
                anchor = time.monotonic() + 1
                proposed['startedAt'] = utc_text(origin)
                save_run(db, proposed)
                state = mission(db)
                if state:
                    # Previous run remains immutable in demo_runs, including its radiation result.
                    state.update(elapsedMs=0, cumulative='0', sourceMode='json', sourceId='crew-demo',
                                 startedAt=proposed['startedAt'], sourceEpoch=proposed['startedAt'],
                                 lastObservedAt=None, lastValidAt=None, lastReceivedAt=None,
                                 sourceStatus='unavailable', hasSample=False, activeEvent=None)
                    db.execute('DELETE FROM radiation_segments WHERE mission_id=?', (state['id'],))
                    publish(db, state, 'demo-start:' + proposed['id'])
            self.run = proposed
            self.cancel.clear()
            self.worker = threading.Thread(target=self._play, args=(content, anchor), daemon=True, name='health-demo')
            self.worker.start()
            return self.status()

    def stop(self) -> Data:
        with self.lock:
            self.cancel.set()
            if self.run and self.run['status'] == 'playing':
                status, error = self._pending_finish or ('stopped', None)
                self._finish(status, error)
            return self.status()

    def shutdown(self) -> None:
        self.stop()
        if self.worker:
            self.worker.join(timeout=10)

    def _finish(self, status: str, error: str | None = None) -> None:
        assert self.run is not None
        samples = sorted(self.run.get('latencySamplesMs', []))
        proposed = {**self.run, 'status': status, 'error': error, 'endedAt': now_text(),
                    'p95LatencyMs': samples[max(0, (len(samples) * 95 + 99) // 100 - 1)] if samples else None,
                    'maxLatencyMs': max(samples, default=0),
                    'radiationAddedMsv': float(Decimal(75) * Decimal(self.run['elapsedMs']) / Decimal(3600000000))}
        self._pending_finish = (status, error)
        with connection(self.path, write=True) as db:
            save_run(db, proposed)
        self.run = proposed
        self._pending_finish = None

    def _finish_worker(self, status: str, error: str | None = None) -> None:
        try:
            self._finish(status, error)
        except (sqlite3.Error, OSError):
            # Keep the last committed state and terminal intent; stop can retry after storage recovers.
            self.cancel.set()

    def _play(self, content: Data, anchor: float | None = None) -> None:
        assert self.run is not None
        origin = datetime.fromisoformat(self.run['startedAt'])
        if anchor is None:
            anchor = time.monotonic() + (origin - datetime.now(UTC)).total_seconds()
        observations = {(r['crewId'], r['tMs']): r for r in content['observations']}
        rows = content['rows']
        try:
            for offset in range(0, len(rows), len(CREW)):
                tick = rows[offset]['tMs']
                if self.cancel.wait(max(0, anchor + tick / 1000 - time.monotonic())):
                    return
                with self.lock:
                    if self.cancel.is_set():
                        return
                    proposed = dict(self.run)
                    with connection(self.path, write=True) as db:
                        for row in rows[offset:offset + len(CREW)]:
                            late = (datetime.now(UTC) - (origin + timedelta(milliseconds=tick))).total_seconds() >= 3
                            packet = packet_for(row, self.run['id'], origin, live=not late)
                            result, replayed = accept_packet(db, packet)
                            observation = observations.get((row['crewId'], tick))
                            if observation and not replayed:
                                ids = {m['code']: ident for m, ident in zip(row['metrics'], result['measurementIds'], strict=True)}
                                save_observation(db, observation, self.run['id'], origin, ids)
                            proposed['accepted'] += int(not replayed)
                            proposed['lateSamples'] += int(late and not replayed)
                        state = mission(db)
                        if state:
                            dose = Decimal(75) * Decimal(tick - state['elapsedMs']) / Decimal(3600000000)
                            add_segment(db, state, state['elapsedMs'], tick, '75', dose)
                            stamp = utc_text(origin + timedelta(milliseconds=tick))
                            state.update(elapsedMs=tick, cumulative=str(Decimal(75) * Decimal(tick) / Decimal(3600000000)),
                                         rate='75', event='background', sourceStatus='fresh', coverage='complete',
                                         lastObservedAt=stamp, lastReceivedAt=now_text(), lastValidAt=stamp,
                                         checkpointAt=now_text(), hasSample=True, version=state['version'] + 1)
                            publish(db, state, 'demo:' + self.run['id'])
                        proposed['elapsedMs'] = tick
                        save_run(db, proposed)
                    self.run = proposed
                    latency = (datetime.now(UTC) - (origin + timedelta(milliseconds=tick))).total_seconds() * 1000
                    self.run['latencySamplesMs'].append(round(latency, 3))
        except (sqlite3.Error, OSError, ValueError, KeyError, TypeError, RuntimeError, Problem) as error:
            with self.lock:
                self._finish_worker('failed', type(error).__name__ + ': ' + str(error)[:300])
            return
        with self.lock:
            self._finish_worker('completed')


def register_demo(app, path: Path, runtime: DemoRuntime) -> None:
    from .main import current, response

    def monitor(request):
        user = current(request, write=True)
        if 'monitor' not in user['roles']:
            raise Problem(403, 'FORBIDDEN', 'Monitoring staff control demonstrations.')

    from fastapi import Request

    @app.get('/v1/demo/playback')
    def status(request: Request):
        current(request)
        return response(runtime.status())

    @app.post('/v1/demo/playback/start')
    def start(request: Request, body: DemoCommand):
        monitor(request)
        return response(runtime.start(body.commandId))

    @app.post('/v1/demo/playback/stop')
    def stop(request: Request, body: DemoCommand):
        monitor(request)
        return response(runtime.stop())

    @app.get('/v1/demo/profile')
    def profile(request: Request, crewId: str | None = None):
        user = current(request)
        crew = crewId or user['crewId']
        if not crew or (crew != user['crewId'] and 'monitor' not in user['roles']):
            raise Problem(403, 'FORBIDDEN', 'A personal profile requires its owner or monitoring staff.')
        with connection(path) as db:
            row = db.execute('SELECT document FROM demo_profiles WHERE crew_id=?', (crew,)).fetchone()
            return response(json.loads(row[0]) if row else None)

    @app.get('/v1/demo/assessment')
    def assessment(request: Request, crewId: str | None = None):
        from . import news2
        from .radiation import history_total
        from .radiation_store import read_radiation
        user = current(request)
        crew = crewId or user['crewId']
        if crew not in CREW or (crew != user['crewId'] and 'monitor' not in user['roles']):
            raise Problem(403, 'FORBIDDEN', 'A personal assessment requires its owner or monitoring staff.')
        with connection(path) as db:
            row = db.execute('SELECT document FROM demo_profiles WHERE crew_id=?', (crew,)).fetchone()
            profile = json.loads(row[0]) if row else None
            baselines = assessment_baselines(db, crew)
            observations = news2.summaries(db, crew)
            scan = db.execute('SELECT document FROM body_scans WHERE crew_id=? ORDER BY observed DESC LIMIT 1', (crew,)).fetchone()
            body = json.loads(scan[0]) if scan else None
            radiation_breakdown = None
            if profile and load_config(db):
                records = [json.loads(row[0]) for row in db.execute(
                    'SELECT document FROM radiation_history WHERE crew_id=? ORDER BY start_at,id', (crew,))]
                prior = [record for record in records if record.get('exposurePeriod') != 'prepared_history']
                history = [record for record in records if record.get('exposurePeriod') == 'prepared_history']
                # history_total sums saved doses with Decimal; it never integrates a rate or guesses missing history.
                radiation_breakdown = {'priorMissionsMsv': history_total(prior)['historyMsv'],
                                       'history30DaysMsv': history_total(history)['historyMsv'],
                                       'priorRecordIds': [record['id'] for record in prior],
                                       'historyRecordIds': [record['id'] for record in history]}
            return response({'profile': profile, 'playback': runtime.status(), 'baselines': baselines,
                             'news2': observations[0] if observations else None,
                             'body': {'id': body['id'], 'observedAt': body['observedAt'], 'totals': body['totals'],
                                      'findingsCount': len(body['findings'])} if body else None,
                             'radiation': read_radiation(db, 'personal', crew),
                             'radiationBreakdown': radiation_breakdown})
