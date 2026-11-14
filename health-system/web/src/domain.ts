export type Lang = 'en' | 'zh-TW'
export type View = 'personal' | 'system' | 'system_display'
export type Session = {
  username: string
  crewId: string | null
  roles: string[]
  csrfToken: string
  mode?: string
}
export type Quality = 'good' | 'poor' | 'invalid' | 'missing'
export type Measurement = {
  id: string
  metricCode: string
  value: number | null
  unit: string
  observedAt: string
  receivedAt?: string
  method: string
  context: Record<string, string | null>
  provenance: { source: string; isSynthetic: boolean; dataOrigin?: string }
  quality: Quality
  qualityReason?: string | null
  measurementGroupId?: string | null
}
export type MetricCard = {
  metricCode: string
  latest: Measurement | null
  lastValid: Measurement | null
  freshness: string
}
export type CrewSummary = {
  crewId: string
  name: string
  entityVersion?: number
  version?: number
  metricCards: MetricCard[]
  deviceStatus?: string
}
export type Emergency = { id: string; crewId: string; source: 'manual' | 'sensor'; createdAt: string }
export function shouldNotifyDesktop(item: Emergency, context: {
  hidden: boolean; permission: NotificationPermission; crewId: string | null
}) {
  return context.hidden && context.permission === 'granted' &&
    (item.source !== 'manual' || item.crewId !== context.crewId)
}
export type Snapshot = {
  news2Assessments?: import('./news2').AssessmentSummary[]
  crewSummaries: CrewSummary[]
  emergencies: Emergency[]
  scopeVersion: number
  cursor: string
  view: View
}
export function addEmergency(items: Emergency[], item: Emergency) {
  if (!item?.id || !item.crewId || !['manual', 'sensor'].includes(item.source) || !Number.isFinite(Date.parse(item.createdAt))) {
    throw new Error('Invalid emergency notice')
  }
  if (items.some(existing => existing.id === item.id)) return items
  return [item, ...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 50)
}

export const metrics = [
  { code: 'heart_rate', en: 'Heart rate', zh: '心率', unit: 'bpm', fields: ['heart_rate'] },
  { code: 'spo2', en: 'Blood oxygen', zh: '血氧', unit: '%', fields: ['spo2'] },
  {
    code: 'blood_pressure',
    en: 'Blood pressure',
    zh: '血壓',
    unit: 'mmHg',
    fields: ['blood_pressure_systolic', 'blood_pressure_diastolic'],
  },
  { code: 'temperature', en: 'Body temperature', zh: '體溫', unit: '°C', fields: ['temperature'] },
] as const
export type Metric = (typeof metrics)[number]
export const tx = (lang: Lang, en: string, zh: string) => (lang === 'en' ? en : zh)

export function prettyValue(record: Measurement | null, showPoor = false): string {
  if (!record || record.value === null || (!showPoor && record.quality !== 'good')) return '—'
  return record.value.toFixed(record.metricCode === 'temperature' ? 1 : 0)
}

// Each displayed BP pair belongs to one observation, including partial observations.
export function selectReadings(cards: MetricCard[], metric: Metric, key: 'latest' | 'lastValid') {
  const rows = metric.fields.map((code) => cards.find((row) => row.metricCode === code)?.[key] ?? null)
  if (rows.length === 1) return rows
  const newest = [...rows].sort(
    (a, b) => Date.parse(b?.observedAt ?? '1970-01-01') - Date.parse(a?.observedAt ?? '1970-01-01'),
  )[0]
  return rows.map((row) =>
    row &&
    (row === newest || (newest?.measurementGroupId && row.measurementGroupId === newest.measurementGroupId))
      ? row
      : null,
  )
}

export function localDateTime() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}

export function stamp(value: string, lang: Lang) {
  return (
    new Intl.DateTimeFormat(lang, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    }).format(new Date(value)) + ' UTC'
  )
}

export function relativeTime(value: string, lang: Lang, now = Date.now()) {
  const diff = (Date.parse(value) - now) / 1000
  const divisor = Math.abs(diff) < 60 ? 1 : Math.abs(diff) < 3600 ? 60 : Math.abs(diff) < 86400 ? 3600 : 86400
  const unit = divisor === 1 ? 'second' : divisor === 60 ? 'minute' : divisor === 3600 ? 'hour' : 'day'
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(Math.round(diff / divisor), unit)
}

export type SummaryEvent = {
  entityId: string
  entityVersion: number
  scopeVersion: number
  operation: 'upsert' | 'remove'
  payload?: CrewSummary
}
export function applySummary(rows: CrewSummary[], versions: Map<string, number>, event: SummaryEvent) {
  if (event.entityVersion <= (versions.get(event.entityId) ?? -1)) return rows
  if (event.operation === 'upsert' && (!event.payload || event.payload.crewId !== event.entityId))
    throw new Error('Invalid summary')
  versions.set(event.entityId, event.entityVersion)
  if (event.operation === 'remove') return rows.filter((row) => row.crewId !== event.entityId)
  const exists = rows.some((row) => row.crewId === event.entityId)
  if (!exists) return [...rows, event.payload!]
  return rows.map((row) => (row.crewId === event.entityId ? event.payload! : row))
}

export function home(session: Session) {
  if (session.roles.includes('crew') && session.crewId) return '/app/overview'
  if (session.roles.includes('monitor')) return '/system/overview'
  if (session.roles.includes('display')) return '/board'
  return '/unavailable'
}

export function canView(path: string, session: Session) {
  if (path === '/board') return session.roles.some((role) => ['monitor', 'display'].includes(role))
  if (path.startsWith('/system/')) return session.roles.includes('monitor')
  if (path.startsWith('/app/')) return !!session.crewId && session.roles.includes('crew')
  return false
}
