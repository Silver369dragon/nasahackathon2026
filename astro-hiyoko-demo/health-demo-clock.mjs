import { stationCrew, SHIP_SCALE } from './config.mjs';
import { homes } from './routines.mjs';

export const demoDurationMs = 300000;
export const playbackNames = { idle:'尚未開始', ready:'準備完成', prepared:'準備完成', unavailable:'資料尚未準備', interrupted:'播放已中斷', starting:'準備中', playing:'播放中', stopping:'停止中', completed:'播放完成', stopped:'已停止', failed:'播放失敗' };
export const activityNames = { rest:'休息', exercise:'訓練', recovery:'訓練後恢復', duty:'值勤' };

export function committedElapsed(state) {
  const duration = Number.isFinite(state?.durationMs) ? Math.max(0, state.durationMs) : demoDurationMs;
  return Math.max(0, Math.min(duration, Number.isFinite(state?.elapsedMs) ? state.elapsedMs : 0));
}

export function formatDemoTime(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// Local wall time can only interpolate toward the last committed backend tick.
export function createDemoClock() {
  let id, from = 0, target = 0, received = 0;
  function elapsed(now) {
    const fraction = Math.max(0, Math.min(1, (now - received) / 1000));
    return from + (target - from) * fraction;
  }
  return {
    receive(state, now) {
      const next = committedElapsed(state);
      from = id === state.id ? Math.min(elapsed(now), next) : next;
      id = state.id;
      target = next;
      received = now;
      if (state.status !== 'playing') from = target;
    },
    elapsed,
  };
}

const dutyPoints = { lin:[13,1.6], mira:[8.8,-3], noa:[-11.3,-1], sol:[9.8,-2], kai:[13,1.6] };
const trainingPoint = [9.05,3.5];
const recoveryPoint = [7,-2];
function destination(crewId, activity) {
  if (activity === 'exercise') return trainingPoint;
  if (activity === 'recovery') return recoveryPoint;
  if (activity === 'duty') return dutyPoints[crewId];
  return homes[stationCrew.indexOf(crewId)];
}
function route(from, to) {
  if (from[0] === to[0] && from[1] === to[1]) return [from];
  return [from, [from[0],0], [to[0],0], to];
}
function along(path, distance) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i];
    const length = Math.hypot((b[0]-a[0])*SHIP_SCALE.x,(b[1]-a[1])*SHIP_SCALE.z);
    if (length && distance < length) return {
      position:[a[0]+(b[0]-a[0])*distance/length,a[1]+(b[1]-a[1])*distance/length],
      heading:Math.atan2(b[0]-a[0], b[1]-a[1]), moving:true,
    };
    distance -= length;
  }
  return {position:[...path.at(-1)],heading:0,moving:false};
}

// Model slots follow stable crew IDs, never the incoming activity array order.
export function createDemoRoutines() {
  let runId;
  const states = new Map();
  function pose(crewId, elapsedMs) {
    const state = states.get(crewId);
    if (!state) return {position:[...destination(crewId,'rest')],heading:0,moving:false,activity:'Rest',next:'等待播放狀態'};
    const motion = along(state.path, Math.max(0, elapsedMs-state.since)/1000*1.4);
    return {...motion, activity:motion.moving?'Gliding':state.activity==='exercise'?'Cycle training':state.activity==='rest'?'Rest':activityNames[state.activity] || state.activity,
      next:activityNames[state.activity] || state.activity, crewId, phase:state.phase};
  }
  return {
    receive(snapshot) {
      if (snapshot.id !== runId) { states.clear(); runId = snapshot.id; }
      for (const row of snapshot.activities ?? []) {
        if (!stationCrew.includes(row.crewId) || !Object.hasOwn(activityNames,row.activity)) continue;
        const previous = states.get(row.crewId);
        if (previous?.activity === row.activity && previous.phase === row.phase) continue;
        const target = destination(row.crewId,row.activity);
        const from = previous ? pose(row.crewId,committedElapsed(snapshot)).position : target;
        const since = Number.isFinite(row.phaseStartMs) ? Math.min(committedElapsed(snapshot),Math.max(0,row.phaseStartMs)) : committedElapsed(snapshot);
        states.set(row.crewId,{...row,path:route(from,target),since});
      }
    },
    at: elapsedMs => stationCrew.map(crewId => pose(crewId,elapsedMs)),
  };
}
