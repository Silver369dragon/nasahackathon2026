import test from 'node:test'
import assert from 'node:assert/strict'
import { regions, regionFromMesh, fatPercent, compareScans, activeFindings, regionReading } from '../src/body-map.ts'

const scan = (changes = {}) => ({
  id: 'scan-2', crewId: 'mira', schemaVersion: 'body-scan/1', runId: null,
  mode: 'training', synthetic: true, source: 'mock', method: 'orbital-bioscan-v1',
  observedAt: '2026-11-14T00:00:00Z', receivedAt: '2026-11-14T00:00:00Z',
  totals: { bodyMassKg: 70, muscleMassKg: 30, fatMassKg: 14 },
  regions: { left_thigh: { muscleMassKg: 3, fatMassKg: 1, quality: 'good', missingReason: null } },
  findings: [], ...changes,
})

test('22 stable body regions map meshes without swapping anatomical left and right', () => {
  assert.equal(regions.length, 22)
  assert.equal(new Set(regions.map(r => r.code)).size, 22)
  assert.equal(regionFromMesh('left_thigh'), 'left_thigh')
  assert.equal(regionFromMesh('right_thigh'), 'right_thigh')
  assert.equal(regionFromMesh('unmapped-decoration'), null)
})

test('body fat uses total body mass and never invents a local percentage', () => {
  assert.equal(fatPercent(scan()), 20)
  assert.equal(fatPercent(scan({ totals: { bodyMassKg: 0, muscleMassKg: 30, fatMassKg: 14 } })), null)
  assert.equal(fatPercent(scan({ totals: { bodyMassKg: 70, muscleMassKg: 30, fatMassKg: null } })), null)
  const local = compareScans(scan(), scan(), 'left_thigh')
  assert.equal(local.fatPercent.current, null)
  assert.equal(local.fatMassKg.current, 1)
})

test('comparisons preserve zero and refuse missing, poor or mismatched observations', () => {
  const previous = scan({ id: 'scan-1', totals: { bodyMassKg: 70, muscleMassKg: 29, fatMassKg: 15 } })
  assert.equal(compareScans(scan(), previous, null).muscleMassKg.delta, 1)
  assert.equal(compareScans(scan(), scan(), null).fatMassKg.delta, 0)
  for (const changed of [{ crewId: 'kai' }, { method: 'other' }, { source: 'hardware' }]) {
    assert.equal(compareScans(scan(), scan(changed), null).fatMassKg.delta, null)
  }
  const poor = scan({ regions: { left_thigh: { muscleMassKg: 3, fatMassKg: 1, quality: 'poor', missingReason: 'motion' } } })
  assert.equal(regionReading(poor, 'left_thigh', 'muscleMassKg'), null)
  assert.equal(compareScans(scan(), poor, 'left_thigh').muscleMassKg.delta, null)
  assert.equal(compareScans(scan(), scan({ regions: {} }), 'left_thigh').fatMassKg.delta, null)
  assert.equal(compareScans(scan(), null, null).fatMassKg.unavailableReason, 'no_previous')
})

test('resolved findings stay in history but do not count as current injuries', () => {
  const findings = [
    { id: 'a', regionCode: 'left_thigh', status: 'active' },
    { id: 'b', regionCode: 'left_thigh', status: 'recovering' },
    { id: 'c', regionCode: 'left_thigh', status: 'resolved' },
    { id: 'd', regionCode: 'right_hand', status: 'active' },
  ]
  assert.deepEqual(activeFindings(scan({ findings }), 'left_thigh').map(f => f.id), ['a', 'b'])
  assert.equal(activeFindings(scan({ findings })).length, 3)
  assert.equal(findings.length, 4)
})
