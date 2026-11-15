"""Trusted synthetic observations call the same NEWS2 assessor as the personal form."""
from datetime import datetime, timedelta
from typing import get_args

from . import news2
from .models import utc_text
from .store import Data, append_event, digest, encoded


def save_observation(db, row: Data, instance: str, origin: datetime,
                     measurement_ids: dict[str, str]) -> Data:
    identifier = digest(instance + ':' + row['id'])
    previous = db.execute('SELECT document FROM news2_versions WHERE crew=? AND id=?',
                          (row['crewId'], identifier)).fetchone()
    if previous:
        import json
        return json.loads(previous[0])
    inputs = dict(row['inputs'])
    linked = {code: ident for code, ident in measurement_ids.items() if code in get_args(news2.VITALS)}
    for code in linked:
        inputs.pop(code, None)
    observed = origin + timedelta(milliseconds=row['tMs'])
    command = news2.SaveAssessment.model_validate({
        'id': identifier, 'commandId': identifier, 'expectedVersion': 0,
        'observedAt': utc_text(observed), 'inputs': inputs,
        'measurementIds': linked, 'poorQuality': row.get('poorQuality', []),
    })
    item = news2.assess(db, row['crewId'], command)
    item.update(source='scenario_import' if row['phase'] == 'history' else 'scenario_replay',
                datasetInstanceId=instance, sourceObservationId=row['id'],
                observationStartAt=utc_text(origin + timedelta(milliseconds=row['observationStartMs'])),
                observationEndAt=utc_text(origin + timedelta(milliseconds=row['observationEndMs'])))
    db.execute('INSERT INTO news2_versions VALUES(?,?,?,?,?,?,?)',
               (row['crewId'], identifier, 1, identifier, digest(encoded(row)), utc_text(observed), encoded(item)))
    if row['phase'] == 'live':
        append_event(db, row['crewId'], 'news2.updated', news2.summary(item), 1, identifier, identifier)
    return item
