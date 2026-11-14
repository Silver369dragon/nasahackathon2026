import {defaultShots, locate, shotStart, totalTime} from './film-timeline.mjs';

// The preview and recorder share this canvas, including all titles and inserts.
const WIDTH = 1280;
const HEIGHT = 720;
export const phoneScreenRect = Object.freeze({x:459,y:35,width:362,height:650});
const paper = '#eff6f0';
const mint = '#9ae2c9';
const sans = '"Segoe UI", "Microsoft JhengHei", sans-serif';

function text(ctx, value, x, y, size, color = paper, weight = 500, family = sans) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillText(value, x, y);
}

function line(ctx, points, color, width = 2) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function subtitle(ctx, value) {
  ctx.font = `600 35px ${sans}`;
  const w = ctx.measureText(value).width + 48;
  const x = (WIDTH - w) / 2;
  ctx.fillStyle = 'rgba(6, 17, 23, .87)';
  ctx.fillRect(x, 625, w, 60);
  text(ctx, value, x + 24, 665, 35, paper, 600);
}

function credits(ctx, t) {
  const fade = Math.max(0, Math.min(1, (t - 29.4) / 0.1));
  ctx.fillStyle = `rgba(5, 16, 23, ${fade * 0.96})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  text(ctx, 'ASTRO HIYOKO', 640, 388, 76, paper, 650);
  ctx.restore();
}

/** @type {Array<[string, number, number]>} */
const inserts = [
  ['trends', 7.3, 7.8], ['record-detail', 7.8, 8.3], ['overview', 8.3, 8.8],
  ['alert', 13.6, 15.1], ['question', 15.1, 16.1],
  ['guide', 16.1, 19.7], ['evidence', 19.7, 20.9],
  ['aid-route', 20.9, 22], ['aid-steps', 22, 25.4],
];

const filmedTitles = {
  trends:['HEALTH','TRENDS'], 'record-detail':['MEASUREMENT','DETAILS'], overview:['CREW','OVERVIEW'],
  alert:['LIVE','READINGS'], question:['ASK ABOUT','THE ALERT'], guide:['UNDERSTAND','THE ALERT'],
  evidence:['CHECK THE','SOURCES'], 'aid-route':['OPEN','FIRST AID'], 'aid-steps':['IMMEDIATE','STEPS'],
};

function drawPhone(ctx, key, progress, media) {
  ctx.fillStyle = 'rgba(5, 16, 23, .91)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const title = media.live === false ? filmedTitles[key] || ['ONBOARD','HEALTH'] : ['LIVE','READINGS'];
  line(ctx, [[72, 288], [120, 288]], mint, 3);
  text(ctx, title[0], 72, 338, 30, paper, 650);
  text(ctx, title[1], 72, 380, 30, paper, 650);
  text(ctx, 'ASTRO HIYOKO', 72, 425, 18, '#a6bec3', 500);

  // The live texture and the preview use the same medical subscription.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .7)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = '#61727a';
  ctx.beginPath(); ctx.roundRect(445, 17, 390, 686, 32); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#0a1015';
  ctx.beginPath(); ctx.roundRect(448, 20, 384, 680, 29); ctx.fill();
  ctx.fillStyle = '#85969d';
  ctx.beginPath(); ctx.roundRect(441, 132, 4, 53, 2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(835, 147, 4, 74, 2); ctx.fill();
  ctx.fillStyle = '#37464d';
  ctx.beginPath(); ctx.roundRect(610, 25, 60, 3, 2); ctx.fill();
  ctx.beginPath(); ctx.arc(684, 26.5, 2.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(459, 35, 362, 650, 18); ctx.clip();
  media.draw(ctx, key, progress, phoneScreenRect);
  ctx.restore();
}

function drawInsert(ctx, t, media) {
  // Continue the same recording across the station-to-page cut, including
  // reverse seeking. Four seconds of real interaction occupy this story beat.
  if (t >= 4.09 && t < 4.9 && media?.ready && media.live === false) {
    media.draw(ctx, 'body-map', (t - 4) / .9);
  }
  const insert = inserts.find(([, start, end]) => t >= start && t < end);
  if (insert && media?.ready) {
    const [key, start, end] = insert;
    const progress = (t - start) / (end - start);
    if (media.manifest?.clips?.[key]?.presentation === 'phone') drawPhone(ctx, key, progress, media);
    else media.draw(ctx, key, progress);
    if (['alert','question','guide','evidence'].includes(key)) {
      ctx.fillStyle = 'rgba(6, 17, 23, .9)';
      ctx.fillRect(872, 26, 382, 43);
      text(ctx, media.live === false ? 'SIMULATED SENSOR INPUT' : 'LIVE MEDICAL SYSTEM', 891, 55, 24, paper, 600);
    }
  }
  if (t >= 29.4) credits(ctx, t);
  else if (t >= 11 && t < 11.8) subtitle(ctx, 'Timmy!');
  else if (t >= 12.2 && t < 13.05) subtitle(ctx, "I'm beside him.");
  else if (t >= 26.6 && t < 27.7) {
    text(ctx, 'LATER', 64, 661, 28, paper, 600);
  }
}

// Drive cues from the story playhead so changing shot lengths also retimes the sound.
/** @type {Array<[number, number, number, number]>} */
const cues = [
  [7.3, 420, 0.10, 0.12], [7.8, 490, 0.10, 0.12], [8.3, 650, 0.10, 0.12],
  [10.85, 84, 0.28, 0.22], [13.35, 1250, 0.045, 0.23],
  [14, 850, 0.13, 0.11], [14.23, 650, 0.14, 0.09],
  [11.6, 220, 0.45, 0.035], [12.3, 261.63, 0.45, 0.035],
  [16.1, 329.63, 0.55, 0.035], [19.7, 392, 0.6, 0.035],
  [22, 440, 0.7, 0.03], [26.6, 261.63, 1.1, 0.025],
  [29.42, 130.81, 0.5, 0.06],
];

/** @type {Array<[number, string]>} */
const dialogue = [[11, 'timmy'], [12.2, 'beside']];
/** @type {Array<[number, number, number, number]>} */
const foley = [
  [5.15, 0.32, 0.018, 850], [10.05, 0.45, 0.025, 520],
  [10.85, 0.21, 0.13, 220], [11.25, 0.22, 0.045, 1400],
  [11.6, 0.27, 0.025, 950], [12, 0.35, 0.022, 740],
  [12.45, 0.3, 0.028, 1100], [13.35, 0.07, 0.075, 2200],
  [28.15, 0.14, 0.035, 1600],
];

// Both playback and offline export use the same graph and event scheduling.
function audioGraph(engine, filmMedia) {
  const mix = engine.createGain();
  mix.gain.value = 0.67;
  mix.connect(engine.destination);
  const hum = engine.createOscillator();
  const level = engine.createGain();
  hum.frequency.value = 54;
  level.gain.value = 0.05;
  hum.connect(level).connect(mix);
  hum.start(0);
  const harmony = engine.createGain();
  harmony.gain.value = 0;
  harmony.connect(mix);
  for (const frequency of [130.81, 196, 261.63]) {
    const voice = engine.createOscillator();
    voice.type = 'sine';
    voice.frequency.value = frequency;
    voice.connect(harmony);
    voice.start(0);
  }
  const noise = engine.createBuffer(1, 48000, 48000);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  function ambience(storyTime, now) {
    const target = storyTime >= 26.6 ? 0.012 : storyTime >= 9.6 && storyTime < 11.6 ? 0.0001 : storyTime >= 15.1 ? 0.014 : storyTime >= 11.6 ? 0.024 : 0.04;
    level.gain.setTargetAtTime(target, now, 0.13);
    const chord = storyTime >= 9.6 && storyTime < 11.6 ? 0.0001 : storyTime >= 29.4 ? 0.004 : storyTime >= 15.1 ? 0.008 : 0.005;
    harmony.gain.setTargetAtTime(chord, now, storyTime >= 9.6 && storyTime < 11.6 ? 0.025 : 0.5);
  }

  function cue([, frequency, duration, volume], now) {
    const voice = engine.createOscillator();
    const envelope = engine.createGain();
    voice.type = frequency > 300 ? 'triangle' : 'sine';
    voice.frequency.setValueAtTime(frequency, now);
    voice.frequency.exponentialRampToValueAtTime(frequency * 0.62, now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    voice.connect(envelope).connect(mix);
    voice.onended = () => { voice.disconnect(); envelope.disconnect(); };
    voice.start(now);
    voice.stop(now + duration);
  }

  function effect([, duration, volume, frequency], now) {
    const voice = engine.createBufferSource();
    voice.buffer = noise;
    const filter = engine.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const envelope = engine.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.035, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    voice.connect(filter).connect(envelope).connect(mix);
    voice.onended = () => { voice.disconnect(); filter.disconnect(); envelope.disconnect(); };
    voice.start(now);
    voice.stop(now + duration);
  }

  function speech([, key], now) {
    const buffer = filmMedia?.audio.get(key);
    if (!buffer) return;
    const voice = engine.createBufferSource();
    const volume = engine.createGain();
    voice.buffer = buffer;
    volume.gain.value = 0.72;
    voice.connect(volume).connect(mix);
    voice.onended = () => { voice.disconnect(); volume.disconnect(); };
    voice.start(now);
  }

  return {ambience, events: [
    ...cues.map(event => ({at: event[0], schedule: now => cue(event, now)})),
    ...foley.map(event => ({at: event[0], schedule: now => effect(event, now)})),
    ...dialogue.map(event => ({at: event[0], schedule: now => speech(event, now)})),
  ]};
}

function soundtrack(filmMedia) {
  const engine = new AudioContext({latencyHint: 'playback', sampleRate: 48000});
  const graph = audioGraph(engine, filmMedia);
  let last = null;
  return {
    ready: engine.resume(),
    draw(storyTime) {
      const now = engine.currentTime;
      graph.ambience(storyTime, now);
      const from = last === null || storyTime < last ? storyTime - 0.04 : last;
      for (const event of graph.events) {
        if (event.at > from && event.at <= storyTime) event.schedule(now);
      }
      last = storyTime;
    },
    close() { void engine.close().catch(() => {}); },
  };
}

/** Render edited film audio independently of wall-clock playback and video encoding. */
export async function renderFilmAudio(shots, media) {
  const duration = totalTime(shots);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('影片長度必須大於零。');
  const engine = new OfflineAudioContext(1, Math.round(duration * 48000), 48000);
  const graph = audioGraph(engine, media);
  const canonical = defaultShots();
  const editedTime = storyTime => {
    const {index, progress} = locate(canonical, storyTime);
    return shotStart(shots, index) + progress * shots[index].seconds;
  };
  for (const at of [0, 9.6, 11.6, 15.1, 26.6, 29.4]) graph.ambience(at, editedTime(at));
  for (const event of graph.events) event.schedule(editedTime(event.at));
  // OfflineAudioContext clips tails, including dialogue that crosses the final cut.
  return engine.startRendering();
}

export function createFilmOutput(sourceCanvas, onFailure, media = null) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.setAttribute('aria-label', '成片預覽');
  const ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('無法建立影片合成畫布。');
  let audio = null;

  function stopPreviewAudio() {
    audio?.close();
    audio = null;
  }

  function startPreviewAudio() {
    if (audio) return;
    const preview = soundtrack(media);
    audio = preview;
    // Ignore a superseded preview when an earlier resume rejects.
    void preview.ready.catch(() => { if (audio === preview) stopPreviewAudio(); });
  }

  function draw(storyTime) {
    ctx.fillStyle = '#0b1721';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(sourceCanvas, 0, 0, WIDTH, HEIGHT);
    drawInsert(ctx, storyTime, media);
    audio?.draw(storyTime);
  }

  return {canvas, draw, cancel: stopPreviewAudio, startPreviewAudio, stopPreviewAudio};
}
