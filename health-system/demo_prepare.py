"""Build a complete candidate database without touching an existing live database."""
import argparse
import hashlib
import json
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from backend.baselines import CreateBaseline, create
from backend.body_import import BodyImport, apply_body_import
from backend.demo_bundle import (
    DemoBundle,
    body_import_payload,
    radiation_import_payload,
)
from backend.demo_observations import save_observation
from backend.demo_runtime import packet_for
from backend.demo_store import initialize_demo, save_config
from backend.models import utc_text
from backend.radiation import COMPARABILITY
from backend.radiation_import import RadiationImport, apply_radiation_import
from backend.radiation_store import ensure_radiation_started, publish
from backend.store import (
    CREW,
    connection,
    encoded,
    initialize,
    update_summary,
    write_measurements,
)

METRICS = ('heart_rate', 'spo2', 'respiratory_rate', 'blood_pressure_systolic',
           'blood_pressure_diastolic', 'temperature')


def emit(stage: str, **details) -> None:
    print(json.dumps({'stage': stage, **details}), flush=True)


def prepare(archive: Path, target: Path, prepared_at: datetime | None = None) -> dict:
    target = target.resolve()
    staging = target.with_name(target.name + '.building')
    if target.exists() or staging.exists():
        raise ValueError('Destination or its staging database already exists; use a new candidate path.')
    origin = (prepared_at or datetime.now(UTC)).replace(microsecond=0)
    instance = 'd' + uuid4().hex
    started = time.monotonic()
    with DemoBundle(archive) as bundle:
        manifest = bundle.validate()
        emit('validated', datasetId=manifest['datasetId'])
        initialize(staging)
        observations = {(r['crewId'], r['tMs']): r for r in bundle.rows('assessments.jsonl') if r['phase'] == 'history'}
        live_observations = [r for r in bundle.rows('assessments.jsonl') if r['phase'] == 'live']
        with connection(staging, write=True) as db:
            initialize_demo(db)
            for profile in bundle.json('profiles.json'):
                db.execute('INSERT INTO demo_profiles VALUES(?,?)', (profile['crewId'], encoded(profile)))
            state = ensure_radiation_started(db, origin, 'json', 'crew-demo')
            db.execute('DELETE FROM radiation_history')
            apply_radiation_import(db, RadiationImport.model_validate(radiation_import_payload(bundle.json('radiation.json'), origin)),
                                   manifest['datasetId'])
            for crew in CREW:
                record = {'id': f'crew-demo-month:{crew}', 'crewId': crew,
                          'missionLabel': 'Synthetic 30-day mission history',
                          'startAt': utc_text(origin - timedelta(days=30)), 'endAt': utc_text(origin),
                          'exposureDays': 30, 'referenceRateUsvH': 75, 'doseEquivalentMsv': 54,
                          'quantity': 'dose_equivalent_estimate', 'unit': 'mSv', 'comparabilityKey': COMPARABILITY,
                          'method': 'synthetic-historical-exposure-v1', 'modelVersion': 'crew-demo/1',
                          'isSimulated': True, 'seedVersion': 'crew-demo/1', 'exposurePeriod': 'prepared_history'}
                db.execute('INSERT INTO radiation_history VALUES(?,?,?,?,?)',
                           (record['id'], crew, record['startAt'], record['endAt'], encoded(record)))
            state.update(seedVersion='crew-demo/1', sourceMode='json', sourceId='crew-demo')
            db.execute("UPDATE radiation_profiles SET seed_version='crew-demo/1'")
            publish(db, state, 'demo-history')
            apply_body_import(db, BodyImport.model_validate(body_import_payload(bundle.json('body.json'), origin)), instance)
        count = 0
        iterator = bundle.rows('history.jsonl')
        while True:
            chunk = []
            for _ in range(1000):
                row = next(iterator, None)
                if row is None:
                    break
                chunk.append(row)
            if not chunk:
                break
            with connection(staging, write=True) as db:
                for row in chunk:
                    packet = packet_for(row, instance, origin, live=False)
                    result = write_measurements(db, packet, packet.deviceId, row['crewId'], False, refresh_summary=False)
                    assessment = observations.get((row['crewId'], row['tMs']))
                    if assessment:
                        ids = {m['code']: ident for m, ident in zip(row['metrics'], result['measurementIds'], strict=True)}
                        save_observation(db, assessment, instance, origin, ids)
            count += len(chunk)
            if count % 10000 == 0:
                emit('history', samples=count)
        emit('baselines')
        cutoff = utc_text(origin - timedelta(days=7))
        for crew in CREW:
            for metric in METRICS:
                with connection(staging, write=True) as db:
                    sample = db.execute("SELECT id FROM measurements WHERE crew_id=? AND metric=? AND observed<? "
                                        "AND json_extract(document,'$.context.activity')='rest' AND quality='good' "
                                        "ORDER BY observed DESC LIMIT 1", (crew, metric, cutoff)).fetchone()
                    if sample is None:
                        raise ValueError(f'No baseline sample for {crew}/{metric}')
                    baseline, _ = create(db, crew, CreateBaseline(commandId=f'{instance}:{crew}:{metric}',
                                                                  measurementId=sample[0], referenceTo=datetime.fromisoformat(cutoff)))
                    emit('baseline', crew=crew, metric=metric, count=baseline['count'])
        with archive.open('rb') as source:
            archive_hash = hashlib.file_digest(source, 'sha256').hexdigest()
        config = {'schemaVersion': 'crew-demo/1', 'datasetId': manifest['datasetId'], 'datasetInstanceId': instance,
                  'preparedAt': utc_text(origin), 'archivePath': str(archive.resolve()),
                  'archiveHash': archive_hash,
                  'historySamples': count, 'durationMs': 300000}
        with connection(staging, write=True) as db:
            save_config(db, config)
            db.execute('INSERT INTO demo_payload VALUES(1,?)', (encoded({'rows': list(bundle.rows('live.jsonl')),
                                                                         'observations': live_observations}),))
            for crew in CREW:
                update_summary(db, crew, 'demo-prepared')
            counts = {table: db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                      for table in ('measurements', 'fixed_baselines', 'fixed_analyses', 'body_scans',
                                    'news2_versions', 'radiation_history')}
            assert counts['fixed_baselines'] == 30 and counts['news2_versions'] == 900 and counts['body_scans'] == 25
            assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        with sqlite3.connect(staging) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        db.close()
        staging.rename(target)
        report = {**config, 'database': str(target), 'counts': counts, 'integrity': 'ok',
                  'elapsedSeconds': round(time.monotonic() - started, 2)}
        target.with_suffix('.preparation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        emit('prepared', **report)
        return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.dataset, args.output)


if __name__ == '__main__':
    main()
