import { useEffect, useRef, useState } from 'react'
import { api, restricted } from './api'
import { ChatSource } from './ChatSource'
import { metrics, stamp, tx, type Lang } from './domain'
import { label } from './labels'
import './trends.css'

type Point = { id: string; observedAt: string; quality: string; value: number | null; segment?: number }
type Series = {
  source: string; method: string; origin: string; unit: string; context: Record<string, string>; synthetic: boolean
  count: number; valid: number; points: Point[]; latest: Point
  reference: { count: number; mean: number | null; sd: number | null; z: number | null; ewma: number | null }
}
type Result = { from: string; to: string; referenceFrom: string; referenceTo: string; series: Series[] }
const number = (v: number | null, lang: Lang) => v === null ? '—' : v.toLocaleString(lang, { maximumFractionDigits: 2 })
const unitOf = (unit: string) => unit === 'Cel' ? '°C' : unit
const unique = (values: string[]) => [...new Set(values)].sort()

function TrendChart({ group, start, end, lang, select }: {
  group: Series; start: string; end: string; lang: Lang; select: (point: Point) => void
}) {
  const values = group.points.map(p => p.value as number)
  if (!values.length) return <p>{tx(lang, 'No valid readings to plot.', '這段期間沒有可繪圖的有效值。')}</p>
  const min = Math.min(...values), max = Math.max(...values)
  const pad = Math.max((max - min) * .12, group.unit === 'Cel' ? .1 : 1)
  const low = min - pad, high = max + pad
  const first = Date.parse(start), duration = Date.parse(end) - first
  const x = (p: Point) => 49 + 565 * (Date.parse(p.observedAt) - first) / duration
  const y = (p: Point) => 20 + 112 * (high - (p.value as number)) / (high - low)
  const path = group.points.map((p, i, points) =>
    (i && p.segment === points[i - 1].segment ? 'L' : 'M') + x(p) + ',' + y(p)).join(' ')
  return <div className="trend-plot">
    <svg viewBox="0 0 632 152" role="img" aria-label={tx(lang, 'Valid observations over time', '有效量測隨時間的變化')}>
      {[high, (high + low) / 2, low].map((v, i) => <g key={i}>
        <line x1="49" x2="615" y1={20 + 56 * i} y2={20 + 56 * i}/>
        <text x="44" y={24 + 56 * i} textAnchor="end">{number(v, lang)}</text>
      </g>)}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2"/>
      {group.points.map(p => <circle key={p.id} cx={x(p)} cy={y(p)} r="3" onClick={() => select(p)}>
        <title>{stamp(p.observedAt, lang)} · {p.value} {unitOf(group.unit)}</title>
      </circle>)}
    </svg>
    <div className="trend-axis"><span>{stamp(start, lang)}</span><span>{stamp(end, lang)}</span></div>
  </div>
}

function Group({ group, data, lang, deny }: { group: Series; data: Result; lang: Lang; deny: () => void }) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const [pointId, setPointId] = useState('')
  const points = [...group.points].reverse()
  if (!points.some(p => p.id === group.latest.id)) points.unshift(group.latest)
  const point = points.find(p => p.id === pointId) ?? group.latest
  const ref = group.reference
  return <article className="trend-series panel">
    <h2>{[label(group.source, lang), label(group.method, lang), ...Object.values(group.context).map(s => label(s, lang))].join(' · ')}</h2>
    <p>{group.synthetic && t('Synthetic · ', '合成資料 · ')}{group.valid} / {group.count} {t('valid samples', '筆有效樣本')}</p>
    <TrendChart group={group} start={data.from} end={data.to} lang={lang} select={p => setPointId(p.id)}/>
    <div className="trend-stats">
      <div><small>{t('Latest reading', '最近一筆')}</small><strong>{group.latest.quality === 'good' ? number(group.latest.value, lang) : '—'} <small>{unitOf(group.unit)}</small></strong></div>
      <div><small>{t('Prior 7-day mean', '前七天參考平均')}</small><strong>{ref.count >= 30 ? number(ref.mean, lang) : '—'}</strong></div>
      <div><small>Z-score</small><strong>{number(ref.z, lang)}</strong></div>
      <div><small>EWMA</small><strong>{number(ref.ewma, lang)}</strong></div>
    </div>
    <p>{t('Reference period', '比較期間')} {stamp(data.referenceFrom, lang)} – {stamp(data.referenceTo, lang)} · {ref.count} {t('comparable valid samples', '筆同條件有效樣本')}
      {ref.count < 30 ? t(' (30 required).', '（至少需 30 筆）。') :
        (ref.sd ?? 0) <= 1e-9 ? t(' · No measurable variation.', ' · 樣本變異不足。') :
        ' · SD ' + number(ref.sd, lang)}
    </p>
    <label className="trend-record">{t('Select observation', '選擇量測點')}
      <select aria-label={t('Select observation', '選擇量測點')} value={point.id} onChange={e => setPointId(e.target.value)}>{points.map(p =>
        <option key={p.id} value={p.id}>{stamp(p.observedAt, lang)} · {number(p.value, lang)} {unitOf(group.unit)} · {label(p.quality, lang)}</option>)}</select>
    </label>
    <ChatSource key={point.id} citation={{ kind: 'measurement', id: point.id, title: stamp(point.observedAt, lang) }} lang={lang} deny={deny}/>
  </article>
}

const periods = ['1h', '24h', '7d', '30d', 'custom'] as const
type Period = typeof periods[number]
export function Trends({ lang, deny, revision }: { lang: Lang; deny: () => void; revision?: string }) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const [metric, setMetric] = useState('heart_rate')
  const [period, setPeriod] = useState<Period>('24h')
  const [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [source, setSource] = useState(''), [method, setMethod] = useState('')
  const [result, setResult] = useState<{ query: string; data: Result } | null>(null)
  const [error, setError] = useState(false), [retry, setRetry] = useState(0)
  const params = new URLSearchParams({ metricCode: metric, period })
  const valid = period !== 'custom' || (!!start && !!end && start < end)
  if (period === 'custom' && valid) {
    params.set('from', new Date(start + 'Z').toISOString())
    params.set('to', new Date(end + 'Z').toISOString())
  }
  const query = params.toString()
  const lastRevision = useRef(revision)
  const fetchedRevision = useRef(revision)
  useEffect(() => { lastRevision.current = revision }, [revision])
  useEffect(() => {
    if (!valid) return
    const controller = new AbortController()
    let pending = false
    let refreshed = 0
    async function load() {
      if (pending) return
      pending = true
      const current = lastRevision.current
      try {
        const data = await api<Result>('/trends?' + query, { signal: controller.signal })
        if (controller.signal.aborted) return
        setResult({ query, data })
        setError(false)
        fetchedRevision.current = current
        refreshed = Date.now()
      } catch (e) {
        if (controller.signal.aborted) return
        if (restricted(e)) deny()
        else setError(true)
      } finally { pending = false }
    }
    setError(false)
    void load()
    const timer = setInterval(() => {
      if (lastRevision.current !== fetchedRevision.current || (period !== 'custom' && Date.now() - refreshed >= 60000)) void load()
    }, 1500)
    return () => { clearInterval(timer); controller.abort() }
  }, [query, valid, period, retry, deny])
  const data = valid && result?.query === query ? result.data : null
  const groups = data?.series ?? []
  const filtered = groups.filter(g => (!source || source === g.source) && (!method || method === g.method))
  const methods = unique(groups.filter(g => !source || source === g.source).map(g => g.method))
  return <section className="trends">
    <div className="trend-controls panel">
      <div className="trend-periods" aria-label={t('Time range', '時間範圍')}>{periods.map((p, i) =>
        <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
          {lang === 'en' ? ['1 hour','24 hours','7 days','30 days','Custom'][i] : ['1 小時','24 小時','7 天','30 天','自訂'][i]}</button>)}</div>
      {period === 'custom' && <div className="trend-fields">
        <label>{t('From (UTC)', '開始（UTC）')}<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}/></label>
        <label>{t('To (UTC)', '結束（UTC）')}<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)}/></label>
      </div>}
      <div className="trend-fields">
        <label>{t('Metric', '指標')}<select aria-label={t('Metric', '指標')} value={metric} onChange={e => { setMetric(e.target.value); setSource(''); setMethod('') }}>
          {metrics.flatMap(m => m.fields.map(field => <option key={field} value={field}>{t(m.en, m.zh)}
            {field.includes('systolic') ? t(' · Systolic',' · 收縮壓') : field.includes('diastolic') ? t(' · Diastolic',' · 舒張壓') : ''}</option>))}
        </select></label>
        <label>{t('Source', '來源')}<select aria-label={t('Source', '來源')} value={source} onChange={e => { setSource(e.target.value); setMethod('') }}>
          <option value="">{t('All sources','全部來源')}</option>{unique([...groups.map(g => g.source), ...(source ? [source] : [])]).map(v => <option key={v} value={v}>{label(v,lang)}</option>)}
        </select></label>
        <label>{t('Method', '量測方法')}<select aria-label={t('Method', '量測方法')} value={method} onChange={e => setMethod(e.target.value)}>
          <option value="">{t('All methods','全部方法')}</option>{unique([...methods, ...(method ? [method] : [])]).map(v => <option key={v} value={v}>{label(v,lang)}</option>)}
        </select></label>
      </div>
    </div>
    {!valid ? <p className="panel empty-state">{t('Select a start and a later end time in UTC.', '請選擇開始與結束時間（UTC），結束須晚於開始。')}</p> :
      error ? <p className="panel empty-state" role="alert">{t('Could not update trends.', '無法更新趨勢。')} <button onClick={() => setRetry(n => n + 1)}>{t('Retry','重試')}</button></p> :
      !data ? <p className="panel empty-state">{t('Loading trends…','正在讀取趨勢…')}</p> :
      !filtered.length ? <p className="panel empty-state">{t('No matching readings in this period.','這段期間沒有符合條件的量測。')}</p> :
      filtered.map(g => <Group key={JSON.stringify([metric,g.source,g.method,g.origin,g.synthetic,g.context])} group={g} data={data} lang={lang} deny={deny}/>)}
  </section>
}
