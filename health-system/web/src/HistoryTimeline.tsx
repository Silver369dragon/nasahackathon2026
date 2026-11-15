import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, restricted } from './api'
import { displayUnit, monitoringMetrics, prettyValue, stamp, tx, type CrewSummary, type Lang, type Measurement } from './domain'
import { contextLabels, label } from './labels'
import { referenceBand } from './Trends'
import { useMobile } from './MobileHome'
import './history-timeline.css'

// Phone layout for measurement history: a dot matrix. Rows are measurement times (newest on
// top), columns are vitals. Each dot is green inside the NEWS2 training reference range, orange
// outside it, gray when unusable, and hollow when that vital was not measured.
const matrixRows: [string, string, string][] = [
  ['heart_rate', 'Pulse', '心率'], ['spo2', 'SpO₂', '血氧'], ['blood_pressure_systolic', 'BP', '血壓'],
  ['temperature', 'Temp', '體溫'], ['respiratory_rate', 'Resp', '呼吸'],
]

type Row = { key: string; at: string; items: Measurement[] }

function rows(items: Measurement[]): Row[] {
  const map = new Map<string, Measurement[]>()
  for (const item of items) {
    const key = item.observedAt.slice(0, 19)
    map.set(key, [...(map.get(key) ?? []), item])
  }
  return [...map.entries()].map(([key, list]) => ({ key, at: list[0].observedAt, items: list }))
}

function status(m: Measurement) {
  if (m.quality !== 'good' || m.value === null || typeof m.value === 'object') return 'unusable'
  const band = referenceBand[m.metricCode]
  return band && (m.value < band[0] || m.value > band[1]) ? 'outside' : 'inside'
}

// Short chip names so three chips fit on one line.
const shortNames: Record<string, [string, string]> = {
  heart_rate: ['Pulse', '心率'], spo2: ['SpO₂', '血氧'], temperature: ['Temp', '體溫'],
  respiratory_rate: ['Resp', '呼吸'], work_of_breathing: ['Effort', '呼吸費力'],
}
function name(code: string, lang: Lang) {
  if (code === 'blood_pressure_systolic' || code === 'blood_pressure_diastolic') return tx(lang, 'BP', '血壓')
  const short = shortNames[code]
  if (short) return tx(lang, short[0], short[1])
  const metric = monitoringMetrics.find(m => m.fields.some(f => f === code))
  return metric ? tx(lang, metric.en, metric.zh) : code
}

export function HistoryTimeline({ crew, lang, deny, historyRevision }: {
  crew: CrewSummary; lang: Lang; deny: () => void; historyRevision?: string
}) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const [items, setItems] = useState<Measurement[] | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [cursors, setCursors] = useState<string[]>([''])
  const [next, setNext] = useState<string | null>(null)
  const [screen, setScreen] = useState(0)
  const [open, setOpen] = useState<Row | null>(null)
  // Seven rows fit a phone screen; wider screens show more per page.
  const PER_SCREEN = useMobile() ? 7 : 12
  const cursor = cursors[cursors.length - 1]
  const revision = cursor ? '' : historyRevision
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ crewId: crew.crewId, limit: '60' })
    if (cursor) query.set('cursor', cursor)
    void api<{ items: Measurement[]; nextCursor: string | null }>('/measurements?' + query, { signal: controller.signal })
      .then(data => { setItems(data.items); setNext(data.nextCursor); setError(false) })
      .catch(err => {
        if (controller.signal.aborted) return
        if (restricted(err)) { deny(); return }
        setError(true)
      })
    return () => controller.abort()
  }, [crew.crewId, cursor, revision, retry, deny])
  if (error) return <p className="panel empty-state" role="alert">{t('History unavailable.', '無法讀取歷史。')}{' '}
    <button className="text-btn" onClick={() => setRetry(n => n + 1)}>{t('Retry', '重試')}</button></p>
  if (!items) return <p className="panel empty-state">{t('Loading history…', '載入歷史中…')}</p>
  if (open) return <section className="panel history-detail">
    <button className="history-detail-back" onClick={() => setOpen(null)}><ArrowLeft size={16}/>{t('Back to list', '返回列表')}</button>
    <h2>{stamp(open.at, lang)}</h2>
    <ul>{open.items.map(m => <li key={m.id}>
      <div><strong>{name(m.metricCode, lang)}{m.metricCode.endsWith('_systolic') ? t(' · Systolic', ' · 收縮壓') : m.metricCode.endsWith('_diastolic') ? t(' · Diastolic', ' · 舒張壓') : ''}</strong>
        <b className={'history-chip ' + status(m)}>{prettyValue(m, true, lang)} {displayUnit(m.unit, m.metricCode)}</b></div>
      <small>{label(m.provenance.source, lang)} · {label(m.quality, lang)}{m.qualityReason ? ' · ' + label(m.qualityReason, lang) : ''}
        {contextLabels(m.context, lang).length ? ' · ' + contextLabels(m.context, lang).join(' · ') : ''}</small>
    </li>)}</ul>
  </section>
  const all = rows(items)
  const pages = Math.max(1, Math.ceil(all.length / PER_SCREEN))
  const shown = all.slice(screen * PER_SCREEN, screen * PER_SCREEN + PER_SCREEN)
  const newer = () => {
    if (screen > 0) setScreen(screen - 1)
    else if (cursors.length > 1) { setItems(null); setCursors(cursors.slice(0, -1)); setScreen(0) }
  }
  const older = () => {
    if (screen < pages - 1) setScreen(screen + 1)
    else if (next) { setItems(null); setCursors([...cursors, next]); setScreen(0) }
  }
  const cell = (row: Row, code: string) => {
    const m = row.items.find(item => item.metricCode === code)
    if (!m) return { state: 'none', value: '' }
    if (code === 'blood_pressure_systolic') {
      const d = row.items.find(item => item.metricCode === 'blood_pressure_diastolic')
      return { state: status(m), value: prettyValue(m, true, lang) + '/' + (d ? prettyValue(d, true, lang) : '—') }
    }
    return { state: status(m), value: status(m) === 'unusable' ? '' : prettyValue(m, true, lang) }
  }
  return <section className="panel history-timeline history-matrix">
    <p className="history-day">{t('Observation time (UTC)', '量測時間（UTC）')}<span className="history-legend">
      <span className="dot inside"/>{t('In range', '範圍內')}<span className="dot outside"/>{t('Outside', '超出')}
      <span className="dot unusable"/>{t('Unusable', '品質不足')}<span className="dot none"/>{t('Not taken', '沒量')}</span></p>
    {shown.length ? <table>
      <thead><tr><th scope="col">UTC</th>{matrixRows.map(([code, en, zh]) => <th key={code} scope="col">{t(en, zh)}</th>)}</tr></thead>
      <tbody>{shown.map(row => <tr key={row.key}>
        <th scope="row"><button onClick={() => setOpen(row)} aria-label={t('Details for ', '查看詳細 ') + stamp(row.at, lang)}>
          <time dateTime={row.at}>
            <span>{new Date(row.at).toISOString().slice(0, 10)}</span>
            <span>{new Date(row.at).toISOString().slice(11, 19)}</span>
          </time></button></th>
        {matrixRows.map(([code, en, zh]) => { const c = cell(row, code); return <td key={code}>
          <button onClick={() => setOpen(row)} aria-label={t(en, zh) + ' ' + (c.value || (c.state === 'none' ? t('not taken', '沒量') : t('unusable', '品質不足')))}>
            <span className={'dot ' + c.state}/><small>{c.value}</small></button></td> })}</tr>)}</tbody>
    </table> : <p className="empty-state">{t('No measurements yet.', '尚無量測紀錄。')}</p>}
    <div className="history-pager">
      <button onClick={newer} disabled={screen === 0 && cursors.length === 1}><ChevronLeft size={18}/>{t('Newer', '較新')}</button>
      <span>{t('Tap a row for details', '點一列看詳細')}</span>
      <button onClick={older} disabled={screen >= pages - 1 && !next}>{t('Older', '較舊')}<ChevronRight size={18}/></button>
    </div>
  </section>
}
