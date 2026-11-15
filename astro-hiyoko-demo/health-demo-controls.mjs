import { demoApi, createDemoReader } from './health-demo-client.mjs';
import { committedElapsed, formatDemoTime, playbackNames, activityNames } from './health-demo-clock.mjs';
import { stationCrew } from './config.mjs';

const $ = id => document.getElementById(id);
const read = createDemoReader();
let state = null, session = null, connected = false, controlling = false, revision = 0;
let pendingStart = null;
try { pendingStart = JSON.parse(sessionStorage.getItem('health-demo-pending-start') || 'null'); } catch { /* Storage is optional. */ }
function rememberStart(value) {
  pendingStart = value;
  try {
    if (value) sessionStorage.setItem('health-demo-pending-start',JSON.stringify(value));
    else sessionStorage.removeItem('health-demo-pending-start');
  } catch { /* Keep the command in memory if browser storage is unavailable. */ }
}

function buttons() {
  const running = ['starting','playing','stopping'].includes(state?.status);
  const authorized = session?.roles?.includes('monitor');
  $('start').disabled = controlling || !connected || !authorized || running || state?.status === 'unavailable';
  $('start').textContent = pendingStart ? '重試開始要求' : '開始新的示範';
  $('stop').disabled = controlling || !connected || !authorized || !running;
}
function render(next) {
  state = next;
  connected = true;
  if (pendingStart && state.id && state.id !== pendingStart.previousRunId && state.status === 'playing') rememberStart(null);
  $('status').textContent = playbackNames[state.status] || state.status;
  $('progress').max = state.durationMs || 300000;
  $('progress').value = committedElapsed(state);
  $('counts').textContent = `已提交進度 ${formatDemoTime(committedElapsed(state))} / ${formatDemoTime(state.durationMs || 300000)} · 已接受 ${state.accepted ?? 0} 筆樣本`;
  $('dataset').textContent = `${state.datasetId || '尚未準備資料包'}${state.id ? ' · 播放 ' + state.id : ''}`;
  $('error').textContent = state.error || '';
  $('timing').textContent = state.startedAt ? `開始時間 ${new Date(state.startedAt).toLocaleString('zh-TW')}` : '';
  const rows = new Map((state.activities ?? []).map(row => [row.crewId,row]));
  $('activities').replaceChildren(...stationCrew.map(crewId => {
    const row = rows.get(crewId), tr = document.createElement('tr');
    for (const value of [crewId[0].toUpperCase()+crewId.slice(1),activityNames[row?.activity] || row?.activity || '等待資料',activityNames[row?.next] || row?.next || '—']) {
      const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
    }
    return tr;
  }));
  buttons();
}
function showSession(next) {
  session = next;
  const authorized = session?.roles?.includes('monitor');
  $('login').hidden = authorized;
  $('auth-status').textContent = authorized ? `監測員 ${session.username} 已登入` : '可檢視既有示範。開始或停止需要監測員登入。';
  buttons();
}
async function poll() {
  const atRevision = revision;
  try {
    const next = await read();
    if (atRevision === revision && !controlling) render(next);
  } catch (error) {
    if (atRevision !== revision || controlling) return;
    connected = false;
    $('status').textContent = '播放連線中斷';
    $('error').textContent = `${error.message} 最後已提交進度 ${formatDemoTime(committedElapsed(state))}。`;
    buttons();
  } finally { setTimeout(poll,1000); }
}
async function control(action) {
  if (controlling || !session?.roles?.includes('monitor')) return;
  controlling = true;
  revision++;
  if (action === 'start' && !pendingStart) rememberStart({commandId:crypto.randomUUID(),previousRunId:state?.id});
  const commandId = action === 'start' ? pendingStart.commandId : crypto.randomUUID();
  buttons();
  try {
    const next = await demoApi('/v1/demo/playback/' + action,{body:{commandId},token:session.csrfToken});
    if (action === 'start') rememberStart(null);
    render(next);
  } catch (error) {
    $('error').textContent = error.message;
    if ([401,403].includes(error.status)) showSession(null);
  } finally { controlling = false; buttons(); }
}
$('login').addEventListener('submit',async event => {
  event.preventDefault();
  $('sign-in').disabled = true;
  $('auth-error').textContent = '';
  try {
    const form = new FormData(event.currentTarget);
    showSession(await demoApi('/v1/session',{body:{username:form.get('username'),password:form.get('password')}}));
    if (!session?.roles?.includes('monitor')) $('auth-error').textContent = '此帳號沒有監測員權限。';
  } catch (error) { $('auth-error').textContent = error.message; }
  finally { $('login').elements.password.value = ''; $('sign-in').disabled = false; }
});
$('start').onclick = () => control('start');
$('stop').onclick = () => control('stop');
void demoApi('/v1/session').then(showSession).catch(() => showSession(null));
void poll();
