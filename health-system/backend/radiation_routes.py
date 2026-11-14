"""Radiation resources use existing sessions, CSRF, response envelopes and signed cursors."""
import json
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Query, Request

from .models import View
from .radiation import RadiationEventAction, SampleCommand
from .radiation_runtime import RadiationRuntime
from .radiation_store import mission, read_radiation
from .store import Data, Problem, connection, cursor_position, cursor_token


def register_radiation_routes(app: FastAPI, path: Path, runtime: RadiationRuntime) -> None:
    from .main import current, response, view_scope

    def owner(request: Request, crew_id: str) -> Data:
        user = current(request)
        if 'monitor' not in user['roles'] and user['crewId'] != crew_id:
            raise Problem(404, 'NOT_FOUND', 'This crew record is unavailable.')
        with connection(path) as db:
            if not db.execute('SELECT id FROM crew WHERE id=?', (crew_id,)).fetchone():
                raise Problem(404, 'NOT_FOUND', 'This crew record is unavailable.')
        return user

    def writer(request: Request) -> Data:
        user = current(request, write=True)
        if 'monitor' not in user['roles']:
            raise Problem(403, 'FORBIDDEN', 'Only the monitor can control the shared simulation.')
        return user

    @app.get('/v1/radiation/current')
    def current_radiation(request: Request, view: View):
        user, _ = view_scope(request, view, None)
        runtime.ensure_started()
        with connection(path) as db:
            return response(read_radiation(db, view, user['crewId']) if runtime.enabled else None)

    @app.get('/v1/radiation/crew/{crew_id}')
    def crew(request: Request, crew_id: str, missionId: str | None = None):
        owner(request, crew_id)
        with connection(path) as db:
            snapshot = read_radiation(db, 'personal', crew_id) if runtime.enabled else None
        if not snapshot or (missionId is not None and snapshot['missionId'] != missionId):
            raise Problem(404, 'NOT_FOUND', 'This radiation mission is unavailable.')
        return response(snapshot)

    @app.get('/v1/radiation/crew/{crew_id}/history')
    def history(request: Request, crew_id: str, cursor: str | None = None,
                limit: Annotated[int, Query(ge=1, le=500)] = 100):
        user = owner(request, crew_id)
        with connection(path) as db:
            state = mission(db)
            scope = ['radiation-history', user['username'], user['roles'], crew_id, state['id'] if state else None]
            query = 'SELECT * FROM radiation_history WHERE crew_id=?'
            args: list = [crew_id]
            if cursor:
                position = cursor_position(app.state.secret, scope, cursor)
                query += ' AND (start_at,id)>(?,?)'
                args.extend(position)
            rows = db.execute(query + ' ORDER BY start_at,id LIMIT ?', [*args, limit + 1]).fetchall()
        page = rows[:limit]
        next_cursor = cursor_token(app.state.secret, scope, [page[-1]['start_at'], page[-1]['id']]) if len(rows) > limit else None
        return response({'items': [json.loads(row['document']) for row in page], 'nextCursor': next_cursor})

    @app.get('/v1/radiation/environment')
    def environment(request: Request, missionId: str, fromMs: Annotated[int | None, Query(ge=0)] = None,
                    toMs: Annotated[int | None, Query(ge=0)] = None, cursor: str | None = None,
                    limit: Annotated[int, Query(ge=1, le=500)] = 100):
        user = current(request)
        with connection(path) as db:
            state = mission(db)
            if not state or state['id'] != missionId:
                raise Problem(404, 'NOT_FOUND', 'Unknown radiation mission.')
            end = toMs if toMs is not None else state['elapsedMs']
            start = fromMs if fromMs is not None else max(0, end - 86_400_000)
            # Freeze default bounds in the cursor so new checkpoints cannot shift page two.
            scope = ['radiation-environment', user['username'], user['roles'], missionId, fromMs, toMs]
            after_id = 0
            if cursor:
                start, end, after_id = cursor_position(app.state.secret, scope, cursor)
            if start > end or end > state['elapsedMs'] or (start == end and state['elapsedMs'] > 0):
                raise Problem(422, 'VALIDATION_ERROR', 'Use a nonempty range inside this mission.')
            rows = db.execute('SELECT * FROM radiation_segments WHERE mission_id=? AND end_ms>=? AND start_ms<=? AND id>? ORDER BY id LIMIT ?',
                              (missionId, start, end, after_id, limit + 1)).fetchall()
        page = rows[:limit]
        items = [{'id': r['id'], 'startMs': max(start, r['start_ms']), 'endMs': min(end, r['end_ms']),
                  'rateUsvH': float(r['rate_usv_h']) if r['rate_usv_h'] is not None else None,
                  'eventId': r['event_id'], 'quality': r['quality']} for r in page]
        return response({'items': items, 'nextCursor': cursor_token(app.state.secret, scope, [start, end, page[-1]['id']]) if len(rows) > limit else None})

    @app.post('/v1/radiation/demo-event')
    def demo_event(request: Request, body: RadiationEventAction):
        user = writer(request)
        return response(runtime.apply_event(user['username'], body))

    @app.post('/v1/radiation/samples')
    def sample(request: Request, body: SampleCommand):
        writer(request)
        return response(runtime.accept_sample(body), 201)
