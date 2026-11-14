import type { Metric, Quality } from './domain'

export type Draft = {
  values: string[]
  quality: Quality
  reason: string
  time: string
  method: string
  context: Record<string, string>
}

export const contexts = {
  heart_rate: { activity: ['rest', 'exercise', 'recovery'] },
  spo2: { measurementSite: ['fingertip', 'earlobe'] },
  blood_pressure: { posture: ['seated', 'standing', 'supine'] },
  temperature: {
    measurementSite: ['oral', 'axillary', 'tympanic'],
    temperatureType: ['peripheral', 'core', 'surface'],
  },
}

export function makeCommand(metric: Metric, crewId: string, draft: Draft, uid: () => string) {
  const unit = { heart_rate: '/min', spo2: '%', blood_pressure: 'mm[Hg]', temperature: 'Cel' }[metric.code]
  const entries = metric.fields.map((code, index) => {
    const raw = draft.values[index]?.trim()
    const value = raw ? Number(raw) : null
    if (value !== null && !Number.isFinite(value)) throw new Error('invalid_number')
    const quality = value === null ? 'missing' : draft.quality
    if (quality !== 'good' && !draft.reason.trim()) throw new Error('missing_reason')
    return { code, unit, value, quality, qualityReason: quality === 'good' ? null : draft.reason.trim() }
  })
  if (entries.every((row) => row.value === null) && draft.quality !== 'missing')
    throw new Error('missing_value')
  if (!draft.method.trim()) throw new Error('missing_method')
  const observed = new Date(draft.time)
  if (!Number.isFinite(observed.getTime())) throw new Error('invalid_time')
  return {
    schemaVersion: '1.3',
    runId: null,
    crewId,
    commandId: uid(),
    observedAt: observed.toISOString(),
    method: draft.method.trim(),
    isSynthetic: true,
    measurementGroupId: metric.code === 'blood_pressure' ? uid() : null,
    context: draft.context,
    metrics: entries,
  }
}
