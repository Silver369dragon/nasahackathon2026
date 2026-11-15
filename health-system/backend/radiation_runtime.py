"""A single server clock; atomically commit elapsed time, dose, intervals and events."""
import json
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from .models import utc_text
from .radiation import RadiationEventAction, SampleCommand, integrate_dose
from .radiation_store import (
    add_segment,
    ensure_radiation_started,
    mission,
    publish,
    read_radiation,
)
from .store import WORKSPACE, Data, Problem, connection, digest, encoded


class RadiationRuntime:
    def __init__(self, path: Path, *, monotonic_ms: Callable[[], int] | None = None,
                 utc_now: Callable[[], datetime] | None = None):
        self.path = path
        self.monotonic_ms = monotonic_ms or (lambda: time.monotonic_ns() // 1_000_000)
        self.utc_now = utc_now or (lambda: datetime.now(UTC))
        self.lock = threading.RLock()
        self.anchor: int | None = None
        self.enabled = os.getenv('HEALTH_RADIATION_ENABLED', '1') == '1'
        self.degraded = False

    def ensure_started(self) -> None:
        if not self.enabled:
            return
        with self.lock:
            now = self.monotonic_ms()
            with connection(self.path, write=True) as db:
                mode = os.getenv('HEALTH_RADIATION_SOURCE', 'simulation')
                if mode not in ('simulation', 'json'):
                    raise Problem(503, 'RADIATION_CONFIG_INVALID', 'Unknown radiation source configuration.')
                ensure_radiation_started(db, self.utc_now(), mode, os.getenv('HEALTH_RADIATION_SOURCE_ID', 'demo'))
            if self.anchor is None:
                self.anchor = now

    def advance(self, db, state: Data, now: int) -> bool:
        stamp = utc_text(self.utc_now())
        if state['sourceMode'] == 'json':
            received = state['lastReceivedAt']
            if received and (self.utc_now() - datetime.fromisoformat(received)).total_seconds() > 5 and state['sourceStatus'] == 'fresh':
                state.update(sourceStatus='stale', checkpointAt=stamp)
                return True
            return False
        elapsed = max(0, now - self.anchor) if self.anchor is not None else 0
        if not elapsed:
            return False
        end = state['elapsedMs'] + elapsed
        dose = integrate_dose(Decimal(state['rate']), elapsed)
        add_segment(db, state, state['elapsedMs'], end, state['rate'], dose)
        state.update(elapsedMs=end, cumulative=str(Decimal(state['cumulative']) + dose),
                     checkpointAt=stamp, lastValidAt=stamp, lastObservedAt=stamp, sourceStatus='fresh')
        return True

    def checkpoint(self) -> None:
        if not self.enabled:
            return
        with self.lock:
            now = self.monotonic_ms()
            with connection(self.path, write=True) as db:
                state = mission(db)
                if state is None:
                    return
                if self.advance(db, state, now):
                    state['version'] += 1
                    publish(db, state, 'checkpoint')
            self.anchor = now
            self.degraded = False

    def shutdown(self) -> None:
        self.checkpoint()

    def accept_sample(self, command: SampleCommand) -> Data:
        if not self.enabled:
            raise Problem(503, 'RADIATION_DISABLED', 'Radiation monitoring is disabled.')
        with self.lock, connection(self.path, write=True) as db:
            from .demo_store import other_source_blocked
            if other_source_blocked(db):
                raise Problem(409, 'DEMO_SOURCE_ACTIVE', 'The demonstration owns the radiation stream until playback stops.')
            state = mission(db)
            if state is None or state['id'] != command.missionId:
                raise Problem(404, 'NOT_FOUND', 'Unknown radiation mission.')
            if state['sourceMode'] != 'json' or state['sourceId'] != command.sourceId:
                raise Problem(409, 'SOURCE_MODE_CONFLICT', 'The sample does not match the configured source.')
            raw = command.model_dump_json()
            fingerprint = digest(raw)
            prior = db.execute('SELECT body_hash,result FROM radiation_samples WHERE mission_id=? AND source_id=? AND message_id=?',
                               (state['id'], command.sourceId, command.messageId)).fetchone()
            if prior:
                if prior['body_hash'] != fingerprint:
                    raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'This sample ID has different content.')
                return json.loads(prior['result'])
            sample = command.sample
            end = sample.missionElapsedMs
            if state['hasSample'] and end <= state['elapsedMs']:
                raise Problem(409, 'OUT_OF_ORDER', 'Samples must advance mission time.')
            epoch = utc_text(sample.timestamp - timedelta(milliseconds=end))
            if state['sourceEpoch'] is not None and state['sourceEpoch'] != epoch:
                raise Problem(422, 'SOURCE_TIME_CONFLICT', 'Timestamp and mission time must use the same epoch.')
            stamp = utc_text(self.utc_now())
            previous_time = state['elapsedMs']
            gap = end - previous_time
            rate = sample.radiation_rate_usv_h
            cumulative = sample.cumulative_radiation_msv
            previous = Decimal(state['cumulative'])
            valid = True
            continuous = (state['hasSample'] and state['sourceStatus'] == 'fresh' and state['rate'] is not None
                          and (rate is not None or cumulative is not None)
                          and gap <= 5000 and state['lastReceivedAt'] is not None
                          and (self.utc_now() - datetime.fromisoformat(state['lastReceivedAt'])).total_seconds() <= 5)
            dose: Decimal | None = None
            if cumulative is not None:
                state['authority'] = 'source'
                if cumulative < previous:
                    valid = False
                else:
                    dose = cumulative - previous
                    state.update(cumulative=str(cumulative), coverage='complete')
            elif state['authority'] == 'source':
                valid = False
            elif continuous:
                dose = integrate_dose(Decimal(state['rate']), gap)
                state['cumulative'] = str(previous + dose)
            elif state['hasSample'] or end > 0:
                state['coverage'] = 'partial' if state['hasSample'] else 'unknown'
            else:
                state['coverage'] = 'complete'
            if rate is None and cumulative is None:
                valid = False
            if gap:
                add_segment(db, state, previous_time, end, state['rate'] if continuous else None,
                            dose if continuous and valid else None, 'good' if continuous and valid else 'missing')
            # An external label controls event history; it is not inferred from a dose threshold.
            if sample.radiation_event != state['event']:
                boundary = state['cumulative'] if valid and state['coverage'] == 'complete' else None
                active = state['activeEvent']
                if active:
                    row = db.execute('SELECT document FROM radiation_events WHERE id=?', (active['id'],)).fetchone()
                    db.execute('UPDATE radiation_events SET document=? WHERE id=?',
                        (encoded({**json.loads(row[0]), 'endedMs': end, 'endCumulativeMsv': boundary}), active['id']))
                active = None
                if sample.radiation_event != 'background':
                    active = {'id': str(uuid4()), 'type': sample.radiation_event, 'preset': None,
                              'startedMs': end, 'startCumulativeMsv': boundary}
                    db.execute('INSERT INTO radiation_events VALUES(?,?,?)',
                               (active['id'], state['id'], encoded({**active, 'actor': command.sourceId})))
                state['activeEvent'] = active
                state['controlVersion'] += 1
            state.update(elapsedMs=end, checkpointAt=stamp, lastObservedAt=utc_text(sample.timestamp),
                         lastReceivedAt=stamp, sourceEpoch=epoch, hasSample=True,
                         rate=str(rate) if rate is not None else None, event=sample.radiation_event,
                         sourceStatus='fresh' if valid else 'unavailable',
                         missingReason=sample.missingReason or ('source_missing' if cumulative is None else 'cumulative_regression'))
            if valid:
                state['lastValidAt'] = stamp
            state['version'] += 1
            publish(db, state, command.messageId)
            result = read_radiation(db, 'system', None)
            assert result is not None
            db.execute('INSERT INTO radiation_samples(mission_id,source_id,message_id,mission_elapsed_ms,observed_at,received_at,body_hash,document,result) VALUES(?,?,?,?,?,?,?,?,?)',
                (state['id'], command.sourceId, command.messageId, end, utc_text(sample.timestamp), stamp, fingerprint, raw, encoded(result)))
            return result

    def apply_event(self, actor: str, action: RadiationEventAction) -> Data:
        if not self.enabled:
            raise Problem(503, 'RADIATION_DISABLED', 'Radiation monitoring is disabled.')
        self.ensure_started()
        with self.lock:
            now = self.monotonic_ms()
            with connection(self.path, write=True) as db:
                state = mission(db)
                assert state is not None
                if state['sourceMode'] != 'simulation':
                    raise Problem(409, 'SOURCE_MODE_CONFLICT', 'This mission uses an external source.')
                context = f'{WORKSPACE}:radiation:{state["id"]}'
                fingerprint = digest('/v1/radiation/demo-event:' + action.model_dump_json())
                prior = db.execute('SELECT hash,result FROM receipts WHERE context_key=? AND actor=? AND command=?',
                                   (context, actor, action.commandId)).fetchone()
                if prior:
                    if prior['hash'] != fingerprint:
                        raise Problem(409, 'IDEMPOTENCY_CONFLICT', 'This command has different content.')
                    return json.loads(prior['result'])
                if action.expectedControlVersion != state['controlVersion']:
                    raise Problem(409, 'VERSION_CONFLICT', 'Reload the current event state.', current_version=state['controlVersion'])
                active = state['activeEvent']
                if action.action == 'start' and active:
                    raise Problem(409, 'EVENT_ALREADY_ACTIVE', 'End the active simulation event first.')
                if action.action == 'end' and (not active or active['id'] != action.eventId):
                    raise Problem(409, 'EVENT_NOT_ACTIVE', 'This event is no longer active.')
                self.advance(db, state, now)
                if action.action == 'start':
                    kind = 'radiation_event' if action.preset == 'spe' else 'elevated_exposure'
                    active = {'id': str(uuid4()), 'type': kind, 'preset': action.preset,
                              'startedMs': state['elapsedMs'], 'startCumulativeMsv': state['cumulative']}
                    db.execute('INSERT INTO radiation_events VALUES(?,?,?)',
                               (active['id'], state['id'], encoded({**active, 'actor': actor, 'modelVersion': 'radiation-demo-v1'})))
                    state.update(activeEvent=active, rate='750' if action.preset == 'spe' else '150', event=kind)
                else:
                    row = db.execute('SELECT document FROM radiation_events WHERE id=?', (active['id'],)).fetchone()
                    event = {**json.loads(row[0]), 'endedMs': state['elapsedMs'], 'endCumulativeMsv': state['cumulative']}
                    db.execute('UPDATE radiation_events SET document=? WHERE id=?', (encoded(event), active['id']))
                    state.update(activeEvent=None, rate='75', event='background')
                add_segment(db, state, state['elapsedMs'], state['elapsedMs'], state['rate'], Decimal(0))
                state['controlVersion'] += 1
                state['version'] += 1
                publish(db, state, action.commandId)
                result = read_radiation(db, 'system', None)
                assert result is not None
                db.execute('INSERT INTO receipts VALUES(?,?,?,?,?)', (context, actor, action.commandId, fingerprint, encoded(result)))
            self.anchor = now
            return result
