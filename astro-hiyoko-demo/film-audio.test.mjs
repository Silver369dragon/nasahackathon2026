import test from 'node:test';
import assert from 'node:assert/strict';
import {createFilmOutput,renderFilmAudio} from './film-output.js';
import {defaultShots, locate, storyAt} from './film-timeline.mjs';

function offlineAudio(scheduled) {
  const parameter = () => ({setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {}});
  const node = () => ({
    gain:parameter(), frequency:parameter(), connect() {return this;}, disconnect() {}, stop() {},
    start(at) {if (this.buffer?.key) scheduled.push({key:this.buffer.key,at});},
  });
  return class {
    destination = {};
    createGain = node;
    createOscillator = node;
    createBufferSource = node;
    createBiquadFilter = node;
    createBuffer() {return {getChannelData:() => new Float32Array(48000)};}
    async startRendering() {return scheduled;}
  };
}

test('the revised live insert never claims the simulated health alert is current', t => {
  const words = [];
  const ctx = {fillRect(){},drawImage(){},save(){},restore(){},beginPath(){},roundRect(){},fill(){},arc(){},clip(){},
    moveTo(){},lineTo(){},stroke(){},fillText(value){words.push(value);}};
  const previous = globalThis.document;
  globalThis.document = {createElement:() => ({setAttribute(){},getContext:() => ctx})};
  t.after(() => { if(previous) globalThis.document=previous; else delete globalThis.document; });
  const output = createFilmOutput({},() => {},{ready:true,live:true,draw(){}},'revised');
  output.draw(14,{id:'app',progress:.5,time:17});
  assert.ok(words.includes('LIVE MEDICAL SYSTEM'));
  assert.ok(!words.includes('HEALTH ALERT REMAINS'));
});

function captureFrames(t, media, edition) {
  const words = [], images = [], clips = [], segments = [];
  const ctx = {fillRect(){},save(){},restore(){},beginPath(){},roundRect(){},fill(){},arc(){},clip(){},stroke(){},
    moveTo(){},lineTo(...args){segments.push(args);},fillText(value){words.push(value);},
    drawImage(image){images.push(image);},measureText:() => ({width:200})};
  const previous = globalThis.document;
  globalThis.document = {createElement:() => ({setAttribute(){},getContext:() => ctx})};
  t.after(() => { if(previous) globalThis.document=previous; else delete globalThis.document; });
  const output = createFilmOutput({},() => {},{ready:true,live:false,draw:(_ctx,key,p) => clips.push({key,p}),...media},edition);
  return {output,words,images,clips,segments};
}

test('original inspection keeps the opened 3D device visible without a full-screen circuit image', t => {
  const circuitImage = {naturalWidth:1906,naturalHeight:897};
  const frame = captureFrames(t,{circuitImage},'original');
  frame.output.draw(28.3,{id:'inspect',progress:.6/1.7,time:28.3,seconds:1.7});
  assert.ok(!frame.images.includes(circuitImage));
  frame.output.draw(28.5,{id:'inspect',progress:.8/1.7,time:28.5,seconds:1.7});
  assert.ok(!frame.images.includes(circuitImage));
  assert.ok(!frame.words.includes('SENSOR CIRCUIT'));
});

test('the health warning shows recorded App values without an invented trend line', t => {
  const frame = captureFrames(t,{},'revised');
  frame.output.draw(8,{id:'wrist-warning',progress:.5,time:8.5});
  assert.deepEqual(frame.clips,[{key:'alert',p:1}]);
  assert.ok(frame.words.includes('HEALTH'));
  assert.ok(!frame.words.includes('LIVE'), 'recorded measurements must not be labeled live');
  assert.ok(!frame.words.includes('HEART RATE TREND RISING'));
  assert.ok(frame.segments.length < 3, 'an arbitrary waveform was drawn over the scene');
});

test('live footage labels scripted connection failures and recovery as a scenario', t => {
  const frame = captureFrames(t,{live:true},'revised');
  for (const id of ['collapse','swap','reconnect']) {
    frame.words.length = 0;
    frame.output.draw(12,{id,progress:.5,time:12});
    assert.ok(frame.words.includes('SIMULATED SCENARIO'),`${id} must distinguish the story from live connection status`);
  }
});

for (const edited of [false,true]) {
  test(`exported dialogue starts when its subtitle appears (${edited ? 'custom' : 'default'} edit)`, async t => {
    const scheduled = [];
    const previous = globalThis.OfflineAudioContext;
    globalThis.OfflineAudioContext = offlineAudio(scheduled);
    t.after(() => {
      if (previous) globalThis.OfflineAudioContext = previous;
      else delete globalThis.OfflineAudioContext;
    });
    const shots = defaultShots();
    if (edited) {
      shots.find(shot => shot.id === 'body').seconds += 2;
      shots.find(shot => shot.id === 'approach').seconds *= 2;
    }
    await renderFilmAudio(shots,{audio:new Map(['mira','beside'].map(key => [key,{key}]))});
    assert.equal(scheduled.length,2);
    for (const [key,storyTime] of [['mira',11],['beside',12.2]]) {
      const actual = scheduled.find(event => event.key === key).at;
      const sample = locate(shots,actual);
      assert.ok(Math.abs(storyAt(sample.index,sample.progress)-storyTime)<.002,
        `${key} audio at ${actual}s does not coincide with subtitle story time ${storyTime}s`);
    }
    if (!edited) assert.ok(Math.abs(scheduled[0].at-13.35)<.001);
  });
}

for (const edited of [false,true]) {
  test(`revised dialogue stays aligned with the rescue (${edited ? 'custom' : 'default'} edit)`, async t => {
    const scheduled = [];
    const previous = globalThis.OfflineAudioContext;
    globalThis.OfflineAudioContext = offlineAudio(scheduled);
    t.after(() => {
      if (previous) globalThis.OfflineAudioContext = previous;
      else delete globalThis.OfflineAudioContext;
    });
    const shots = defaultShots('revised');
    if (edited) shots[0].seconds += 1;
    await renderFilmAudio(shots,{audio:new Map(['mira','beside'].map(key => [key,{key}]))},'revised');
    assert.deepEqual(scheduled,[{key:'mira',at:edited ? 11.8 : 10.8}]);
  });
}
