import * as THREE from 'three';

const clipKeys = ['body-map', 'trends', 'record-detail', 'overview', 'alert', 'question', 'guide', 'evidence', 'aid-route', 'aid-steps'];
const stillKeys = ['board', 'boardNormal', 'phone', 'phoneNormal', 'taskPhone', 'taskPhoneReady'];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      try { await image.decode(); resolve(image); }
      catch { reject(new Error(`無法解碼真實 App 素材：${src}`)); }
    };
    image.onerror = () => reject(new Error(`無法載入真實 App 素材：${src}`));
    image.src = src;
  });
}

function texture(image) {
  const map = new THREE.Texture(image);
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;
  return map;
}

// Film assets contain recorded application pixels. Live monitoring is owned by
// film-media.js and never falls back to these recordings on connection loss.
export async function loadFilmedMedia(url = '/film-assets/manifest.json') {
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error(`真實 App 素材清單載入失敗（${response.status}）。`);
  const manifest = await response.json();
  if (manifest.language !== 'en') throw new Error('新版影片需要英文醫療素材，請完成素材更新後重新整理。');
  const clips = {}, sources = new Set(), images = new Map();
  for (const key of clipKeys) {
    const clip = manifest.clips?.[key];
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || !clip.frames?.length) {
      throw new Error(`缺少可用的真實 App 片段：${key}`);
    }
    const frames = [...clip.frames].sort((a,b) => a.time - b.time);
    if (frames[0].time !== 0 || frames.some(frame => !Number.isFinite(frame.time) || frame.time < 0 || frame.time > clip.duration
      || typeof frame.src !== 'string' || !frame.src.startsWith('/film-assets/'))) {
      throw new Error(`真實 App 片段時間或來源無效：${key}`);
    }
    if (key === 'body-map' && (frames.length < Math.ceil(clip.duration * 24)
      || frames.at(-1).time < clip.duration - 1 / 24
      || frames.some((frame,i) => i > 0 && frame.time - frames[i - 1].time > 1 / 24 + .001))) {
      throw new Error('人體 3D 素材必須是連續操作錄影，不能使用定格圖片。');
    }
    clips[key] = {...clip, frames};
    frames.forEach(frame => sources.add(frame.src));
  }
  for (const key of stillKeys) {
    const src = manifest.clean?.[key];
    if (typeof src !== 'string' || !src.startsWith('/film-assets/')) throw new Error(`缺少可用的真實裝置畫面：${key}`);
    sources.add(src);
  }
  const audio = new Map(), decoder = new OfflineAudioContext(1, 1, 48000);
  await Promise.all([
    ...[...sources].map(async src => images.set(src, await loadImage(src))),
    ...['mira', 'beside'].map(async key => {
      const src = `/film-assets/audio/${key}.wav`;
      const sound = await fetch(src);
      if (!sound.ok) throw new Error(`示範配音載入失敗：${src}`);
      try { audio.set(key, await decoder.decodeAudioData(await sound.arrayBuffer())); }
      catch { throw new Error(`示範配音解碼失敗：${src}`); }
    }),
  ]);
  for (const clip of Object.values(clips)) {
    if (clip.presentation !== 'phone') continue;
    for (const frame of clip.frames) {
      const image = images.get(frame.src);
      if (image.naturalWidth < 390 || image.naturalHeight < 700 || Math.abs(image.naturalWidth / image.naturalHeight - 390 / 700) > .005) {
        throw new Error(`手機實錄素材比例不符：${frame.src}`);
      }
    }
  }
  const frameAt = (key, progress) => {
    const clip = clips[key];
    if (!clip) throw new Error(`未知真實 App 片段：${key}`);
    const localTime = Math.max(0, Math.min(1, progress)) * clip.duration;
    let frame = clip.frames[0];
    for (const candidate of clip.frames) {
      if (candidate.time > localTime + 1e-6) break;
      frame = candidate;
    }
    return images.get(frame.src);
  };
  const bodyCanvas = document.createElement('canvas');
  bodyCanvas.width = 1280; bodyCanvas.height = 720;
  const bodyContext = bodyCanvas.getContext('2d');
  const textures = Object.fromEntries(stillKeys.map(key => [key, texture(images.get(manifest.clean[key]))]));
  textures.bodyMap = new THREE.CanvasTexture(bodyCanvas);
  textures.bodyMap.colorSpace = THREE.SRGBColorSpace;
  const sensorCanvas = document.createElement('canvas');
  sensorCanvas.width = 320; sensorCanvas.height = 192;
  const sensorContext = sensorCanvas.getContext('2d');
  textures.sensor = new THREE.CanvasTexture(sensorCanvas);
  textures.sensor.colorSpace = THREE.SRGBColorSpace;
  let bodyFrame, sensorState;
  return {
    ready:true, live:false, manifest, images, audio, textures, frameAt,
    update(storyTime, context = null) {
      // Show connection state for the scripted prop, without inventing a
      // current vital reading. Actual measurements stay in the recorded App.
      let state = storyTime < 8.8 ? 'LINKED' : storyTime < 13.35 ? 'OFFLINE' : 'LINKED';
      if (context?.id === 'wrist-warning') state = 'ALERT';
      if (context?.id === 'reconnect') state = context.progress < .3 ? 'LINKING' : 'LINKED';
      if (state !== sensorState) {
        sensorContext.fillStyle = '#071b24'; sensorContext.fillRect(0,0,320,192);
        sensorContext.fillStyle = state === 'LINKED' ? '#a7e6db' : '#ffc87b';
        sensorContext.font = '24px sans-serif'; sensorContext.fillText('DEVICE',22,38);
        sensorContext.font = 'bold 54px sans-serif'; sensorContext.fillText(state,22,119,276);
        sensorContext.fillRect(22,152,276,3);
        textures.sensor.needsUpdate = true;
        sensorState = state;
      }
      const frame = frameAt('body-map', (storyTime - 4) / .9);
      if (frame === bodyFrame) return;
      bodyContext.drawImage(frame, 0, 0, 1280, 720);
      textures.bodyMap.needsUpdate = true;
      bodyFrame = frame;
    },
    draw(ctx, key, progress, {x=0,y=0,width=1280,height=720} = {}) {
      ctx.drawImage(frameAt(key, progress), x, y, width, height);
    },
  };
}
