import { UserRound } from 'lucide-react'
import { tx, type CrewSummary, type Lang } from './domain'
import { referenceBand } from './Trends'

// Display board: one line per crew member (name, short reason, status pill) so the person who
// needs attention stands out without reading every number. Status uses the NEWS2 training
// reference range (see Trends.tsx); it is a prompt to look closer, not a clinical judgement.
type Status = 'normal' | 'attention' | 'unknown'
const watched: [string, [string, string], [string, string]][] = [
  ['spo2', ['Low blood oxygen', '血氧偏低'], ['High blood oxygen', '血氧偏高']],
  ['heart_rate', ['Slow heart rate', '心率偏慢'], ['Fast heart rate', '心率偏快']],
  ['blood_pressure_systolic', ['Low blood pressure', '血壓偏低'], ['High blood pressure', '血壓偏高']],
  ['temperature', ['Low temperature', '體溫偏低'], ['High temperature', '體溫偏高']],
  ['respiratory_rate', ['Slow breathing', '呼吸偏慢'], ['Fast breathing', '呼吸偏快']],
]

export function crewStatus(crew: CrewSummary, lang: Lang): { status: Status; reason: string } {
  const t = (pair: [string, string]) => tx(lang, pair[0], pair[1])
  const notes: string[] = []
  let missing = 0, unclear = 0
  for (const [code, low, high] of watched) {
    const card = crew.metricCards.find(card => card.metricCode === code)
    const record = card?.latest
    if (!record) { missing++; continue }
    if (record.quality !== 'good' || typeof record.value !== 'number') { unclear++; continue }
    const band = referenceBand[code]
    if (record.value < band[0]) notes.push(t(low))
    else if (record.value > band[1]) notes.push(t(high))
    else if (card.freshness === 'stale') unclear++
  }
  // Only call someone stable when every watched indicator has a current, usable, in-range reading.
  if (notes.length) return { status: 'attention', reason: notes.join(tx(lang, ', ', '、')) }
  if (missing === watched.length) return { status: 'unknown', reason: tx(lang, 'No readings yet', '尚無量測') }
  if (missing || unclear) return { status: 'unknown', reason: tx(lang,
    `${missing + unclear} of ${watched.length} readings missing or need checking`, `${watched.length} 項中有 ${missing + unclear} 項缺少或需確認`) }
  return { status: 'normal', reason: tx(lang, 'All indicators stable', '所有數值穩定') }
}

export function CrewStatusBoard({ rows, lang }: { rows: CrewSummary[]; lang: Lang }) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const statuses = rows.map(crew => ({ crew, ...crewStatus(crew, lang) }))
  const attention = statuses.filter(s => s.status === 'attention').length
  const unknown = statuses.filter(s => s.status === 'unknown').length
  // Never say "all clear" unless every crew member actually has a normal status.
  const summary: Status = attention ? 'attention' : unknown ? 'unknown' : 'normal'
  const pill: Record<Status, string> = { normal: t('Normal', '正常'), attention: t('Check', '需注意'), unknown: t('No data', '無資料') }
  return <section className="panel crew-status-board" aria-label={t('Crew health status', '船員健康狀態')}>
    <header>
      <h2>{t('Crew health status', '船員健康狀態')}</h2>
      <span className={'crew-status-pill ' + summary}>
        {attention ? t(`${attention} ${attention === 1 ? 'needs' : 'need'} attention`, `${attention} 位需注意`)
          : !rows.length || unknown === rows.length ? t('No data', '無資料')
          : unknown ? t(`${unknown} without full data`, `${unknown} 位資料不完整`) : t('All clear', '全員正常')}</span>
    </header>
    <ul>{statuses.map(({ crew, status, reason }) => <li key={crew.crewId} className={status} data-testid={'crew-' + crew.crewId}>
      <span className="crew-status-avatar"><UserRound size={24} aria-hidden="true"/></span>
      <div><strong>{crew.name}</strong><span>{reason}</span></div>
      <span className={'crew-status-pill ' + status}>{pill[status]}</span>
    </li>)}</ul>
    <p className="crew-status-note">{t('Status uses the NEWS2 reference range · training data', '狀態依 NEWS2 參考範圍判斷 · 訓練資料')}</p>
  </section>
}
