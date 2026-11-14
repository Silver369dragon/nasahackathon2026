from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import create_app


def login(client, username='mira'):
    reply = client.post('/v1/auth/login', json={'username': username, 'password': 'test-password'})
    assert reply.status_code == 200, reply.text
    return {'X-CSRF-Token': reply.json()['data']['csrfToken']}


@pytest.fixture
def station(tmp_path, monkeypatch):
    monkeypatch.setenv('HEALTH_DEMO_PASSWORD', 'test-password')
    monkeypatch.setenv('HEALTH_AI_OFFLINE', '1')
    monkeypatch.setenv('HEALTH_BODY_SCAN_DEMO', '1')
    path = tmp_path / 'body.db'
    with TestClient(create_app(path)) as client:
        yield client, login(client), path


def post(http, csrf, request_id='scan-1', preset='baseline', **extra):
    return http.post('/v1/body-scans/demo', headers=csrf,
                     json={'requestId': request_id, 'preset': preset, **extra})


def test_empty_scan_then_immutable_persistent_replay_and_conflict(station):
    http, csrf, path = station
    empty = http.get('/v1/body-scans/latest')
    assert empty.status_code == 200
    assert empty.json()['data'] == {'scan': None, 'demoEnabled': True}
    assert http.get('/v1/body-scans').json()['data'] == {'items': [], 'nextCursor': None}
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: post(http, csrf), range(2)))
    assert sorted(r.status_code for r in results) == [200, 201]
    scan = results[0].json()['data']['scan']
    assert scan['crewId'] == 'mira' and scan['runId'] is None and scan['synthetic']
    assert len(scan['regions']) == 22
    assert post(http, csrf, preset='partial').status_code == 409
    assert http.get('/v1/body-scans/latest').json()['data']['scan'] == scan
    with TestClient(create_app(path)) as restarted:
        headers = login(restarted)
        assert post(restarted, headers).json()['data']['scan'] == scan
        assert restarted.get('/v1/body-scans/' + scan['id']).json()['data']['scan'] == scan


def test_owner_csrf_mode_and_unknown_run_are_enforced(station, monkeypatch):
    http, csrf, _ = station
    assert post(http, {}).status_code == 403
    scan = post(http, csrf).json()['data']['scan']
    for extra in [{'crewId': 'kai'}, {'runId': 'other'}, {'preset': 'not-valid'}]:
        body = {'requestId': 'invalid', 'preset': 'baseline', **extra}
        assert http.post('/v1/body-scans/demo', headers=csrf, json=body).status_code == 422
    for url in ['/v1/body-scans', '/v1/body-scans/latest', '/v1/body-scans/' + scan['id']]:
        assert http.get(url + '?runId=unknown').status_code == 404
    assert http.post('/v1/body-scans/demo?runId=unknown', headers=csrf,
                     json={'requestId':'unknown', 'preset':'baseline'}).status_code == 404
    login(http, 'kai')
    assert http.get('/v1/body-scans/latest?crewId=mira').json()['data']['scan'] is None
    assert http.get('/v1/body-scans/' + scan['id']).status_code == 404
    for account in ['monitor', 'display']:
        headers = login(http, account)
        assert http.get('/v1/body-scans').status_code == 403
        assert post(http, headers).status_code == 403
    csrf = login(http)
    monkeypatch.setenv('HEALTH_BODY_SCAN_DEMO', '0')
    assert http.get('/v1/body-scans/latest').json()['data']['demoEnabled'] is False
    assert post(http, csrf, 'disabled').status_code == 403
    http.post('/v1/auth/logout', headers=csrf, json={})
    assert http.get('/v1/body-scans/latest').status_code == 401


def test_history_pages_are_stable_scoped_and_findings_keep_identity(station):
    http, csrf, _ = station
    strain = post(http, csrf, 'strain', 'training_strain').json()['data']['scan']
    recovery = post(http, csrf, 'recover', 'recovery').json()['data']['scan']
    assert strain['findings'][0]['id'] == recovery['findings'][0]['id']
    assert strain['findings'][0]['status'] == 'active'
    assert recovery['findings'][0]['status'] == 'recovering'
    assert strain['findings'][0]['onsetAt'] == recovery['findings'][0]['onsetAt']
    for number in range(22):
        assert post(http, csrf, 'extra-' + str(number)).status_code == 201
    first = http.get('/v1/body-scans?limit=20').json()['data']
    assert len(first['items']) == 20 and first['nextCursor']
    second = http.get('/v1/body-scans', params={'limit': 20, 'cursor': first['nextCursor']}).json()['data']
    assert len(second['items']) == 4 and second['nextCursor'] is None
    assert len({s['id'] for s in first['items'] + second['items']}) == 24
    assert http.get('/v1/body-scans?cursor=bad').status_code == 400
    assert http.get('/v1/body-scans?limit=0').status_code == 422
    login(http, 'kai')
    assert http.get('/v1/body-scans', params={'cursor': first['nextCursor']}).status_code == 400


def test_partial_scan_and_contract_do_not_promote_unknown_to_normal(station):
    from backend.body_scan import BodyScan

    http, csrf, _ = station
    scan = post(http, csrf, preset='partial').json()['data']['scan']
    assert scan['regions']['left_forearm']['quality'] == 'missing'
    assert scan['regions']['left_forearm']['muscleMassKg'] is None
    assert scan['regions']['left_forearm']['missingReason']
    BodyScan.model_validate(scan)
    for invalid in [
        {**scan, 'regions': {'imaginary_limb': scan['regions']['left_forearm']}},
        {**scan, 'regions': {'left_forearm': {**scan['regions']['left_forearm'], 'missingReason': None}}},
        {**scan, 'regions': {'left_forearm': {**scan['regions']['left_forearm'], 'quality': 'good'}}},
        {**scan, 'totals': {'bodyMassKg': 70, 'muscleMassKg': -1, 'fatMassKg': 14}},
        {**scan, 'totals': {'bodyMassKg': 70, 'muscleMassKg': 30, 'fatMassKg': 80}},
        {**scan, 'synthetic': False},
    ]:
        with pytest.raises(ValidationError):
            BodyScan.model_validate(invalid)
