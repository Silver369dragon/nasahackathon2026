import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { stationCrew } from './config.mjs';
import { playbackRequest } from './dataset-playback.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
const port = Number(process.env.SHIP_PORT || 4173);
const healthPort = Number(process.env.HEALTH_PORT || 8000);
if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) throw new Error('Invalid HEALTH_PORT');
const upstream = `http://127.0.0.1:${healthPort}`;
const stations = [...stationCrew, 'display'];
const stationCookie = 'ship_station';

function sessionCookie(req) {
  const token = /(?:^|;\s*)ship_station=([A-Za-z0-9_-]+)(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  return token ? 'health_session=' + token : '';
}

async function prepareStation(req, res, name) {
  // Only same-origin code on this loopback cabin may initiate training logins.
  if (req.method !== 'POST' || req.headers.origin !== 'http://' + req.headers.host ||
      req.headers['x-ship-setup'] !== '1') return res.writeHead(403).end();
  const headers = { Cookie: sessionCookie(req) };
  if (headers.Cookie) {
    const current = await fetch(upstream + '/v1/auth/me', { headers, signal: AbortSignal.timeout(5000) });
    if (current.ok && (await current.json()).data.username === name) return res.writeHead(204).end();
    if (!current.ok && current.status !== 401) return res.writeHead(503).end();
  }
  const login = await fetch(upstream + '/v1/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: process.env.HEALTH_DEMO_PASSWORD || 'orbital-demo' }),
    signal: AbortSignal.timeout(8000),
  });
  const token = /^health_session=([A-Za-z0-9_-]+);/.exec(login.headers.get('set-cookie') || '')?.[1];
  if (!login.ok || !token || (await login.json()).data.username !== name) return res.writeHead(503).end();
  res.setHeader('Set-Cookie', `${stationCookie}=${token}; Path=/stations/${name}/; HttpOnly; SameSite=Strict; Max-Age=43200`);
  res.writeHead(204).end();
}

async function stationRequest(req, res, name, route, search) {
  res.setHeader('Cache-Control', 'no-store');
  if (!stations.includes(name)) return res.writeHead(404).end();
  if (route === '/prepare') return prepareStation(req, res, name);
  const isBoard = name === 'display';
  const isPage = isBoard ? route === '/board' : /^\/app(?:\/|$)/.test(route);
  const isApi = route.startsWith('/v1/');
  const isBodyAsset = !isBoard && ['/body/preview.png', '/body/orbital-body.glb'].includes(route);
  if (!isPage && !isApi && !isBodyAsset) return res.writeHead(404).end();
  if (isBodyAsset && req.method !== 'GET') return res.writeHead(403).end();
  // Device identity is fixed at startup. Full sign-in/out and device push belong to the independent app.
  if (isApi && (/^\/v1\/(auth|session)(?:\/|$)/.test(route) && req.method !== 'GET' ||
      route.startsWith('/v1/push/') || isBoard && req.method !== 'GET')) return res.writeHead(403).end();
  if (req.method !== 'GET' && (req.method !== 'POST' || req.headers.origin && req.headers.origin !== 'http://' + req.headers.host))
    return res.writeHead(403).end();
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const headers = { Cookie: sessionCookie(req) };
  for (const key of ['accept', 'content-type', 'x-csrf-token', 'last-event-id']) {
    if (req.headers[key]) headers[key] = req.headers[key];
  }
  const response = await fetch(upstream + route + search, {
    method: req.method, headers, signal: controller.signal, redirect: 'error',
    ...(req.method === 'POST' ? { body: req, duplex: 'half' } : {}),
  });
  res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream' });
  res.flushHeaders();
  if (response.body) await pipeline(Readable.fromWeb(response.body), res);
  else res.end();
}

async function openHealthPage(req, res, route) {
  // Keep localhost and 127.0.0.1 sessions on the same site as their cabin.
  const hostname = req.headers.host?.split(':')[0] === 'localhost' ? 'localhost' : '127.0.0.1';
  const origin = `http://${hostname}:${healthPort}`;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ready = await fetch(`http://127.0.0.1:${healthPort}/v1/health/ready`, { signal: AbortSignal.timeout(3000) });
    await ready.body?.cancel();
    if (!ready.ok) throw new Error('Health service unavailable');
    res.writeHead(302, { Location: origin + route }).end();
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Health service offline</title><main style="font:1rem/1.6 system-ui;padding:1rem">
      <p lang="zh-Hant">暫時無法連上醫療系統。請啟動 health-system 的 start.cmd，再按重試。</p>
      <p lang="en">Health service unavailable. Start health-system/start.cmd, then retry.</p>
      <a href="/health${route}">重試 / Retry</a></main>`);
  }
}

http.createServer(async (req, res) => {
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return res.writeHead(403).end();
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/playback' || url.pathname.startsWith('/api/playback/')) {
      await playbackRequest(req, res, url.pathname, upstream);
      return;
    }
    const station = /^\/stations\/([a-z]+)(\/.*)$/.exec(url.pathname);
    if (station) {
      try { await stationRequest(req, res, station[1], station[2], url.search); }
      catch { if (!res.headersSent) res.writeHead(503); res.end(); }
      return;
    }
    // The medical app's versioned assets and images contain no session information.
    if (/^\/assets\/[\w.-]+\.(?:js|css|woff2?)$/.test(url.pathname) ||
        ['/earth.jpg', '/orbital-192.png', '/manifest.webmanifest', '/orbital-512.png'].includes(url.pathname)) {
      const asset = await fetch(upstream + url.pathname, { signal: AbortSignal.timeout(5000) });
      res.writeHead(asset.status, { 'Content-Type': asset.headers.get('content-type') || 'application/octet-stream' });
      if (asset.body) await pipeline(Readable.fromWeb(asset.body), res);
      else res.end();
      return;
    }
    if (url.pathname === '/health/app' || url.pathname === '/health/board' || url.pathname === '/health/system') {
      await openHealthPage(req, res, url.pathname.slice('/health'.length));
      return;
    }
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!target.startsWith(root)) return res.writeHead(403).end();
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Astro Hiyoko demo: http://127.0.0.1:${port}`));
