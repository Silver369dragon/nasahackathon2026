import { stationCrew } from './config.mjs';

function paintWall(screen, state) {
  const { ctx, texture } = screen;
  ctx.fillStyle = '#10262b';
  ctx.fillRect(0, 0, 1024, 512);
  function label(text, x, y, size, color, maxWidth) {
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.fillText(text, x, y, maxWidth);
  }
  label('Crew health board', 26, 48, 41, '#f1faf6', 575);
  const live = state.status === 'connected';
  const lastTime = state.syncedAt ? state.syncedAt.slice(11, 19) + ' UTC' : '';
  label(live ? 'Live' : state.status === 'offline' ? 'Offline' : 'Connecting', 654, 40, 27, live ? '#8ce8c6' : '#ffd187', 140);
  label(lastTime, 798, 40, 23, '#bdd3ce', 215);
  const columns = [24, 231, 431, 600, 821];
  const headings = ['Crew', 'HR bpm', 'SpO₂ %', 'BP mmHg', 'Temp °C'];
  headings.forEach((text, i) => label(text, columns[i], 95, 29, '#aad3c7', 185));
  const rowHeight = Math.min(55, 275 / Math.max(1, state.rows.length));
  state.rows.forEach((row, i) => {
    const y = 110 + i * rowHeight;
    if (i % 2 === 0) {
      ctx.fillStyle = '#1c363b';
      ctx.fillRect(10, y, 1004, rowHeight - 2);
    }
    [row.name, ...row.values].forEach((value, col) => label(value, columns[col], y + rowHeight * 0.74,
      Math.min(39, rowHeight * 0.74), live ? '#f0faf6' : '#b0bdb9', col === 0 ? 195 : 172));
  });
  if (state.rows.some(row => row.values.some(v => v.endsWith('*')))) label('* Stale reading', 24, 407, 22, '#f3d6a1', 570);
  if (state.emergency) {
    const event = state.emergency;
    const name = state.rows.find(r => r.crewId === event.crewId)?.name ?? event.crewId;
    ctx.fillStyle = '#913b29';
    ctx.fillRect(0, 417, 1024, 95);
    label('Latest emergency', 24, 447, 24, '#ffdac0', 410);
    label(event.createdAt.replace('T', ' ').slice(0, 19) + ' UTC', 604, 448, 24, '#ffe5cf', 395);
    label(name + ' · ' + (event.source === 'manual' ? 'Manual help request' : 'Training sensor alert'), 24, 494, 39, '#ffffff', 970);
  } else {
    label(live ? 'No recent emergencies' : 'Waiting for health service', 24, 477, 33, '#b1cac3', 960);
  }
  texture.needsUpdate = true;
}

export function startHealthStations(screen, onReady) {
  let state = { status: 'syncing', syncedAt: null, rows: [], emergency: null };
  let frame, timer, watchdog, stopped = false, preparing = false;
  let version = '';
  let paintedEvent = null;
  // Three.js calls this after uploading the changed wall map for a rendered frame.
  screen.texture.onUpdate = () => {
    const notice = state.emergency;
    if (!notice) paintedEvent = null;
    else if (paintedEvent?.id !== notice.id)
      paintedEvent = { id: notice.id, createdAt: notice.createdAt, paintedAt: Date.now() };
  };
  paintWall(screen, state);
  const later = (fn, ms) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(fn, ms);
  };
  function offline() {
    state = { ...state, status: 'offline' };
    version = '';
    paintWall(screen, state);
  }
  function mountFeed() {
    if (stopped) return;
    clearTimeout(watchdog);
    frame?.remove();
    frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Wall data connection';
    frame.src = '/stations/display/board?surface=wall';
    document.body.appendChild(frame);
    watchdog = setTimeout(recover, 25000);
  }
  function recover() {
    clearTimeout(watchdog);
    frame?.remove();
    frame = null;
    offline();
    onReady(false);
    later(prepare, 3000);
  }
  async function prepare() {
    if (stopped || preparing) return;
    preparing = true;
    try {
      const results = await Promise.all([...stationCrew, 'display'].map(name =>
        fetch('/stations/' + name + '/prepare', {
          method: 'POST', headers: { 'X-Ship-Setup': '1' }, signal: AbortSignal.timeout(12000),
        })));
      if (results.some(response => response.status !== 204)) throw new Error('Station sign-in unavailable');
      if (stopped) return;
      onReady(true);
      if (!frame) mountFeed();
      // Validate the device sessions periodically, including quiet personal stations.
      later(prepare, 5 * 60 * 1000);
    } catch {
      if (!stopped) recover();
    } finally {
      preparing = false;
    }
  }
  function receive(event) {
    if (!frame || !navigator.onLine || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    if (event.data?.type === 'ship-wall-auth-required') { recover(); return; }
    if (event.data?.type !== 'ship-wall-feed') return;
    clearTimeout(watchdog);
    watchdog = setTimeout(recover, 25000);
    const next = event.data;
    const nextVersion = JSON.stringify(next);
    if (nextVersion === version) return;
    version = nextVersion;
    state = next;
    paintWall(screen, state);
  }
  const resume = e => { if (e.persisted) { stopped = false; void prepare(); } };
  window.addEventListener('message', receive);
  window.addEventListener('offline', recover);
  window.addEventListener('online', () => { if (!frame) void prepare(); });
  window.addEventListener('pageshow', resume);
  window.addEventListener('pagehide', () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    frame?.remove();
    frame = null;
  });
  void prepare();
  return () => paintedEvent;
}
