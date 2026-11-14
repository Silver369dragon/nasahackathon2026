import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildShip} from './ship.js';
import {crew} from './simulation.mjs';
import {createOrbit} from './orbital-hull.js';
import {addFilmSet} from './film-set.js';
import {createFilmActors} from './film-actors.js';
import {createFilmOutput, renderFilmAudio} from './film-output.js';
import {renderFilm} from './film-render.js';
import {loadFilmMedia} from './film-media.js';
import {loadFilmedMedia} from './film-footage.js';
import {defaultShots, formatVersion, insertIds, interpolate, locate, maxSeconds, minSeconds, names, readShots, shotStart, storyAt, totalTime} from './film-timeline.mjs';

const $ = id => document.getElementById(id);
const input = id => /** @type {HTMLInputElement} */ ($(id));
const button = id => /** @type {HTMLButtonElement} */ ($(id));
const select = /** @type {HTMLSelectElement} */ ($('shots'));
const link = /** @type {HTMLAnchorElement} */ ($('download'));
const frame = $('frame');
const storageKey = 'hiyoko.film.shots.v8';
const footage = new URLSearchParams(location.search).get('source') !== 'live';
const filmedNames = {
  'training-task':'Noa 第一人稱開啟遊戲化運動任務', body:'Lin 操作人體 3D 並查看資料',
  'phone-link':'Timmy 控制台手機', monitor:'手機實錄：健康趨勢', 'record-detail':'手機實錄：測量細節與品質',
  team:'手機實錄：五人健康總覽', app:'手機實錄：異常數值與警示', question:'手機實錄：詢問緊急異常',
  guide:'手機實錄：AI 理解並解釋警示', evidence:'手機實錄：核對引用來源',
  'aid-route':'手機實錄：導向急救流程', 'aid-steps':'手機實錄：立即處理步驟',
};
const shotNames = defaultShots().map((shot,i) => footage ? filmedNames[shot.id] || names[i] : names[i]);
const mediaSource = /** @type {HTMLSelectElement} */ ($('media-source'));
mediaSource.value = footage ? 'footage' : 'live';
$('live-health').hidden = footage;
$('footage-note').hidden = !footage;
mediaSource.onchange = () => {
  const url = new URL(location.href);
  url.searchParams.set('source',mediaSource.value);
  location.assign(url.href);
};
const status = message => { $('status').textContent = message; };
const number = (n, digits = 2) => String(n).padStart(digits,'0');
function clock(seconds) {
  const cs = Math.round(seconds * 100);
  return number(Math.floor(cs / 6000)) + ':' + number(Math.floor(cs / 100) % 60) + '.' + number(cs % 100);
}

let shots = defaultShots();
try {
  const stored = localStorage.getItem(storageKey);
  if (stored) shots = readShots(stored);
} catch { status('無法讀取先前分鏡，已載入原始腳本。'); }
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify({version:formatVersion, shots})); }
  catch { status('瀏覽器無法自動儲存，請使用「匯出分鏡檔」保留調整。'); }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#17242b');
const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
renderer.setSize(1280,720,false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
const camera = new THREE.PerspectiveCamera(52,16/9,.025,550);
scene.add(new THREE.HemisphereLight(0xeaf4ff,0x665249,1.75));
const key = new THREE.DirectionalLight(0xffe3bf,2.25);
key.position.set(12,11,8);
scene.add(key);
const fill = new THREE.DirectionalLight(0xb2dee7,1.12);
fill.position.set(-8,5,-8);
scene.add(fill);
const ship = buildShip(crew.map((person,i) => ({...person,name: ['Lin','Sean','Timmy','Noa','Sol'][i]})));
scene.add(ship.root);
ship.labels.forEach(label => { label.visible = false; });
const orbit = createOrbit(scene);
const stage = addFilmSet(scene,ship);
const actors = createFilmActors(ship);
stage.setVisible(true);
actors.setVisible(true);
const media = {ready:false, update:null};
const film = createFilmOutput(renderer.domElement,error => {
  cancel('錄製中斷：' + error.message);
},media);
frame.append(renderer.domElement,film.canvas);
const controls = new OrbitControls(camera,frame);
controls.enableDamping = false;
controls.minDistance = .09;
controls.maxDistance = 180;
controls.screenSpacePanning = true;
const cameraPose = () => ({position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov});
function applyPose(pose) {
  camera.position.fromArray(pose.position);
  controls.target.fromArray(pose.target);
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
  controls.update();
}

let selected = 0;
let endpoint = 'start';
let progress = 0;
let elapsed = 0;
let mode = 'edit'; // edit, preview, record, encoding
let rendererLost = false;
const lostMessage = '3D 畫面中斷，請重新整理以恢復已儲存的鏡位。';
let animation = 0;
let redraw = 0;
let lastDownload = '';
let recording = null;
function render() {
  if (rendererLost) return;
  const story = storyAt(selected,progress);
  media.update?.(story);
  actors.update(story);
  stage.update(story);
  orbit.update(story);
  renderer.render(scene,camera);
  const composite = mode !== 'edit' || input('composite').checked;
  if (composite) film.draw(story);
  film.canvas.hidden = !composite;
  renderer.domElement.hidden = composite;
}
function requestDraw() {
  if (redraw || mode !== 'edit') return;
  redraw = requestAnimationFrame(() => { redraw = 0; if (mode === 'edit') render(); });
}
controls.addEventListener('change',requestDraw);
controls.addEventListener('end',() => {
  if (mode !== 'edit' || !endpoint) return;
  shots[selected][endpoint] = cameraPose();
  save();
});

const stripButtons = shots.map((shot,i) => {
  const option = new Option(number(i+1) + '　' + shotNames[i], String(i));
  select.add(option);
  const segment = document.createElement('button');
  segment.textContent = number(i+1);
  segment.title = shotNames[i];
  segment.setAttribute('aria-label',option.textContent);
  segment.onclick = () => choose(i,'start');
  $('strips').append(segment);
  return segment;
});

function timeline() {
  const total = totalTime(shots);
  input('scrub').max = String(total);
  $('timeline-end').textContent = clock(total);
  $('shot-count').textContent = shots.length + ' 鏡';
  shots.forEach((s,i) => { stripButtons[i].style.flex = String(s.seconds) + ' 1 0px'; });
}
function syncTime() {
  input('scrub').value = String(elapsed);
  $('clock').textContent = clock(elapsed) + ' / ' + clock(totalTime(shots));
}
function syncShot() {
  const s = shots[selected];
  select.value = String(selected);
  stripButtons.forEach((segment,i) => segment.setAttribute('aria-current', String(i === selected)));
  $('index-label').textContent = number(selected+1) + ' / ' + number(shots.length);
  $('monitor-title').textContent = shotNames[selected] + (mode !== 'edit' ? '' : endpoint ? (endpoint === 'start' ? ' · 起點' : ' · 終點') : ' · 時間軸定位');
  for (const side of ['start','end']) button(side).setAttribute('aria-pressed',String(side === endpoint));
  input('seconds').value = String(s.seconds);
  input('duration').max = String(Math.max(10, Math.ceil(s.seconds)));
  input('duration').value = String(s.seconds);
  input('fov').value = String(camera.fov);
  $('degrees').textContent = Math.round(camera.fov) + '°';
  const insert = insertIds.has(s.id);
  $('shot-note').textContent = insert ? (footage ? '這一鏡播放真正醫療頁面的實錄，可調整秒數。' : '這一鏡顯示目前醫療系統的即時讀值，停在這裡也會更新。可調整秒數。') : '左鍵環繞、右鍵平移、滾輪推拉。起點和終點分別儲存，試播此鏡查看運鏡。';
  controls.enabled = mode === 'edit' && !!endpoint && !rendererLost && !insert;
  input('fov').disabled = !controls.enabled;
  for (const side of ['start','end']) button(side).disabled = insert;
  syncTime();
}
function locks() {
  const busy = mode !== 'edit';
  mediaSource.disabled = busy;
  select.disabled = busy;
  /** @type {HTMLFieldSetElement} */ ($('settings')).disabled = busy;
  for (const b of [...stripButtons,button('export'),button('import')]) b.disabled = busy;
  input('scrub').disabled = busy;
  input('composite').disabled = busy;
  button('preview').disabled = !media.ready || rendererLost || mode === 'record' || mode === 'encoding';
  button('preview').textContent = mode === 'preview' ? '■ 停止預覽' : '▶ 預覽全片';
  button('play-shot').disabled = !media.ready || rendererLost || busy;
  button('record').disabled = !media.ready || rendererLost || mode === 'preview' || mode === 'encoding';
  button('record').textContent = mode === 'record' ? '■ 取消錄製' : mode === 'encoding' ? '正在產生影片…' : '● 錄製影片';
}
function choose(index, side) {
  selected = index;
  endpoint = side;
  progress = side === 'end' ? 1 : 0;
  elapsed = shotStart(shots,index) + shots[index].seconds * progress;
  applyPose(shots[index][side]);
  syncShot();
  render();
}
function seek(value) {
  elapsed = value;
  const sample = locate(shots,value);
  const changed = selected !== sample.index || endpoint !== '';
  selected = sample.index;
  endpoint = '';
  progress = sample.progress;
  applyPose(interpolate(shots[selected],progress));
  if (changed) syncShot();
  else syncTime();
  render();
}
function setSeconds(value) {
  if (!Number.isFinite(value) || value < minSeconds || value > maxSeconds) {
    input('seconds').value = String(shots[selected].seconds);
    status('每一鏡可設定 0.25 至 60 秒。');
    return;
  }
  shots[selected].seconds = Math.round(value*1000)/1000;
  elapsed = shotStart(shots,selected) + shots[selected].seconds*progress;
  timeline();
  syncShot();
  save();
}
select.onchange = () => choose(Number(select.value),'start');
for (const side of ['start','end']) button(side).onclick = () => choose(selected,side);
input('duration').oninput = () => setSeconds(input('duration').valueAsNumber);
input('seconds').onchange = () => setSeconds(input('seconds').valueAsNumber);
input('fov').oninput = () => {
  camera.fov = input('fov').valueAsNumber;
  camera.updateProjectionMatrix();
  shots[selected][endpoint] = cameraPose();
  $('degrees').textContent = camera.fov + '°';
  save();
  render();
};
input('scrub').oninput = () => seek(input('scrub').valueAsNumber);
input('composite').onchange = render;
button('restore').onclick = () => {
  shots[selected] = defaultShots()[selected];
  timeline(); choose(selected,endpoint || 'start'); save();
};

let returnTo = {index:0, side:'start', time:0};
function finishEditing() {
  cancelAnimationFrame(animation);
  film.stopPreviewAudio();
  mode = 'edit';
  locks();
  if (returnTo.side) choose(returnTo.index, returnTo.side);
  else seek(returnTo.time);
}
function cancel(message) {
  if (mode !== 'record' && mode !== 'preview') return;
  recording?.abort();
  recording = null;
  film.stopPreviewAudio();
  finishEditing();
  status(message);
}
async function record() {
  if (mode !== 'edit' || rendererLost || !media.ready) return;
  returnTo = {index:selected, side:endpoint, time:elapsed};
  const job = new AbortController();
  recording = job;
  mode = 'record'; locks();
  status('正在準備影片音效…');
  try {
    const audio = await renderFilmAudio(shots,media);
    job.signal.throwIfAborted();
    const blob = await renderFilm({canvas:film.canvas, shots, audio, renderAt:seek, signal:job.signal, realtime:!footage,
      onProgress:value => {
        if (recording === job) status('正在產生影片… ' + Math.round(value*100) + '%');
      }});
    if (recording !== job) return;
    const previous = lastDownload;
    lastDownload = URL.createObjectURL(blob);
    link.href = lastDownload;
    const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
    link.download = 'Astro-Hiyoko-' + new Date().toISOString().replace(/[:.]/g,'-') + '.' + extension;
    link.textContent = '下載影片（' + extension.toUpperCase() + '，' + (blob.size/1048576).toFixed(1) + ' MB）';
    link.hidden = false;
    if (previous) URL.revokeObjectURL(previous);
    status(rendererLost ? lostMessage : '影片已準備好，可以下載。');
  } catch (error) {
    if (recording !== job) return;
    status(rendererLost ? lostMessage : '錄製失敗：' + error.message);
  } finally {
    if (recording === job) { recording = null; finishEditing(); }
  }
}
function play(next, oneShot = false) {
  if (mode !== 'edit' || rendererLost || !media.ready) return;
  returnTo = {index:selected, side:endpoint, time:elapsed};
  const first = oneShot ? shotStart(shots,selected) : 0;
  const until = oneShot ? first + shots[selected].seconds : totalTime(shots);
  const playingIndex = selected;
  mode = next;
  locks();
  seek(first);
  try {
    film.startPreviewAudio();
    film.draw(storyAt(selected,progress));
  } catch (error) {
    film.stopPreviewAudio(); finishEditing(); status(error.message); return;
  }
  status(next === 'record' ? '正在錄製畫面與音效，請保持本分頁在前景。' : '正在預覽成片。');
  const started = performance.now();
  function tick(now) {
    const pos = first + (now - started)/1000;
    if (pos >= until) {
      // A one-shot preview must finish on its own end, before the next cut.
      if (oneShot) {
        selected = playingIndex; progress = 1; elapsed = until;
        applyPose(shots[selected].end); render();
      } else seek(until);
      finishEditing(); status('預覽結束。');
      return;
    }
    seek(pos);
    animation = requestAnimationFrame(tick);
  }
  animation = requestAnimationFrame(tick);
}
button('play-shot').onclick = () => play('preview',true);
button('preview').onclick = () => mode === 'preview' ? cancel('已停止預覽。') : play('preview');
button('record').onclick = () => mode === 'record' ? cancel('已取消本次錄製。') : void record();
document.addEventListener('visibilitychange',() => {
  if (document.hidden) cancel('已停止播放。回到前景後可重新預覽或錄製。');
});
window.addEventListener('pagehide',() => {
  if (mode === 'record' || mode === 'preview') cancel('播放已停止。');
});
button('export').onclick = () => {
  const json = JSON.stringify({version:formatVersion,shots},null,2);
  const url = URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const a = document.createElement('a');
  a.href = url; a.download = 'Astro-Hiyoko-shots.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
};
button('import').onclick = () => input('file').click();
input('file').onchange = async () => {
  const file = input('file').files[0];
  if (!file) return;
  try {
    if (file.size > 256000) throw new Error('分鏡檔超過大小限制。');
    const imported = readShots(await file.text());
    if (mode !== 'edit') return;
    shots = imported;
    timeline(); choose(0,'start'); save();
    status('已載入分鏡檔。');
  } catch (error) { status('無法載入分鏡：' + error.message); }
  finally { input('file').value = ''; }
};
renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  rendererLost = true;
  cancel('錄製中斷。');
  status(lostMessage);
  controls.enabled = false;
  locks();
});
// A still frame is also repainted when the hull textures finish loading.
THREE.DefaultLoadingManager.onLoad = requestDraw;
$('loading').remove();
if (new URLSearchParams(location.search).get('from') === 'simulation') {
  /** @type {HTMLAnchorElement} */ ($('cabin')).href = './?mode=simulation';
}
timeline(); locks(); choose(0,'start');
status(footage ? '正在載入真實頁面操作錄影…' : '正在連接醫療系統即時資料…');
const loadingMedia = footage ? loadFilmedMedia() : loadFilmMedia(({state, mira, scan, bodyConnected}) => {
  const connected = state.status === 'connected';
  $('live-connection').textContent = connected ? '已連線 · ' + (state.syncedAt?.slice(11,19) ?? '') + ' UTC'
    : state.status === 'offline' ? '離線 · 等待醫療系統重新連線' : '正在連接醫療系統…';
  const rows = connected ? mira?.readings ?? [] : [];
  $('live-readings').replaceChildren(...rows.map(reading => {
    const row = document.createElement('div');
    const label = document.createElement('dt'); label.textContent = reading.label;
    const value = document.createElement('dd'); value.dataset.liveMetric = reading.code;
    value.textContent = reading.value + ' ' + reading.unit;
    value.title = (reading.observedAt ?? '') + ' · ' + reading.status;
    row.append(label,value); return row;
  }));
  const mass = value => value == null ? '—' : value.toFixed(1);
  $('live-body').textContent = !bodyConnected ? 'Lin · 身體掃描連線中斷或尚未就緒'
    : !scan ? 'Lin · 尚無身體掃描資料' : `Lin · 肌肉 ${mass(scan.totals.muscleMassKg)} kg · 脂肪 ${mass(scan.totals.fatMassKg)} kg · ${scan.observedAt}`;
  requestDraw();
});
loadingMedia.then(loaded => {
  Object.assign(media,loaded);
  stage.setMedicalTextures(loaded.textures);
  actors.setMedicalTextures(loaded.textures);
  input('composite').checked = true;
  locks(); render();
  status(footage ? '正式影片已就緒：真實 App 操作包含人體 3D、AI 問答、引用來源與急救指引。可預覽或錄製。' : '即時展示使用目前醫療讀值。鏡位停止時數據仍會更新；錄影按實際時間取樣。');
}).catch(error => {
  locks();
  status(error.message + ' 請重新整理以重試。');
});
