"""Reproducible, entirely fictional five-person training archive generator."""
import argparse
import hashlib
import json
import math
from collections.abc import Iterator
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from backend.demo_bundle import CREW, DAY_MS, UNITS, activity_at

SEED = 20261115
DATASET_ID = 'crew-demo-v3'
BASES = ((68., 98., 15., 118., 76., 36.7), (64., 98.5, 14., 116., 74., 36.6),
         (74., 97.5, 16., 122., 78., 36.8), (72., 98., 15.5, 120., 77., 36.7),
         (70., 98.5, 14.5, 119., 75., 36.6))
CODES = tuple(UNITS)
EXPERIENCE = (5, 3, 10, 1, 8)
PRIOR_DAYS = (40, 30, 120, 10, 90)


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                      allow_nan=False).encode('utf-8')


def profiles() -> list[dict]:
    return [{'crewId': crew, 'displayName': crew.title(), 'synthetic': True,
             'dateOfBirth': f'{1985 + i * 2}-06-15', 'heightCm': float(168 + i * 3),
             'experienceYears': EXPERIENCE[i],
             **{key: {'status': 'none_reported', 'items': []}
                for key in ('medicalHistory', 'medications', 'allergies')}}
            for i, crew in enumerate(CREW)]


def metric(code: str, value: float, activity: str, cadence: int) -> dict:
    context: dict = {'analysisCadenceSeconds': float(cadence), 'activity': activity}
    if code == 'heart_rate':
        context['activity'] = activity
    elif code == 'spo2':
        context['measurementSite'] = 'finger'
    elif code == 'respiratory_rate':
        context['observationDuration'] = 60.
    elif code == 'temperature':
        context.update(measurementSite='oral', temperatureType='body')
    else:
        context['posture'] = 'seated'
    return {'code': code, 'value': value, 'unit': UNITS[code], 'quality': 'good',
            'method': 'synthetic-training-v3', 'context': context}


def packet(crew: str, t_ms: int, *, history: bool) -> dict:
    person = CREW.index(crew)
    step = t_ms // (60000 if history else 1000)
    activity = ('exercise' if step % 1440 in range(1080, 1140) else 'rest') if history else (
        'exercise' if activity_at(crew, t_ms)['activity'] in ('exercise', 'recovery') else 'rest')
    # The coprime cycles avoid constant four-hourly temperature/BP samples.
    wave = ((step * 17 + person * 11 + SEED) % 101 - 50) / 50
    amplitudes = (1.2, .4, .8, 3., 2., .12)
    values = [round(base + wave * amp, 4) for base, amp in zip(BASES[person], amplitudes, strict=True)]
    if activity == 'exercise':
        values[0] += 38.
        values[2] += 5.
    if not history:
        second = t_ms // 1000
        if crew == 'lin' and 120 <= second < 210:
            values[0] = 112.
        if crew == 'lin' and second == 180:
            values = [112., 93., 24., 105., 70., 38.2]
        if crew == 'noa' and second >= 120:
            values[0] = round(72. + min(second - 120, 120) * .1, 4)
        if crew == 'kai' and 60 <= second < 120:
            values[0] = 130. + wave
        elif crew == 'kai' and 120 <= second < 180:
            values[0] = round(102. - (second - 120) * .55, 4)
    full = t_ms % (14400000 if history else 60000) == 0 or (not history and crew == 'sol' and t_ms == 200000)
    metrics = [metric(code, value, activity, (60 if history else 1) if i < 3 else (14400 if history else 60))
               for i, (code, value) in enumerate(zip(CODES, values, strict=True)) if i < 3 or full]
    if not history and crew == 'sol' and 180000 <= t_ms < 210000:
        for item in metrics[:2]:
            item['quality'] = 'poor' if t_ms < 195000 else 'missing'
            item['qualityReason'] = 'synthetic_sensor_motion' if t_ms < 195000 else 'synthetic_sensor_dropout'
            if t_ms >= 195000:
                item['value'] = None
    return {'id': f'{"h" if history else "l"}:{crew}:{t_ms}', 'crewId': crew, 'tMs': t_ms, 'metrics': metrics}


def history_rows() -> Iterator[dict]:
    for t_ms in range(-30 * DAY_MS, 0, 60000):
        for crew in CREW:
            yield packet(crew, t_ms, history=True)


def live_rows() -> Iterator[dict]:
    for t_ms in range(0, 300001, 1000):
        for crew in CREW:
            yield packet(crew, t_ms, history=False)


def assessment(row: dict, phase: str) -> dict:
    values = {m['code']: m['value'] for m in row['metrics']}
    inputs = {key: values[key] for key in CODES if key != 'blood_pressure_diastolic'}
    inputs.update(observationSeconds=60, temperatureSite='oral',
                  temperatureMethod='synthetic-training-v3', spo2_scale='scale1',
                  neurological_assessment='A', supplemental_oxygen=False)
    return {'id': 'a:' + row['id'], 'crewId': row['crewId'], 'tMs': row['tMs'], 'phase': phase,
            'inputs': inputs, 'poorQuality': [m['code'] for m in row['metrics']
                                             if m['quality'] != 'good'],
            'observationStartMs': row['tMs'] - 60000, 'observationEndMs': row['tMs']}


def assessment_rows() -> Iterator[dict]:
    for t_ms in range(-30 * DAY_MS, 0, 14400000):
        for crew in CREW:
            yield assessment(packet(crew, t_ms, history=True), 'history')
    for t_ms in (60000, 120000, 180000, 200000, 240000, 300000):
        for crew in CREW:
            if t_ms == 200000 and crew != 'sol':
                continue
            yield assessment(packet(crew, t_ms, history=False), 'live')


def body() -> dict:
    weights = {'head': .03, 'neck': .012, 'chest': .09, 'abdomen': .075, 'pelvis': .1, 'back': .101}
    for side in ('left_', 'right_'):
        weights.update({side + key: value for key, value in {
            'shoulder': .02, 'upper_arm': .04, 'forearm': .025, 'hand': .01,
            'thigh': .125, 'knee': .015, 'lower_leg': .05, 'foot': .011}.items()})
    total_weight = sum(weights.values())
    scans = []
    for i, crew in enumerate(CREW):
        for day in (1, 8, 15, 22, 30):
            muscle, fat = round(32.4 + i * 1.2 + (day - 1) * .012, 4), round(14.8 + i * .7 - (day - 1) * .008, 4)
            findings = []
            if crew == 'kai' and day >= 15:
                findings = [{'id': 'kai-training-strain', 'regionCode': 'left_thigh', 'kind': 'strain',
                             'severity': 'mild', 'status': 'resolved' if day == 30 else 'recovering',
                             'onsetMs': -16 * DAY_MS, 'functionalImpact': 'synthetic_reduced_load'}]
            scans.append({'id': f'{crew}-scan-day-{day}', 'crewId': crew, 'observedMs': (day - 31) * DAY_MS,
                          'synthetic': True, 'totals': {'bodyMassKg': round(70.2 + i * 2.1, 4),
                          'muscleMassKg': muscle, 'fatMassKg': fat}, 'regions': {
                              key: {'muscleMassKg': round(muscle * value / total_weight, 4),
                                    'fatMassKg': round(fat * value / total_weight, 4),
                                    'quality': 'good', 'missingReason': None} for key, value in weights.items()},
                          'findings': findings})
    return {'scans': scans}


def radiation() -> dict:
    return {'profiles': [{'crewId': crew, 'experienceYears': EXPERIENCE[i], 'priorExposure': [{
        'id': crew + '-prior-1', 'missionLabel': 'Synthetic prior space exposure',
        'startMs': -(31 + PRIOR_DAYS[i]) * DAY_MS, 'endMs': -31 * DAY_MS,
        'exposureDays': PRIOR_DAYS[i], 'referenceRateUsvH': 75.,
        'doseEquivalentMsv': PRIOR_DAYS[i] * 1.8, 'isSimulated': True}]}
        for i, crew in enumerate(CREW)], 'environment': [{
            'tMs': -30 * DAY_MS, 'rateUsvH': 75., 'cumulativeMsv': 0.,
            'radiationEvent': 'background', 'isSimulated': True}, {
            'tMs': 0, 'rateUsvH': 75., 'cumulativeMsv': 54.,
            'radiationEvent': 'background', 'isSimulated': True}], 'liveRateUsvH': 75.}


def independent_news_score(inputs: dict, poor: list) -> int | None:
    """Fixture oracle: intentionally independent of backend scoring implementation."""
    if poor or any(inputs.get(code) is None for code in CODES if code != 'blood_pressure_diastolic'):
        return None
    rr, spo2, sbp, hr, temp = (inputs[k] for k in ('respiratory_rate', 'spo2', 'blood_pressure_systolic', 'heart_rate', 'temperature'))
    return (3 if rr <= 8 or rr >= 25 else 1 if rr <= 11 else 0 if rr <= 20 else 2) + (
        3 if spo2 <= 91 else 2 if spo2 <= 93 else 1 if spo2 <= 95 else 0) + (
        3 if sbp <= 90 or sbp >= 220 else 2 if sbp <= 100 else 1 if sbp <= 110 else 0) + (
        3 if hr <= 40 or hr >= 131 else 1 if hr <= 50 else 0 if hr <= 90 else 1 if hr <= 110 else 2) + (
        3 if temp <= 35 else 1 if temp <= 36 else 0 if temp <= 38 else 1 if temp <= 39 else 2) + (
        0 if inputs['neurological_assessment'] == 'A' else 3) + (2 if inputs['supplemental_oxygen'] else 0)


def expected() -> dict:
    stats: dict = {}
    for row in history_rows():
        if not -14 * DAY_MS <= row['tMs'] < -7 * DAY_MS:
            continue
        for m in row['metrics']:
            if m['context']['activity'] != 'rest':
                continue
            key = row['crewId'] + ':' + m['code']
            state = stats.setdefault(key, [0, 0., 0.])
            state[0] += 1
            delta = m['value'] - state[1]
            state[1] += delta / state[0]
            state[2] += delta * (m['value'] - state[1])
    baselines = [{'crewId': key.split(':')[0], 'metricCode': key.split(':')[1],
                  'fromMs': -14 * DAY_MS, 'toMs': -7 * DAY_MS,
                  'count': value[0], 'mean': value[1], 'sd': math.sqrt(value[2] / (value[0] - 1))}
                 for key, value in sorted(stats.items())]
    scores = [{'id': a['id'], 'crewId': a['crewId'], 'tMs': a['tMs'],
               'news2Score': independent_news_score(a['inputs'], a['poorQuality'])}
              for a in assessment_rows() if a['phase'] == 'live']
    references = {(b['crewId'], b['metricCode']): b for b in baselines}
    states: dict = {}
    checkpoints = []
    for row in live_rows():
        for m in row['metrics']:
            if m['context']['activity'] != 'rest':
                continue
            key = row['crewId'], m['code']
            state = states.setdefault(key, {'ewma': None, 'segment': 0, 'lastMs': None})
            z = None
            if m['quality'] != 'good':
                state['ewma'] = None
                state['segment'] += 1
            else:
                if state['lastMs'] is not None and row['tMs'] - state['lastMs'] > 4 * m['context']['analysisCadenceSeconds'] * 1000:
                    state['ewma'] = None
                    state['segment'] += 1
                reference = references[key]
                z = (m['value'] - reference['mean']) / reference['sd']
                state['ewma'] = z if state['ewma'] is None else .2 * z + .8 * state['ewma']
            state['lastMs'] = row['tMs']
            if row['tMs'] in (0, 1000, 2000, 60000, 120000, 180000, 194000, 195000, 200000, 209000, 210000, 211000, 240000, 300000):
                checkpoints.append({'crewId': row['crewId'], 'metricCode': m['code'], 'tMs': row['tMs'],
                                    'quality': m['quality'], 'z': z, 'ewma': state['ewma'],
                                    'segmentOffset': state['segment']})
    return {'synthetic': True, 'baselines': baselines, 'liveAssessments': scores,
            'analysisCheckpoints': checkpoints,
            'heartRateAlertTransitions': [{'crewId': 'lin', 'tMs': 122000, 'state': 'alert'},
                                          {'crewId': 'lin', 'tMs': 212000, 'state': 'normal'}],
            'radiation': {'backgroundHistoryMsv': 54., 'liveMsv': .00625},
            'clinicalUse': False}


def generate(output: Path) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    files = {}
    with ZipFile(output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        sections = {'profiles.json': profiles(), 'body.json': body(), 'radiation.json': radiation(),
                    'activities.json': [{'crewId': crew, 'synthetic': True,
                       'phases': ([{'startMs': 0, 'endMs': 60000, 'activity': 'rest'},
                                   {'startMs': 60000, 'endMs': 120000, 'activity': 'exercise'},
                                   {'startMs': 120000, 'endMs': 180000, 'activity': 'recovery'},
                                   {'startMs': 180000, 'endMs': 300001, 'activity': 'rest'}]
                                  if crew == 'kai' else [{'startMs': 0, 'endMs': 300001, 'activity': 'rest'}])}
                                        for crew in CREW], 'expected.json': expected()}
        counts = {'profiles.json': 5, 'body.json': 25, 'radiation.json': 5, 'activities.json': 5, 'expected.json': 1}
        for name, value in sections.items():
            data = encoded(value)
            archive.writestr(zip_info(name), data)
            files[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'count': counts[name]}
        for name, rows in (('history.jsonl', history_rows()), ('live.jsonl', live_rows()),
                           ('assessments.jsonl', assessment_rows())):
            checksum, count = hashlib.sha256(), 0
            with archive.open(zip_info(name), 'w') as target:
                for row in rows:
                    data = encoded(row) + b'\n'
                    target.write(data)
                    checksum.update(data)
                    count += 1
            files[name] = {'sha256': checksum.hexdigest(), 'count': count}
        manifest = {'schemaVersion': 'crew-demo/1', 'datasetId': DATASET_ID, 'seed': SEED,
                    'synthetic': True, 'liveDurationMs': 300000, 'files': files}
        archive.writestr(zip_info('manifest.json'), encoded(manifest))
    return manifest


def zip_info(name: str) -> ZipInfo:
    info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    return info


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest='command', required=True)
    command = subcommands.add_parser('generate')
    command.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = generate(args.output)
    print(json.dumps({'output': str(args.output), 'datasetId': manifest['datasetId'],
                      'counts': {name: item['count'] for name, item in manifest['files'].items()}}))


if __name__ == '__main__':
    main()
