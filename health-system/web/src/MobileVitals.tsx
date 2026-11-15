import { metrics, prettyValue, selectReadings, tx, type CrewSummary, type Lang, type Measurement } from './domain'
import { metricIcons } from './Readings'
import { referenceBand } from './Trends'

// Phone home: four vital tiles with an icon, a large colored value and a status pill.
// Blood oxygen is drawn as a ring; heart rate gets a small pulse line.
// Status uses the NEWS2 training reference range (see Trends.tsx), not a clinical threshold.
type State = 'inside' | 'outside' | 'unusable' | 'none'

function stateOf(m: Measurement | null): State {
  if (!m) return 'none'
  if (m.quality !== 'good' || m.value === null || typeof m.value !== 'number') return 'unusable'
  const band = referenceBand[m.metricCode]
  return band && (m.value < band[0] || m.value > band[1]) ? 'outside' : 'inside'
}

export function MobileVitals({ crew, lang }: { crew: CrewSummary; lang: Lang }) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const pills: Record<State, string> = {
    inside: t('Normal', '正常'), outside: t('Check', '超出範圍'), unusable: t('Unusable', '品質不足'), none: t('No data', '尚無資料'),
  }
  return <div className="vital-tiles" data-testid={'vitals-' + crew.crewId}>
    {metrics.map(metric => {
      const records = selectReadings(crew.metricCards, metric, 'latest')
      const main = records[0]
      const state = metric.code === 'blood_pressure' && records[0]
        ? stateOf(records[0]) : stateOf(records.find(r => r !== null) ?? null)
      const value = records.some(r => r) ? records.map(r => prettyValue(r, false, lang)).join('/') : '—'
      const Icon = metricIcons[metric.code]
      const unit = metric.code === 'temperature' ? '°C' : metric.unit
      return <article key={metric.code} className={'vital-tile ' + state} data-testid={'metric-' + metric.code}>
        {metric.code === 'spo2' ? <svg className="vital-ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="27" className="track"/>
          <circle cx="32" cy="32" r="27" className="fill" pathLength="100"
            strokeDasharray={`${state === 'none' || state === 'unusable' ? 0 : Math.max(0, Math.min(100, Number(main?.value ?? 0)))} 100`}/>
          <text x="32" y="39" textAnchor="middle">{value === '—' ? '—' : value + '%'}</text>
        </svg> : <>
          <Icon size={22} aria-hidden="true" className="vital-icon"/>
          <strong className="vital-value">{value}</strong>
          {metric.code === 'heart_rate' && <svg className="vital-pulse" viewBox="0 0 120 20" aria-hidden="true">
            <polyline points="0,12 22,12 28,3 35,18 41,12 62,12 68,3 75,18 81,12 102,12 108,3 115,18 120,12"/></svg>}
        </>}
        <span className="vital-label">{t(metric.en, metric.zh)}{metric.code !== 'spo2' && <small> · {unit}</small>}</span>
        <span className="vital-pill">{pills[state]}</span>
      </article>
    })}
  </div>
}
