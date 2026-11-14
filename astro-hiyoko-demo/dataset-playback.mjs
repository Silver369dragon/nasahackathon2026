import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import { stat } from 'node:fs/promises';

const exec = promisify(execFile);
const healthRoot = fileURLToPath(new URL('../health-system/', import.meta.url));
const python = path.join(healthRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const dataset = fileURLToPath(new URL('./data/crew-health-sample60.zip', import.meta.url));
const args = ['-X', 'utf8', '-u', 'dataset_player.py', '--dataset', dataset];
let child = null;
let verified;
let generation = 0;
let status = { status: 'idle', accepted: 0, acceptedMetrics: 0 };

function respond(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function inspect() {
  const file = await stat(dataset);
  const version = `${file.mtimeMs}:${file.size}`;
  if (verified?.version === version) return verified.metadata;
  const { stdout } = await exec(python, [...args, '--inspect'], { cwd: healthRoot, windowsHide: true, timeout: 15000 });
  const metadata = JSON.parse(stdout);
  verified = { version, metadata };
  return metadata;
}

async function stop() {
  const stoppedGeneration = ++generation;
  if (!child) {
    if (status.status === 'starting') status = { ...status, status: 'stopped' };
    return;
  }
  const running = child;
  status = { ...status, status: 'stopping' };
  // Windows venv launchers have a child interpreter; stop this owned process tree.
  try {
    if (process.platform === 'win32') {
      await exec('taskkill', ['/PID', String(running.pid), '/T', '/F'], { windowsHide: true });
    } else running.kill('SIGTERM');
    if (running.exitCode === null && running.signalCode === null) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Player did not stop')), 5000);
        running.once('close', () => { clearTimeout(timer); resolve(); });
      });
    }
    if (generation === stoppedGeneration) status = { ...status, status: 'stopped' };
  } catch (error) {
    if (running.exitCode !== null || running.signalCode !== null) {
      if (generation === stoppedGeneration) status = { ...status, status: 'stopped' };
      return;
    }
    status = { ...status, status: 'failed', error: '播放器未確認停止，請關閉 3D 服務後檢查。' };
    throw error;
  }
}

export async function playbackRequest(req, res, route, upstream) {
  if (route === '/api/playback' && req.method === 'GET') {
    try { respond(res, 200, { dataset: await inspect(), ...status }); }
    catch { respond(res, 503, { ...status, status: 'unavailable', error: '無法驗證資料包，請檢查 data/crew-health-sample60.zip 與 Python 環境。' }); }
    return;
  }
  if (req.method !== 'POST' || req.headers.origin !== 'http://' + req.headers.host || req.headers['x-ship-playback'] !== '1') {
    respond(res, 403, { error: 'Same-origin playback control required' });
    return;
  }
  if (route === '/api/playback/stop') {
    try {
      await stop();
      respond(res, 200, { dataset: await inspect(), ...status });
    } catch { respond(res, 503, status); }
    return;
  }
  if (route !== '/api/playback/start') return respond(res, 404, { error: 'Unknown playback action' });
  if (child || ['starting', 'stopping'].includes(status.status)) return respond(res, 409, { error: 'Playback already running' });
  const startedGeneration = ++generation;
  status = { status: 'starting', accepted: 0, acceptedMetrics: 0 };
  try {
    const metadata = await inspect();
    if (generation !== startedGeneration) return respond(res, 409, { error: 'Playback start cancelled' });
    child = spawn(python, [...args, '--url', upstream, '--loop'], { cwd: healthRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const running = child;
    let pending = '';
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (generation !== startedGeneration) return;
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        try { status = { ...status, ...JSON.parse(line) }; }
        catch { status = { ...status, status: 'failed', error: 'Invalid player status' }; }
      }
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-3000); });
    child.on('error', () => {
      if (generation === startedGeneration) status = { ...status, status: 'failed', error: 'Unable to launch Python player' };
    });
    child.on('close', code => {
      if (child === running) child = null;
      if (generation !== startedGeneration) return;
      if (!['completed', 'failed', 'stopped'].includes(status.status)) {
        status = { ...status, status: 'failed', error: errors || `Player exited (${code})` };
      }
    });
    respond(res, 202, { dataset: metadata, ...status });
  } catch {
    if (generation === startedGeneration) status = { ...status, status: 'failed', error: '資料驗證或播放器啟動失敗，尚未開始傳送。' };
    respond(res, 422, status);
  }
}

process.once('SIGINT', async () => { await stop(); process.exit(0); });
process.once('SIGTERM', async () => { await stop(); process.exit(0); });
