"""One persisted exposure ledger, projected to the existing five crew identities."""
import json
import sqlite3
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from .models import utc_text
from .radiation import (
    COMPARABILITY,
    MODEL,
    RadiationSnapshot,
    history_total,
    project_radiation,
)
from .store import WORKSPACE, Data, Problem, append_event, encoded, now_text

RADIATION_SCHEMA = """
CREATE TABLE IF NOT EXISTS radiation_missions(
    id TEXT PRIMARY KEY, workspace TEXT UNIQUE NOT NULL, document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS radiation_profiles(
    crew_id TEXT PRIMARY KEY REFERENCES crew(id), experience_years INTEGER NOT NULL,
    history_status TEXT NOT NULL, seed_version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS radiation_history(
    id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crew(id), start_at TEXT NOT NULL,
    end_at TEXT NOT NULL, document TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS radiation_history_owner ON radiation_history(crew_id,start_at,id);
CREATE TABLE IF NOT EXISTS radiation_segments(
    id INTEGER PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES radiation_missions(id),
    start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, is_open INTEGER NOT NULL,
    rate_usv_h TEXT, event_id TEXT, quality TEXT NOT NULL, dose_msv_decimal TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS radiation_open_segment ON radiation_segments(mission_id) WHERE is_open=1;
CREATE INDEX IF NOT EXISTS radiation_segment_time ON radiation_segments(mission_id,start_ms,id);
CREATE TABLE IF NOT EXISTS radiation_samples(
    id INTEGER PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES radiation_missions(id),
    source_id TEXT NOT NULL, message_id TEXT NOT NULL, mission_elapsed_ms INTEGER NOT NULL,
    observed_at TEXT NOT NULL, received_at TEXT NOT NULL, body_hash TEXT NOT NULL,
    document TEXT NOT NULL, result TEXT NOT NULL, UNIQUE(mission_id,source_id,message_id));
CREATE TABLE IF NOT EXISTS radiation_events(
    id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES radiation_missions(id), document TEXT NOT NULL);
"""

HISTORY = {
    'lin': (8, [(-900, -840), (-400, -340)]),
    'kai': (6, [(-700, -655), (-250, -205)]),
    'mira': (4, [(-180, -140)]), 'noa': (2, [(-60, -50)]),
    'sol': (10, [(-1800, -1740), (-1200, -1150), (-600, -550)]),
}


def mission(db: sqlite3.Connection) -> Data | None:
    row = db.execute('SELECT document FROM radiation_missions WHERE workspace=?', (WORKSPACE,)).fetchone()
    return json.loads(row[0]) if row else None


def save_mission(db: sqlite3.Connection, state: Data) -> None:
    db.execute('UPDATE radiation_missions SET document=? WHERE id=?', (encoded(state), state['id']))


def ensure_radiation_started(db: sqlite3.Connection, now_utc: datetime, source_mode: str,
                             source_id: str = 'demo') -> Data:
    prior = mission(db)
    if prior:
        profiles = {r[0] for r in db.execute('SELECT crew_id FROM radiation_profiles')}
        histories = db.execute("SELECT COUNT(*) FROM radiation_history WHERE id LIKE 'radiation-history-v1:%'").fetchone()[0]
        if not set(HISTORY).issubset(profiles) or histories != 9:
            raise Problem(503, 'RADIATION_STATE_INCONSISTENT', 'Saved radiation history is incomplete; no data was reset.')
        return prior
    if db.execute('SELECT COUNT(*) FROM radiation_profiles').fetchone()[0]:
        raise Problem(503, 'RADIATION_STATE_INCONSISTENT', 'Radiation history requires repair; no data was reset.')
    stamp = utc_text(now_utc)
    state: Data = {'id': str(uuid4()), 'startedAt': stamp, 'elapsedMs': 0, 'checkpointAt': stamp,
        'sourceMode': source_mode, 'sourceId': source_id, 'sourceEpoch': None,
        'rate': '75' if source_mode == 'simulation' else None, 'event': 'background',
        'cumulative': '0', 'authority': 'estimated', 'coverage': 'complete' if source_mode == 'simulation' else 'unknown',
        'sourceStatus': 'fresh' if source_mode == 'simulation' else 'unavailable',
        'lastObservedAt': stamp if source_mode == 'simulation' else None, 'lastReceivedAt': None,
        'lastValidAt': stamp if source_mode == 'simulation' else None,
        'activeEvent': None, 'version': 1, 'controlVersion': 0, 'hasSample': False,
        'modelVersion': MODEL, 'seedVersion': 'radiation-history-v1'}
    db.execute('INSERT INTO radiation_missions VALUES(?,?,?)', (state['id'], WORKSPACE, encoded(state)))
    for crew, (years, periods) in HISTORY.items():
        db.execute('INSERT INTO radiation_profiles VALUES(?,?,?,?)', (crew, years, 'complete', state['seedVersion']))
        for index, (start, end) in enumerate(periods, 1):
            record = {'id': f'radiation-history-v1:{crew}-{index:02}', 'crewId': crew,
                'missionLabel': f'Synthetic deep-space mission {index}',
                'startAt': utc_text(now_utc + timedelta(days=start)),
                'endAt': utc_text(now_utc + timedelta(days=end)), 'exposureDays': end - start,
                'referenceRateUsvH': 75, 'doseEquivalentMsv': float(Decimal(end - start) * Decimal('1.8')),
                'quantity': 'dose_equivalent_estimate', 'unit': 'mSv', 'comparabilityKey': COMPARABILITY,
                'method': 'synthetic-historical-exposure-v1', 'modelVersion': 'synthetic-historical-exposure-v1',
                'isSimulated': True, 'seedVersion': state['seedVersion']}
            db.execute('INSERT INTO radiation_history VALUES(?,?,?,?,?)',
                       (record['id'], crew, record['startAt'], record['endAt'], encoded(record)))
    if source_mode == 'simulation':
        add_segment(db, state, 0, 0, '75', Decimal(0))
    publish(db, state, 'initialize')
    return state


def add_segment(db: sqlite3.Connection, state: Data, start: int, end: int,
                rate: str | None, dose: Decimal | None, quality: str = 'good') -> None:
    event_id = state['activeEvent']['id'] if state['activeEvent'] else None
    previous = db.execute('SELECT * FROM radiation_segments WHERE mission_id=? AND is_open=1', (state['id'],)).fetchone()
    if previous and (previous['end_ms'], previous['rate_usv_h'], previous['event_id'], previous['quality']) == (start, rate, event_id, quality):
        total = str(Decimal(previous['dose_msv_decimal']) + dose) if dose is not None else None
        db.execute('UPDATE radiation_segments SET end_ms=?,dose_msv_decimal=? WHERE id=?', (end, total, previous['id']))
        return
    db.execute('UPDATE radiation_segments SET is_open=0 WHERE mission_id=?', (state['id'],))
    db.execute('INSERT INTO radiation_segments(mission_id,start_ms,end_ms,is_open,rate_usv_h,event_id,quality,dose_msv_decimal) VALUES(?,?,?,1,?,?,?,?)',
               (state['id'], start, end, rate, event_id, quality, str(dose) if dose is not None else None))


def read_radiation(db: sqlite3.Connection, view: str, crew_id: str | None) -> Data | None:
    state = mission(db)
    if state is None:
        return None
    fresh = state['sourceStatus'] == 'fresh'
    current = float(state['cumulative']) if fresh and state['lastValidAt'] else None
    people = []
    for profile in db.execute('SELECT * FROM radiation_profiles ORDER BY crew_id'):
        records = [json.loads(r[0]) for r in db.execute('SELECT document FROM radiation_history WHERE crew_id=?', (profile['crew_id'],))]
        summary = history_total(records)
        if profile['history_status'] != 'complete':
            summary.update(historyStatus=profile['history_status'], historyMsv=None)
        total = None
        if summary['historyMsv'] is not None and current is not None and state['coverage'] == 'complete':
            total = float(Decimal(str(summary['historyMsv'])) + Decimal(state['cumulative']))
        people.append({'crewId': profile['crew_id'], 'experienceYears': profile['experience_years'],
                       **summary, 'currentMsv': current, 'comparableTotalMsv': total, 'comparabilityKey': COMPARABILITY})
    rows = db.execute('SELECT * FROM radiation_segments WHERE mission_id=? AND end_ms>=? ORDER BY start_ms,id',
                      (state['id'], max(0, state['elapsedMs'] - 300_000))).fetchall()
    points = []
    for row in rows:
        value = float(row['rate_usv_h']) if row['rate_usv_h'] is not None and row['quality'] == 'good' else None
        points.extend([{'elapsedMs': max(row['start_ms'], state['elapsedMs'] - 300_000), 'rateUsvH': value},
                       {'elapsedMs': row['end_ms'], 'rateUsvH': value}])
    active = state['activeEvent']
    if active:
        boundary = active['startCumulativeMsv']
        added = None
        if fresh and state['coverage'] == 'complete' and boundary is not None:
            added = float(Decimal(state['cumulative']) - Decimal(boundary))
        active = {**active, 'eventAddedMsv': added}
    snapshot = RadiationSnapshot(missionId=state['id'], version=state['version'], controlVersion=state['controlVersion'],
        startedAt=state['startedAt'], elapsedMs=state['elapsedMs'], checkpointAt=state['checkpointAt'], serverTime=now_text(),
        sourceMode=state['sourceMode'], environment={'rateUsvH': float(state['rate']) if fresh and state['rate'] is not None else None,
            'radiationEvent': state['event'], 'sourceStatus': state['sourceStatus'], 'lastObservedAt': state['lastObservedAt'],
            'lastReceivedAt': state['lastReceivedAt'], 'eventId': active['id'] if active else None, 'modelVersion': MODEL},
        sharedExposure={'currentMsv': current, 'lastValidCurrentMsv': float(state['cumulative']) if state['lastValidAt'] else None,
            'lastValidAt': state['lastValidAt'], 'cumulativeAuthority': state['authority'], 'coverage': state['coverage']},
        crewExposure=people, activeEvent=active, recentRatePoints=points[-300:]).model_dump()
    return project_radiation(snapshot, view, crew_id)


def publish(db: sqlite3.Connection, state: Data, cause: str) -> None:
    save_mission(db, state)
    snapshot = read_radiation(db, 'system', None)
    assert snapshot is not None
    append_event(db, '__radiation__', 'radiation.updated', snapshot, state['version'], state['id'], cause)
