import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const healthRoot = fileURLToPath(new URL('../health-system/', import.meta.url));
const python = path.join(healthRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const baseURL = 'http://127.0.0.1:14174';
const healthPort = '19537';

export default defineConfig({
  testDir: './integration',
  testMatch: 'body-map.spec.js',
  outputDir: './test-results/health',
  workers: 1,
  timeout: 90000,
  use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(chrome) ? chrome : undefined), args: ['--enable-unsafe-swiftshader'] }, baseURL, viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command: 'node server.mjs',
      env: { SHIP_PORT: '14174', HEALTH_PORT: healthPort, HEALTH_DEMO_PASSWORD: 'ship-test-password' },
      url: baseURL,
      reuseExistingServer: false,
    },
    {
      cwd: healthRoot,
      command: `"${python}" -m uvicorn backend.main:app --host 127.0.0.1 --port ${healthPort}`,
      env: {
        HEALTH_DB_PATH: path.join(healthRoot, '.qa', randomUUID(), 'ship.sqlite3'),
        HEALTH_DEMO_PASSWORD: 'ship-test-password',
        HEALTH_AI_OFFLINE: '1',
        HEALTH_BODY_SCAN_DEMO: '1',
      },
      url: `http://127.0.0.1:${healthPort}/v1/health/ready`,
      reuseExistingServer: false,
    },
  ],
});
