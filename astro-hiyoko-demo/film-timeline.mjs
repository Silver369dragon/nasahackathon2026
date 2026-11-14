// Camera and target coordinates are in world metres. Story time stays anchored
// to each beat even when the editor changes its duration in the film.
const view = (position, target, fov = 48) => ({position, target, fov});
const wide = view([-19.8,2.04,-3.2], [-22.30,1.05,0], 53);
const two = view([-19.8,1.8,-2.3], [-21.5,.85,-.1], 50);
const wrist = view([-22.65,1.68,-1.6], [-22.43,1.19,-.35], 35);
const join = view([-20.4,.95,-1.25], [-21.38,.59,-.58], 37);
const consolePhone = view([-22.15,1.72,-1.42], [-22.87,1.49,-.52], 30);
const taskPhone = view([13.08,1.60,5.13], [13.08,1.19,4.99], 54);
const inspect = view([-22.70,2.05,-.59], [-22.70,1.17,0], 30);
const row = (id, name, seconds, start, end = start) => ({id, name, seconds, start, end});
// Canonical actor/audio clock. wrist-link remains an anchor only; it is not a
// visible shot in the edit below.
const script = [
  row('training-task','Noa 第一人稱查看即時讀值',2.1,view([13.08,1.64,5.14],taskPhone.target,54),taskPhone),
  row('exercise','Noa 使用訓練器材',1,view([14.3,2.05,3.75],[12.1,1.15,5.75],46),view([14.1,1.97,3.9],[12.1,1.15,5.75],46)),
  row('radiation','Sol 查看輻射模擬狀態',.9,view([25.4,2.35,3.6],[26.64,1.5,4.32],36),view([25.5,2.28,3.65],[26.64,1.5,4.32],36)),
  row('body','Lin 操作人體 3D 並查看資料',.9,view([-11.1,1.85,-3.6],[-13.1,1.4,-5.4],32),view([-11.2,1.8,-3.7],[-13.1,1.4,-5.4],32)),
  row('opening','Timmy 操作前端控制室拉桿',.8,wide,view([-20.05,1.98,-2.95],wide.target,51)),
  row('wrist-link','正常腕帶與即時心率',.75,view([-22.55,1.85,-2.1],wrist.target,38),wrist),
  row('phone-link','Timmy 控制台手機',.85,view([-22.05,1.82,-1.75],consolePhone.target,33),consolePhone),
  row('monitor','即時手機：Mira 生命徵象',.5,two),
  row('record-detail','即時手機：量測品質',.5,two),
  row('team','即時看板：五人健康總覽',.5,two),
  {...row('collapse','失聯腕帶，退開看完整倒地',2.2,wrist,
    view([-19.35,1.55,-3.05],[-21.65,.52,0],43)),
    path:[
      {at:.40,...wrist},
      {at:.62,...view([-20.6,1.8,-1.4],[-21.9,1.07,-.1],43)},
      {at:.80,...view([-19.45,1.65,-2.8],[-21.75,.72,0],43)},
    ]},
  row('approach','Sean 立即靠近跪下',1.2,view([-19.5,2.1,-4.2],[-20.35,.95,-.25],50),view([-19.8,1.8,-2.3],[-21.5,.75,-.10],50)),
  row('swap','取出並扣上備用感測器',1.4,view([-20.2,1.15,-1.65],[-21.35,.75,-.7],40),view([-20.5,.92,-1.19],join.target,37)),
  row('app','即時手機：目前生命徵象',1.5,two),
  row('question','即時手機：持續觀察',1,two),
  row('guide','即時手機：醫療系統同步',3.6,two),
  row('evidence','即時手機：量測時間與品質',1.2,two),
  row('aid-route','即時手機：現況確認',1.1,two),
  row('aid-steps','即時手機：持續監測',3.4,two),
  row('help','Sean 觀察肩膀並持續協助',1.2,two,view([-20.05,1.65,-2.15],[-21.5,.85,-.1],50)),
  row('later','稍後，Timmy 恢復反應',1.1,two,view([-19.95,1.7,-2.15],[-21.5,.86,-.12],50)),
  row('inspect','拆開故障裝置並檢視內部',1.7,inspect,view([-22.70,1.98,-.53],inspect.target,30)),
  row('title','ASTRO HIYOKO',.6,wide),
];

const editSeconds = {body:4,guide:2.6,evidence:.9,'aid-steps':2.8,help:.95,later:.9};
const edit = script.filter(shot => shot.id !== 'wrist-link');

export function defaultShots() {
  return edit.map(shot => ({id:shot.id,seconds:editSeconds[shot.id] ?? shot.seconds,
    start:structuredClone(shot.start),end:structuredClone(shot.end),
    ...(shot.path ? {path:structuredClone(shot.path)} : {})}));
}

export const names = edit.map(shot => shot.name);
export const formatVersion = 8;
export const insertIds = new Set(['monitor','record-detail','team','app','question','guide','evidence','aid-route','aid-steps']);
export const minSeconds = .25;
export const maxSeconds = 60;
export const totalTime = shots => Math.round(shots.reduce((n, s) => n + s.seconds, 0) * 1000) / 1000;
export const shotStart = (shots, i) => totalTime(shots.slice(0, i));
export const storyAt = (i, progress) => {
  const canonical = script.findIndex(shot => shot.id === edit[i].id);
  return Math.round((shotStart(script, canonical) + script[canonical].seconds * progress) * 1e6) / 1e6;
};

export function locate(shots, seconds) {
  let left = Math.max(0, Math.round(seconds * 1000));
  for (const [index, shot] of shots.entries()) {
    const span = Math.round(shot.seconds * 1000);
    if (left < span || index === shots.length - 1) {
      return {index, progress: Math.min(1, left / span)};
    }
    left -= span;
  }
}

export function interpolate(shot, progress) {
  // Finish the move before the cut, leaving a readable landing composition.
  const p = Math.max(0, Math.min(1, progress / .85));
  const ease = p * p * (3 - 2 * p);
  if (p === 0) return structuredClone(shot.start);
  if (p === 1) return structuredClone(shot.end);
  if (shot.path?.length) return pathView(shot, ease);
  const mix = (a,b) => a + (b - a) * ease;
  return view(shot.start.position.map((a,i) => mix(a,shot.end.position[i])),
    shot.start.target.map((a,i) => mix(a,shot.end.target[i])), mix(shot.start.fov,shot.end.fov));
}

function pathView(shot, progress) {
  const points = [{at:0,...shot.start}, ...shot.path, {at:1,...shot.end}];
  const end = points.findIndex(point => point.at >= progress);
  const a = points[end - 1];
  const b = points[end];
  const before = points[Math.max(0,end - 2)];
  const after = points[Math.min(points.length - 1,end + 1)];
  const span = b.at - a.at;
  const u = (progress - a.at) / span;
  // Monotone Hermite tangents avoid overshooting a doorway when a long corridor
  // move settles into a brief look at a crew station.
  const tangent = (first,last,firstSpan,lastSpan) => {
    if (first*last <= 0) return 0;
    const a = 2*lastSpan + firstSpan;
    const b = lastSpan + 2*firstSpan;
    return (a+b) / (a/first + b/last);
  };
  const blend = (prior, first, last, next) => {
    const slope = (last-first)/span;
    const enter = (before === a ? slope : tangent((first-prior)/(a.at-before.at),slope,a.at-before.at,span))*span;
    const leave = (after === b ? slope : tangent(slope,(next-last)/(after.at-b.at),span,after.at-b.at))*span;
    return (2*u**3 - 3*u**2 + 1)*first + (u**3 - 2*u**2 + u)*enter
      + (-2*u**3 + 3*u**2)*last + (u**3 - u**2)*leave;
  };
  const vector = key => a[key].map((value,i) => blend(before[key][i],value,b[key][i],after[key][i]));
  return view(vector('position'),vector('target'),a.fov + (b.fov - a.fov)*u);
}

function validView(value) {
  const finiteVector = a => Array.isArray(a) && a.length === 3 && a.every(x => Number.isFinite(x) && Math.abs(x) <= 10000);
  return value && finiteVector(value.position) && finiteVector(value.target)
    && Math.hypot(...value.position.map((x,i) => x - value.target[i])) > .005
    && Number.isFinite(value.fov) && value.fov >= 15 && value.fov <= 90;
}

function validPath(path) {
  if (path === undefined) return true;
  return Array.isArray(path) && path.length <= 12 && path.every((point,i) =>
    validView(point) && Number.isFinite(point.at) && point.at > 0 && point.at < 1
    && (i === 0 || point.at > path[i - 1].at));
}

export function readShots(json) {
  const stored = JSON.parse(json);
  if (stored?.version !== formatVersion || !Array.isArray(stored.shots) || stored.shots.length !== edit.length
    || !stored.shots.every((s,i) => s?.id === edit[i].id && Number.isFinite(s.seconds)
      && s.seconds >= minSeconds && s.seconds <= maxSeconds && validView(s.start) && validView(s.end) && validPath(s.path))) {
    throw new Error('分鏡檔的格式、鏡位或秒數有誤。');
  }
  return stored.shots.map(s => ({id:s.id,seconds:Math.round(s.seconds*1000)/1000,start:s.start,end:s.end,
    ...(s.path ? {path:s.path} : {})}));
}
