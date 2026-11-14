import type { Lang } from './domain'

export const regions = [
  { code: 'head', en: 'Head', zh: '頭部' },
  { code: 'neck', en: 'Neck', zh: '頸部' },
  { code: 'chest', en: 'Chest', zh: '胸部' },
  { code: 'abdomen', en: 'Abdomen', zh: '腹部' },
  { code: 'pelvis', en: 'Pelvis', zh: '骨盆' },
  { code: 'back', en: 'Back', zh: '背部' },
  { code: 'left_shoulder', en: 'Left shoulder', zh: '左肩' },
  { code: 'right_shoulder', en: 'Right shoulder', zh: '右肩' },
  { code: 'left_upper_arm', en: 'Left upper arm', zh: '左上臂' },
  { code: 'right_upper_arm', en: 'Right upper arm', zh: '右上臂' },
  { code: 'left_forearm', en: 'Left forearm', zh: '左前臂' },
  { code: 'right_forearm', en: 'Right forearm', zh: '右前臂' },
  { code: 'left_hand', en: 'Left hand', zh: '左手' },
  { code: 'right_hand', en: 'Right hand', zh: '右手' },
  { code: 'left_thigh', en: 'Left thigh', zh: '左大腿' },
  { code: 'right_thigh', en: 'Right thigh', zh: '右大腿' },
  { code: 'left_knee', en: 'Left knee', zh: '左膝' },
  { code: 'right_knee', en: 'Right knee', zh: '右膝' },
  { code: 'left_lower_leg', en: 'Left lower leg', zh: '左小腿' },
  { code: 'right_lower_leg', en: 'Right lower leg', zh: '右小腿' },
  { code: 'left_foot', en: 'Left foot', zh: '左腳' },
  { code: 'right_foot', en: 'Right foot', zh: '右腳' },
] as const
export type RegionCode = (typeof regions)[number]['code']
export type BodyLayer = 'overview' | 'muscle' | 'fat'
export type ScanPreset = 'baseline' | 'training_strain' | 'recovery' | 'partial'
export type RegionReading = {
  muscleMassKg: number | null; fatMassKg: number | null
  quality: 'good' | 'poor' | 'missing'; missingReason: string | null
}
export type BodyFinding = {
  id: string; regionCode: RegionCode; kind: 'strain' | 'bruise' | 'abrasion'
  severity: 'mild' | 'moderate' | 'severe'; status: 'active' | 'recovering' | 'resolved'
  onsetAt: string; functionalImpact: string
}
export type BodyScan = {
  id: string; crewId: string; schemaVersion: 'body-scan/1'; runId: null
  mode: 'training'; synthetic: true; source: 'mock'; method: string
  observedAt: string; receivedAt: string
  totals: { bodyMassKg: number | null; muscleMassKg: number | null; fatMassKg: number | null }
  regions: Partial<Record<RegionCode, RegionReading>>; findings: BodyFinding[]
}
export type ScanList = { items: BodyScan[]; nextCursor: string | null }
export type LatestScan = { scan: BodyScan | null; demoEnabled: boolean }
export type ComparisonReason = 'no_previous' | 'incompatible' | 'missing' | 'not_applicable' | null
export type ValueComparison = { current: number | null; previous: number | null; delta: number | null; unavailableReason: ComparisonReason }
export type Comparison = Record<'bodyMassKg' | 'muscleMassKg' | 'fatMassKg' | 'fatPercent', ValueComparison>

export function regionFromMesh(name: string): RegionCode | null {
  return regions.find(region => region.code === name)?.code ?? null
}
export function regionLabel(code: RegionCode, lang: Lang) {
  const region = regions.find(r => r.code === code)!
  return lang === 'en' ? region.en : region.zh
}
export function fatPercent(scan: BodyScan | null): number | null {
  const mass = scan?.totals.bodyMassKg
  const fat = scan?.totals.fatMassKg
  if (mass == null || mass <= 0 || fat == null) return null
  return 100 * fat / mass
}
export function regionReading(scan: BodyScan | null, region: RegionCode, metric: 'muscleMassKg' | 'fatMassKg') {
  const reading = scan?.regions[region]
  return reading?.quality === 'good' ? reading[metric] : null
}
export function activeFindings(scan: BodyScan | null, region?: RegionCode | null) {
  return scan?.findings.filter(f => f.status !== 'resolved' && (!region || f.regionCode === region)) ?? []
}
export function compareScans(current: BodyScan, previous: BodyScan | null, region: RegionCode | null): Comparison {
  const compatible = previous && ['crewId', 'method', 'source', 'mode', 'synthetic', 'runId'].every(
    key => current[key as keyof BodyScan] === previous[key as keyof BodyScan])
  const read = (scan: BodyScan | null, metric: keyof Comparison) => {
    if (!scan) return null
    if (region) return metric === 'muscleMassKg' || metric === 'fatMassKg' ? regionReading(scan, region, metric) : null
    return metric === 'fatPercent' ? fatPercent(scan) : scan.totals[metric]
  }
  const value = (metric: keyof Comparison): ValueComparison => {
    const a = read(current, metric), b = read(previous, metric)
    const reason = region && (metric === 'bodyMassKg' || metric === 'fatPercent') ? 'not_applicable'
      : !previous ? 'no_previous' : !compatible ? 'incompatible' : a == null || b == null ? 'missing' : null
    return { current: a, previous: b, delta: reason ? null : Math.round((a! - b!) * 100) / 100, unavailableReason: reason }
  }
  return { bodyMassKg: value('bodyMassKg'), muscleMassKg: value('muscleMassKg'), fatMassKg: value('fatMassKg'), fatPercent: value('fatPercent') }
}
export function bodyNumber(value: number | null | undefined) {
  return value == null ? '—' : value.toFixed(1)
}
export const presetLabels: Record<ScanPreset, [string, string]> = {
  baseline: ['Resting baseline', '日常基準'], training_strain: ['After training', '訓練後・拉傷'],
  recovery: ['Recovery', '恢復觀察'], partial: ['Partial scan', '部分資料缺少'],
}
