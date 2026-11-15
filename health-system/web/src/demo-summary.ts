import type { Lang, MeasurementContext, PersonalAnalysis } from './domain.ts'
import type { AssessmentSummary } from './news2.ts'
import type { RadiationSnapshot } from './radiation.ts'

export const summaryMetrics = [
  ['heart_rate', 'Heart rate', '心率'], ['spo2', 'Blood oxygen', '血氧'],
  ['respiratory_rate', 'Respiratory rate', '呼吸頻率'],
  ['blood_pressure_systolic', 'Systolic pressure', '收縮壓'],
  ['blood_pressure_diastolic', 'Diastolic pressure', '舒張壓'],
  ['temperature', 'Temperature', '體溫'],
] as const
export type ProfileEntry = { status: string; items: string[] }
export type DemoProfile = {
  crewId: string; displayName: string; synthetic: boolean; dateOfBirth: string | null
  heightCm: number | null; experienceYears: number | null
  medicalHistory?: ProfileEntry; medications?: ProfileEntry; allergies?: ProfileEntry
}
export type DemoPlayback = {
  status: string; id: string | null; preparedAt: string | null; startedAt: string | null
  elapsedMs: number; durationMs: number; datasetId: string | null; error?: string | null
  activities: { crewId: string; activity: string; phase: string; next?: unknown }[]
}
export type DemoAnalysis = PersonalAnalysis & { analysisCadenceSeconds?: number; demoRunId?: string | null }
export type DemoBaseline = {
  metricCode: string; baselineId: string | null; count?: number; mean?: number; sd?: number
  from?: string; to?: string; unit?: string; context?: MeasurementContext; analysis: DemoAnalysis | null
}
export type DemoAssessment = {
  profile: DemoProfile | null; playback: DemoPlayback; baselines: DemoBaseline[]
  news2: AssessmentSummary | null
  body: { id: string; observedAt: string; totals: { muscleMassKg: number; fatMassKg: number }; findingsCount: number } | null
  radiation: RadiationSnapshot | null
  radiationBreakdown?: { priorMissionsMsv: number | null; history30DaysMsv: number | null
    priorRecordIds: string[]; historyRecordIds: string[] } | null
}
export const summaryPollMs = 5000
export function summaryNumber(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en', { maximumFractionDigits: digits })
}
export function profileEntryText(entry: ProfileEntry | undefined, lang: Lang) {
  if (!entry || entry.status === 'unknown') return lang === 'en' ? 'Unknown / not provided' : '未知／未提供'
  if (entry.status === 'none_reported') return lang === 'en' ? 'None reported' : '未報告有此項目'
  if (entry.items.length) return entry.items.join(lang === 'en' ? ', ' : '、')
  return lang === 'en' ? 'Unknown / not provided' : '未知／未提供'
}
export function analysisPhase(analysis: DemoAnalysis | null, playback: DemoPlayback) {
  if (!analysis) return 'unavailable'
  if (!Number.isFinite(Date.parse(analysis.observedAt))) return 'unavailable'
  if (!playback.id || analysis.demoRunId !== playback.id || !playback.startedAt ||
      Date.parse(analysis.observedAt) < Date.parse(playback.startedAt)) return 'history'
  const cadence = analysis.analysisCadenceSeconds
  if (playback.status === 'playing' && cadence &&
      Date.parse(playback.startedAt) + playback.elapsedMs - Date.parse(analysis.observedAt) > 4 * cadence * 1000) return 'stale'
  return 'playback'
}
export function summaryScore(assessment: AssessmentSummary | null) {
  if (assessment?.assessmentStatus !== 'scored' || assessment.news2Score == null || !Number.isFinite(assessment.news2Score)) return null
  return assessment.news2Score
}
