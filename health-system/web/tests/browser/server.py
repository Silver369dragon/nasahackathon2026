"""Disposable local server for body-map browser tests; never opens the daily database."""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
os.environ['HEALTH_DEMO_PASSWORD'] = 'body-e2e-only'
os.environ['HEALTH_AI_OFFLINE'] = '1'
os.environ['HEALTH_BODY_SCAN_DEMO'] = '1'
os.environ['HEALTH_MOCK_SECRET'] = 'body-e2e-device-key'

import uvicorn  # noqa: E402

from backend.main import create_app  # noqa: E402

with tempfile.TemporaryDirectory(prefix='orbital-body-e2e-') as temporary:
    uvicorn.run(create_app(Path(temporary) / 'training.db'), host='127.0.0.1', port=int(os.environ.get('HEALTH_TEST_PORT', '8018')), log_level='warning')
