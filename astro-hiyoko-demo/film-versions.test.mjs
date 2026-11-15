import test from 'node:test';
import assert from 'node:assert/strict';
import * as timeline from './film-timeline.mjs';

test('the revised cut tells the incident chronologically and keeps rescue at the planned times', () => {
  const shots = timeline.defaultShots('revised');
  assert.equal(shots[0].id, 'training-task');
  assert.equal(timeline.totalTime(shots), 30);
  for (const [time, id] of [[2.8,'body'],[4.3,'opening'],[6.3,'wrist-warning'],[8.3,'collapse'],[10.8,'approach'],[14.8,'app'],[21.8,'help'],[24.8,'later'],[26.8,'inspect'],[28,'title']]) {
    assert.equal(shots[timeline.locate(shots,time).index].id,id);
  }
  assert.ok(!shots.some(s => s.id === 'radiation'));
  assert.equal(shots.find(s => s.id === 'inspect').seconds,1.2);
  for(let i=1;i<shots.length;i++) assert.ok(timeline.storyAt(i,0,'revised') >= timeline.storyAt(i-1,1,'revised')-.001);
});

test('previous revised edits give the removed radiation duration to the closing circuit shot', () => {
  const shots = timeline.defaultShots('revised').filter(s => s.id !== 'inspect');
  shots.splice(2,0,{...timeline.defaultShots().find(s => s.id === 'radiation'),seconds:1.2});
  shots.find(s => s.id === 'body').start.fov = 43;
  const before = structuredClone(shots);
  const revised = timeline.readShots(JSON.stringify({version:8,edition:'revised',shots}),'revised');
  assert.ok(!revised.some(s => s.id === 'radiation'));
  assert.equal(revised.at(-2).id,'inspect');
  assert.equal(revised.at(-2).seconds,1.2);
  assert.equal(timeline.totalTime(revised),timeline.totalTime(before));
  for (const shot of before.filter(s => s.id !== 'radiation')) assert.deepEqual(revised.find(s => s.id === shot.id),shot);
});

test('legacy v8 files still load and a revised file cannot replace the original', () => {
  const original = timeline.defaultShots();
  original[0].seconds = 3.21;
  original[0].start.fov = 61;
  const legacy = JSON.stringify({version:8,shots:original});
  assert.deepEqual(timeline.readShots(legacy),original);
  const revised = timeline.defaultShots('revised');
  const json = JSON.stringify({version:8,edition:'revised',shots:revised});
  assert.throws(() => timeline.readShots(json), /版本/);
  assert.deepEqual(timeline.readShots(json,'revised'),revised);
});

test('editing either version keeps the other version and the original snapshot intact', () => {
  assert.equal(typeof timeline.loadEdition,'function');
  const values = new Map();
  const storage = {getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,value)};
  const original = timeline.defaultShots();
  original[0].seconds = 3.21;
  const saved = JSON.stringify({version:8,shots:original});
  storage.setItem('hiyoko.film.shots.v8',saved);
  const revised = timeline.loadEdition(storage,'revised').shots;
  revised[0].seconds = 2.75;
  timeline.saveEdition(storage,'revised',revised);
  assert.equal(storage.getItem('hiyoko.film.shots.v8'),saved);
  assert.deepEqual(timeline.loadEdition(storage,'original').shots,original);
  assert.equal(timeline.loadEdition(storage,'revised').shots[0].seconds,2.75);
  original[0].seconds = 4;
  timeline.saveEdition(storage,'original',original);
  assert.equal(timeline.readShots(timeline.originalBackup(storage))[0].seconds,3.21);
});

test('invalid saved data is reported and preserved instead of silently overwritten', () => {
  assert.equal(typeof timeline.loadEdition,'function');
  const values = new Map([['hiyoko.film.shots.v8','broken-json']]);
  const storage = {getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,value)};
  const result = timeline.loadEdition(storage,'original');
  assert.ok(result.error);
  assert.equal(values.get('hiyoko.film.shots.v8'),'broken-json');
  assert.equal(timeline.originalBackup(storage),'broken-json');
});

test('a full storage quota must not hide the readable original edit', () => {
  const original = timeline.defaultShots();
  original[0].seconds = 4.25;
  const saved = JSON.stringify({version:8,shots:original});
  const storage = {getItem:key => key === 'hiyoko.film.shots.v8' ? saved : null,
    setItem:() => { throw new Error('QuotaExceededError'); }};
  const result = timeline.loadEdition(storage,'original');
  assert.deepEqual(result.shots,original);
  assert.equal(result.error,null);
  assert.ok(result.backupError);
});

test('the rejected flashback cut is retained without loading its old camera into the corrected cut', () => {
  const values = new Map([['hiyoko.film.shots.revised.v1','previous-cut']]);
  const storage = {getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,value)};
  const loaded = timeline.loadEdition(storage,'revised');
  assert.equal(loaded.error,null);
  assert.equal(loaded.shots[0].id,'training-task');
  timeline.saveEdition(storage,'revised',loaded.shots);
  assert.equal(values.get('hiyoko.film.shots.revised.v1'),'previous-cut');
});
