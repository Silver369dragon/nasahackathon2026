"""Bounded, streaming reader for the fictional crew-demo/1 archive."""
import hashlib
import json
import math
from collections.abc import Iterator
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from .body_import import BodyImport
from .models import Metric, check_context, utc_text
from .news2 import Inputs
from .radiation_import import RadiationImport

CREW = ('mira', 'kai', 'lin', 'noa', 'sol')
DAY_MS = 86400000
UNITS = {'heart_rate': '/min', 'spo2': '%', 'respiratory_rate': '/min',
         'blood_pressure_systolic': 'mm[Hg]', 'blood_pressure_diastolic': 'mm[Hg]',
         'temperature': 'Cel'}
COUNTS = {'profiles.json': 5, 'body.json': 25, 'radiation.json': 5,
          'activities.json': 5, 'expected.json': 1, 'history.jsonl': 216000,
          'live.jsonl': 1505, 'assessments.jsonl': 926}
MAX_BYTES = 512 * 1024 * 1024
MAX_LINE = 1024 * 1024
MAX_JSON = 8 * 1024 * 1024


def activity_at(crew_id: str, t_ms: int) -> dict:
    if crew_id not in CREW:
        raise ValueError('Unknown fictional crew ID')
    if crew_id == 'kai':
        for start, end, activity, upcoming in ((0, 60000, 'rest', 'exercise'),
                (60000, 120000, 'exercise', 'recovery'), (120000, 180000, 'recovery', 'rest'),
                (180000, 300001, 'rest', None)):
            if start <= t_ms < end:
                return {'crewId': crew_id, 'activity': activity, 'next': upcoming,
                        'phase': activity, 'phaseStartMs': start}
    return {'crewId': crew_id, 'activity': 'rest', 'next': None, 'phase': 'rest', 'phaseStartMs': 0}


def body_import_payload(section: dict, anchor: datetime) -> dict:
    scans = []
    for original in section['scans']:
        scan = {key: value for key, value in original.items() if key != 'observedMs'}
        scan['observedAt'] = utc_text(anchor + timedelta(milliseconds=original['observedMs']))
        scan['findings'] = [{**{k: v for k, v in finding.items() if k != 'onsetMs'},
                             'onsetAt': utc_text(anchor + timedelta(milliseconds=finding['onsetMs']))}
                            for finding in original['findings']]
        scans.append(scan)
    return {'scans': scans}


def radiation_import_payload(section: dict, anchor: datetime) -> dict:
    return {'profiles': [{'crewId': profile['crewId'], 'experienceYears': profile['experienceYears'],
             'history': [{**{k: v for k, v in exposure.items() if k not in ('startMs', 'endMs')},
                          'startAt': utc_text(anchor + timedelta(milliseconds=exposure['startMs'])),
                          'endAt': utc_text(anchor + timedelta(milliseconds=exposure['endMs']))}
                         for exposure in profile['priorExposure']]}
                        for profile in section['profiles']],
            'environment': [{**{k: v for k, v in point.items() if k != 'tMs'},
                              'timestamp': utc_text(anchor + timedelta(milliseconds=point['tMs']))}
                             for point in section['environment']]}


def _load(data: bytes) -> object:
    def reject_constant(value):
        raise ValueError('Non-finite JSON number: ' + value)

    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON object key')
            result[key] = value
        return result

    def finite_float(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError('Non-finite JSON number')
        return number

    return json.loads(data, parse_constant=reject_constant, parse_float=finite_float,
                      object_pairs_hook=unique_keys)


class DemoBundle:
    """No extraction and no full history materialization. Call validate before writes."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        if self.path.stat().st_size > MAX_BYTES:
            raise ValueError('Archive exceeds 512 MiB')
        try:
            self.archive = ZipFile(self.path)
        except BadZipFile as exc:
            raise ValueError('Invalid demo ZIP archive') from exc
        try:
            entries = self.archive.infolist()
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)) or set(names) != set(COUNTS) | {'manifest.json'}:
                raise ValueError('Missing, duplicate or unexpected archive entry')
            if sum(entry.file_size for entry in entries) > MAX_BYTES:
                raise ValueError('Expanded archive exceeds 512 MiB')
            if any(entry.flag_bits & 1 or entry.is_dir() or entry.file_size < 0
                   or (entry.external_attr >> 16) & 0o170000 == 0o120000 for entry in entries):
                raise ValueError('Encrypted, directory or symlink entry is forbidden')
            self.manifest = self.json('manifest.json')
            if (not isinstance(self.manifest, dict) or self.manifest.get('schemaVersion') != 'crew-demo/1'
                    or self.manifest.get('synthetic') is not True or self.manifest.get('liveDurationMs') != 300000
                    or self.manifest.get('datasetId') != 'crew-demo-v3'
                    or type(self.manifest.get('seed')) is not int
                    or set(self.manifest.get('files', {})) != set(COUNTS)):
                raise ValueError('Unsupported demo manifest')
        except Exception:
            self.archive.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def close(self) -> None:
        self.archive.close()

    def json(self, name: str):
        if name not in set(COUNTS) | {'manifest.json'} or not name.endswith('.json'):
            raise ValueError('Unsupported JSON section')
        with self.archive.open(name) as section:
            data = section.read(MAX_JSON + 1)
        if len(data) > MAX_JSON:
            raise ValueError('JSON section exceeds bounded size')
        return _load(data)

    def rows(self, name: str) -> Iterator[dict]:
        if name not in ('history.jsonl', 'live.jsonl', 'assessments.jsonl'):
            raise ValueError('Unsupported JSONL section')
        with self.archive.open(name) as section:
            while line := section.readline(MAX_LINE + 1):
                if len(line) > MAX_LINE or not line.endswith(b'\n'):
                    raise ValueError('Oversized or unterminated JSONL row')
                row = _load(line)
                if not isinstance(row, dict):
                    raise ValueError('JSONL rows must be objects')  # noqa: TRY004
                yield row

    def validate(self) -> dict:
        for name, expected_count in COUNTS.items():
            info = self.manifest['files'][name]
            if not isinstance(info, dict) or type(info.get('count')) is not int or info.get('count') != expected_count:
                raise ValueError('Manifest count does not match contract: ' + name)
            checksum = hashlib.sha256()
            with self.archive.open(name) as section:
                while chunk := section.read(MAX_LINE):
                    checksum.update(chunk)
            if checksum.hexdigest() != info.get('sha256'):
                raise ValueError('Archive checksum mismatch: ' + name)
        self._validate_json_sections()
        for name in ('history.jsonl', 'live.jsonl'):
            count = 0
            for count, row in enumerate(self.rows(name), 1):
                self._validate_packet(row, name, count - 1)
            if count != COUNTS[name]:
                raise ValueError('Actual row count mismatch: ' + name)
        count = 0
        for count, row in enumerate(self.rows('assessments.jsonl'), 1):
            self._validate_assessment(row, count - 1)
        if count != COUNTS['assessments.jsonl']:
            raise ValueError('Actual assessment count mismatch')
        return self.manifest

    def _validate_json_sections(self) -> None:
        from datetime import UTC
        anchor = datetime(2020, 1, 1, tzinfo=UTC)
        profiles = self.json('profiles.json')
        if not isinstance(profiles, list) or [p['crewId'] for p in profiles] != list(CREW):
            raise ValueError('Five ordered crew profiles are required')
        for profile in profiles:
            birthday = datetime.fromisoformat(profile['dateOfBirth'])
            if birthday.year > 2000 or not 100 <= profile['heightCm'] <= 230 or profile['synthetic'] is not True:
                raise ValueError('Profiles require explicit synthetic adult demographics')
            for key in ('medicalHistory', 'medications', 'allergies'):
                if profile[key] != {'status': 'none_reported', 'items': []}:
                    raise ValueError('Explicit fictional clinical-history status required')
        body = self.json('body.json')
        parsed_body = BodyImport.model_validate(body_import_payload(body, anchor))
        if len(parsed_body.scans) != 25:
            raise ValueError('Exactly 25 body scans are required')
        for crew in CREW:
            if sorted(s['observedMs'] for s in body['scans'] if s['crewId'] == crew) != [
                    (day - 31) * DAY_MS for day in (1, 8, 15, 22, 30)]:
                raise ValueError('Body scan observation schedule mismatch')
        radiation = self.json('radiation.json')
        RadiationImport.model_validate(radiation_import_payload(radiation, anchor))
        if radiation['liveRateUsvH'] != 75 or radiation['environment'][-1]['cumulativeMsv'] != 54:
            raise ValueError('Radiation background mismatch')
        for profile in radiation['profiles']:
            if any(exposure['endMs'] > -30 * DAY_MS for exposure in profile['priorExposure']):
                raise ValueError('Prior exposure overlaps the demo history')
        activities = self.json('activities.json')
        if [a['crewId'] for a in activities] != list(CREW) or any(a['synthetic'] is not True for a in activities):
            raise ValueError('Activities require all five synthetic crew')
        for schedule in activities:
            cursor = 0
            for phase in schedule['phases']:
                if phase['startMs'] != cursor or phase['endMs'] <= cursor:
                    raise ValueError('Activity schedule must be contiguous')
                if activity_at(schedule['crewId'], cursor)['activity'] != phase['activity']:
                    raise ValueError('Activity schedule conflicts with replay')
                cursor = phase['endMs']
            if cursor != 300001:
                raise ValueError('Activity schedule must include terminal tick')
        expected = self.json('expected.json')
        if expected.get('synthetic') is not True or expected.get('clinicalUse') is not False:
            raise ValueError('Expected answers must be synthetic test-only evidence')

    @staticmethod
    def _validate_packet(row: dict, name: str, index: int) -> None:
        history = name == 'history.jsonl'
        t_ms = (-30 * DAY_MS + index // 5 * 60000) if history else index // 5 * 1000
        crew = CREW[index % 5]
        if (set(row) != {'id', 'crewId', 'tMs', 'metrics'} or row['crewId'] != crew
                or type(row['tMs']) is not int or row['tMs'] != t_ms
                or row['id'] != f'{"h" if history else "l"}:{crew}:{t_ms}'):
            raise ValueError('Packet identity/order/time mismatch')
        full = t_ms % (14400000 if history else 60000) == 0 or (not history and crew == 'sol' and t_ms == 200000)
        if [m.get('code') for m in row['metrics']] != list(UNITS)[:6 if full else 3]:
            raise ValueError('Packet metric cadence mismatch')
        for item in row['metrics']:
            parsed = Metric.model_validate(item)
            check_context(parsed.code, parsed.context)
            if parsed.method != 'synthetic-training-v3':
                raise ValueError('Explicit synthetic measurement method is required')
            cadence = item['context'].get('analysisCadenceSeconds')
            expected_cadence = (60 if history else 1) if parsed.code in tuple(UNITS)[:3] else (14400 if history else 60)
            if type(cadence) not in (float, int) or not math.isfinite(cadence) or cadence != expected_cadence:
                raise ValueError('Contract numeric cadence is required')
            if item['context'].get('activity') not in ('rest', 'exercise'):
                raise ValueError('Explicit rest or exercise measurement activity is required')

    @staticmethod
    def _validate_assessment(row: dict, index: int) -> None:
        if index < 900:
            t_ms, crew, phase = -30 * DAY_MS + index // 5 * 14400000, CREW[index % 5], 'history'
        else:
            pos = index - 900
            if pos < 15:
                t_ms, crew = (pos // 5 + 1) * 60000, CREW[pos % 5]
            elif pos == 15:
                t_ms, crew = 200000, 'sol'
            else:
                t_ms, crew = (4 + (pos - 16) // 5) * 60000, CREW[(pos - 16) % 5]
            phase = 'live'
        if (row['crewId'] != crew or row['tMs'] != t_ms or row['phase'] != phase
                or row['id'] != f'a:{"h" if phase == "history" else "l"}:{crew}:{t_ms}'
                or row['observationEndMs'] != t_ms or row['observationStartMs'] != t_ms - 60000):
            raise ValueError('Assessment identity/time/window mismatch')
        Inputs.model_validate(row['inputs'])
        if not set(row['poorQuality']) <= set(UNITS) - {'blood_pressure_diastolic'}:
            raise ValueError('Invalid assessment quality field')
