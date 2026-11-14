import * as THREE from 'three';
import {startHealthStations} from './health-wall.js';
import {stationCrew} from './config.mjs';

const ink = '#173237';
const paper = '#eff6f0';
const muted = '#54736a';
const keys = ['assistant-normal', 'trends', 'record-detail', 'overview', 'alert', 'question', 'guide', 'evidence', 'aid-route', 'aid-steps'];

function text(ctx, value, x, y, size = 24, color = ink, maxWidth) {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px "Segoe UI", "Microsoft JhengHei", sans-serif`;
  ctx.fillText(String(value), x, y, maxWidth);
}

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return {canvas, texture, ctx: canvas.getContext('2d')};
}

function background(screen, title, subtitle) {
  const {ctx, canvas} = screen;
  ctx.fillStyle = paper; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = ink; ctx.fillRect(0, 0, canvas.width, 105);
  text(ctx, title, 24, 43, 28, '#ffffff', canvas.width - 48);
  text(ctx, subtitle, 24, 79, 18, '#9ae2c9', canvas.width - 48);
  screen.texture.needsUpdate = true;
}

function stamp(value) {
  return value ? value.replace('T', ' ').slice(0, 19) + ' UTC' : 'No measurement';
}

function phone(screen, row, connected) {
  background(screen, `${row?.name ?? 'Crew'} / VITAL SIGNS`, connected ? 'CONNECTED / MEDICAL SYSTEM' : 'OFFLINE / WAITING FOR DATA');
  if (!connected || !row?.readings?.length) {
    text(screen.ctx, connected ? 'No measurements' : 'Waiting for connection', 24, 185, 24, muted, 342);
    return;
  }
  row.readings.forEach((reading, index) => {
    const x = 16 + index % 2 * 183, y = 129 + Math.floor(index / 2) * 151;
    screen.ctx.fillStyle = '#ffffff'; screen.ctx.fillRect(x, y, 175, 139);
    text(screen.ctx, reading.name, x + 10, y + 25, 17, muted, 155);
    text(screen.ctx, reading.value, x + 10, y + 77, 38, ink, 155);
    text(screen.ctx, reading.unit, x + 10, y + 100, 17, muted, 155);
    text(screen.ctx, reading.status, x + 10, y + 124, 14, muted, 155);
  });
  text(screen.ctx, stamp(row.readings[0]?.observedAt), 20, 624, 15, muted, 350);
  text(screen.ctx, row.readings.some(r => r.synthetic) ? 'SYNTHETIC / TRAINING DATA' : 'MEDICAL SYSTEM DATA', 20, 657, 17, muted, 350);
}

function board(screen, state) {
  const connected = state.status === 'connected';
  background(screen, 'CREW HEALTH / LIVE MEDICAL SYSTEM', connected ? stamp(state.syncedAt) : 'OFFLINE / WAITING FOR CONNECTION');
  if (!connected) return;
  const columns = [24, 210, 365, 520, 740, 900, 1070];
  ['Crew', 'HR bpm', 'SpO2 %', 'BP mmHg', 'Temp °C', 'RR /min', 'Breathing'].forEach((v, i) => text(screen.ctx, v, columns[i], 151, 23));
  state.rows.forEach((row, i) => {
    const y = 177 + i * 88;
    screen.ctx.fillStyle = '#ffffff'; screen.ctx.fillRect(16, y, 1248, 78);
    text(screen.ctx, row.name, 24, y + 38, 30);
    (row.readings ?? []).forEach((reading, j) => {
      text(screen.ctx, reading.value, columns[j + 1], y + 38, 30, ink, j === 2 ? 200 : 145);
      text(screen.ctx, reading.status, columns[j + 1], y + 62, 15, muted, 145);
    });
  });
  const emergency = state.emergency;
  text(screen.ctx, emergency ? `Latest emergency: ${emergency.crewId} / ${stamp(emergency.createdAt)}` : 'No recent emergencies', 24, 666, 22, muted, 1220);
  text(screen.ctx, 'Latest readings from the medical system. Scripted actor movements do not create medical events.', 24, 702, 17, muted, 1220);
}

function body(screen, scan, connected) {
  background(screen, 'LIN / BODY COMPOSITION', connected ? stamp(scan?.observedAt) : 'OFFLINE / WAITING FOR CONNECTION');
  if (!connected || !scan) {
    text(screen.ctx, connected ? 'No body scan available' : 'Waiting for medical system', 60, 240, 44, ink, 1160);
    text(screen.ctx, 'Body composition is updated only when a new scan is recorded.', 60, 320, 26, muted, 1160);
    return;
  }
  const labels = [['Body mass', 'bodyMassKg'], ['Muscle mass', 'muscleMassKg'], ['Fat mass', 'fatMassKg']];
  labels.forEach(([label, field], i) => {
    text(screen.ctx, label, 52 + i * 410, 178, 28, muted);
    text(screen.ctx, scan.totals[field] == null ? '—' : `${scan.totals[field].toFixed(1)} kg`, 52 + i * 410, 245, 54);
  });
  text(screen.ctx, 'REGION / MUSCLE / FAT', 36, 296, 23, muted);
  Object.entries(scan.regions).forEach(([region, reading], i) => {
    const number = value => reading.quality === 'good' && value != null ? value.toFixed(1) + ' kg' : '—';
    const line = `${region.replaceAll('_', ' ')}: ${number(reading.muscleMassKg)} / ${number(reading.fatMassKg)}`;
    text(screen.ctx, line, 36 + Math.floor(i / 8) * 410, 335 + i % 8 * 29, 19, ink, 390);
  });
  const findings = scan.findings.filter(f => f.status !== 'resolved');
  text(screen.ctx, `Active findings: ${findings.length}${findings.length > 3 ? ' (first 3 shown; see medical system for all)' : ''}`, 36, 586, 21, muted, 1200);
  findings.slice(0, 3).forEach((finding, i) => {
    const line = `${finding.regionCode.replaceAll('_', ' ')} / ${finding.kind} / ${finding.severity} / ${finding.status}`;
    text(screen.ctx, line, 36, 616 + i * 28, 21, '#913b29', 1200);
  });
  text(screen.ctx, 'SYNTHETIC BODY SCAN', 36, 704, 16, muted);
}

function sensor(screen, row, connected) {
  const reading = row?.readings?.find(r => r.code === 'heart_rate');
  background(screen, 'MIRA / HEART RATE', connected ? 'MEDICAL SYSTEM' : 'OFFLINE');
  text(screen.ctx, connected ? reading?.value ?? '—' : '—', 24, 190, 82);
  text(screen.ctx, connected ? reading?.status ?? 'no_data' : 'offline', 205, 190, 22, muted, 160);
  text(screen.ctx, 'bpm', 24, 233, 25, muted);
}

// Display data follows the medical system, independently of the film playhead.
// No captured medical PNGs or historical footage are loaded.
export async function loadFilmMedia(onChange = _update => {}, {wall = null, onReady = _ready => {}, onRadiation = (_snapshot, _status) => {}, audio = true} = {}) {
  const screens = {board:surface(1280,720), phone:surface(390,700), taskPhone:surface(390,700), bodyMap:surface(1280,720), sensor:surface(384,256)};
  const crewPhones = Object.fromEntries(stationCrew.map(id => [id, surface(390,700)]));
  let state = {status:'syncing', syncedAt:null, rows:[], emergency:null};
  let scan = null, bodyConnected = false, stopped = false, bodyTimer, bodyRequest;
  const media = {
    ready:true, live:true, audio:new Map(), screens,
    manifest:{clips:Object.fromEntries(keys.map(key => [key, {presentation:key === 'overview' ? 'board' : 'phone'}]))},
    textures:{board:screens.board.texture, boardNormal:screens.board.texture,
      phone:screens.phone.texture, phoneNormal:screens.phone.texture,
      taskPhone:screens.taskPhone.texture, taskPhoneReady:screens.taskPhone.texture, bodyMap:screens.bodyMap.texture,
      sensor:screens.sensor.texture, crewPhones:Object.fromEntries(stationCrew.map(id => [id, crewPhones[id].texture]))},
    wallEmergency:() => null,
    draw(ctx, key, _progress, {x=0,y=0,width=1280,height=720} = {}) {
      ctx.drawImage(key === 'overview' ? screens.board.canvas : screens.phone.canvas, x,y,width,height);
    },
  };
  function repaint() {
    const connected = state.status === 'connected';
    const mira = state.rows.find(row => row.crewId === 'mira');
    board(screens.board, state);
    phone(screens.phone, mira, connected);
    sensor(screens.sensor, mira, connected);
    phone(screens.taskPhone, state.rows.find(row => row.crewId === 'noa'), connected);
    for (const id of stationCrew) phone(crewPhones[id], state.rows.find(row => row.crewId === id), connected);
    body(screens.bodyMap, scan, connected && bodyConnected);
    onChange({state, mira, scan:connected && bodyConnected ? scan : null, bodyConnected:connected && bodyConnected});
  }
  async function refreshBody() {
    if (stopped || bodyRequest) return;
    const controller = new AbortController();
    bodyRequest = controller;
    try {
      const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]);
      const read = () => fetch('/stations/lin/v1/body-scans/latest', {cache:'no-store',signal});
      let response = await read();
      if (response.status === 401) {
        const prepared = await fetch('/stations/lin/prepare', {
          method:'POST',headers:{'X-Ship-Setup':'1'},signal,
        });
        if (prepared.status !== 204) throw new Error('Body station unavailable');
        response = await read();
      }
      if (!response.ok) throw new Error('Body scan unavailable');
      const result = await response.json();
      if (stopped) return;
      scan = result.data.scan; bodyConnected = true;
    } catch {
      bodyConnected = false; scan = null;
    } finally {
      bodyRequest = null;
      if (!stopped) { repaint(); bodyTimer = setTimeout(refreshBody,3000); }
    }
  }
  media.wallEmergency = startHealthStations(wall || screens.board, ready => {
    onReady(ready);
    if (ready && !bodyTimer) void refreshBody();
  }, next => { state = next; repaint(); onRadiation(next.radiation ?? null, next.status); });
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(bodyTimer); bodyRequest?.abort(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void refreshBody(); } });
  if (!audio) return media;
  // Missing dialogue must not hide current readings.
  const decoder = new OfflineAudioContext(1, 1, 48000);
  await Promise.all(['timmy','beside'].map(async key => {
    try {
      const response = await fetch(`/film-assets/audio/${key}.wav`, {signal:AbortSignal.timeout(5000)});
      if (response.ok) media.audio.set(key, await decoder.decodeAudioData(await response.arrayBuffer()));
    } catch { /* Optional dialogue; live displays continue without it. */ }
  }));
  return media;
}
