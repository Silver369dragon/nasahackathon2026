import test from 'node:test';
import assert from 'node:assert/strict';
import { committedElapsed, createDemoClock, createDemoRoutines, formatDemoTime } from './health-demo-clock.mjs';
import { stationCrew } from './config.mjs';
import { homes } from './routines.mjs';

test('clock only follows committed time, freezes on network gaps and restores existing runs', () => {
  const clock = createDemoClock();
  clock.receive({id:'run1',status:'playing',elapsedMs:60000},0);
  assert.equal(clock.elapsed(100000),60000);
  clock.receive({id:'run1',status:'playing',elapsedMs:61000},100000);
  assert.equal(clock.elapsed(100500),60500);
  assert.equal(clock.elapsed(200000),61000);
  clock.receive({id:'run1',status:'completed',elapsedMs:300000},200000);
  assert.equal(clock.elapsed(400000),300000);
  clock.receive({id:'run2',status:'playing',elapsedMs:0},400001);
  assert.equal(clock.elapsed(400002),0);
  assert.equal(committedElapsed({elapsedMs:Infinity}),0);
  assert.equal(committedElapsed({elapsedMs:999999}),300000);
  assert.equal(formatDemoTime(300000),'05:00');
});

test('stable crew IDs preserve model homes despite shuffled rows; Kai uses the training area', () => {
  const routines = createDemoRoutines();
  routines.receive({id:'r',elapsedMs:0,activities:[...stationCrew].reverse().map(crewId => ({crewId,activity:'rest',phase:'initial',phaseStartMs:0}))});
  assert.deepEqual(routines.at(0).map(row => row.position),homes);
  routines.receive({id:'r',elapsedMs:60000,activities:[{crewId:'kai',activity:'exercise',phase:'training',phaseStartMs:60000}]});
  const kai = stationCrew.indexOf('kai');
  assert.equal(routines.at(60000)[kai].moving,true);
  assert.deepEqual(routines.at(60000)[kai].position,homes[kai]);
  assert.deepEqual(routines.at(119000)[kai].position,[9.05,3.5]);
  assert.equal(routines.at(119000)[kai].activity,'Cycle training');
  assert.deepEqual(routines.at(119000)[stationCrew.indexOf('lin')].position,homes[0]);
  routines.receive({id:'r',elapsedMs:120000,activities:[{crewId:'kai',activity:'recovery',phase:'recovery',phaseStartMs:120000}]});
  assert.deepEqual(routines.at(179000)[kai].position,[7,-2]);
  routines.receive({id:'r',elapsedMs:180000,activities:[{crewId:'kai',activity:'rest',phase:'rest',phaseStartMs:180000}]});
  assert.deepEqual(routines.at(239000)[kai].position,homes[kai]);
});

test('refresh attaches to persisted activity without replaying a local route or creating a run', () => {
  const routines = createDemoRoutines();
  routines.receive({id:'existing',elapsedMs:110000,activities:[{crewId:'kai',activity:'exercise',phase:'training',phaseStartMs:60000}]});
  assert.deepEqual(routines.at(110000)[stationCrew.indexOf('kai')].position,[9.05,3.5]);
  routines.receive({id:'existing',elapsedMs:111000,activities:[{crewId:'unknown',activity:'exercise'}]});
  assert.deepEqual(routines.at(111000)[stationCrew.indexOf('kai')].position,[9.05,3.5]);
});
