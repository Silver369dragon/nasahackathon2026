import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// The health service owns the runtime, clock and writes. This narrow proxy also
// preserves the old /api/playback URLs without owning a second player.
export async function playbackRequest(req, res, route, upstream) {
  const target = route.replace(/^\/api\/playback(?=\/|$)/, '/v1/demo/playback');
  const allowed = req.method === 'GET' && ['/v1/session', '/v1/demo/playback'].includes(target) ||
    req.method === 'POST' && ['/v1/session', '/v1/demo/playback/start', '/v1/demo/playback/stop'].includes(target);
  res.setHeader('Cache-Control', 'no-store');
  if (!allowed) return res.writeHead(404).end();
  if (req.method === 'POST' && req.headers.origin !== 'http://' + req.headers.host)
    return res.writeHead(403).end();
  const headers = { Accept: 'application/json' };
  const cookie = /(?:^|;\s*)health_session=([A-Za-z0-9_-]+)(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (cookie) headers.Cookie = 'health_session=' + cookie;
  for (const key of ['content-type', 'x-csrf-token']) {
    if (req.headers[key]) headers[key] = req.headers[key];
  }
  try {
    const response = await fetch(upstream + target, {
      method:req.method, headers, redirect:'error', signal:AbortSignal.timeout(15000),
      ...(req.method === 'POST' ? { body:req, duplex:'half' } : {}),
    });
    const session = response.headers.get('set-cookie');
    if (session && target === '/v1/session') res.setHeader('Set-Cookie', session);
    res.writeHead(response.status, { 'Content-Type':response.headers.get('content-type') || 'application/json' });
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, { 'Content-Type':'application/json' }).end(JSON.stringify({
      error:{message:'醫療服務連線中斷；已提交的播放進度會保留。'},
    }));
  }
}
