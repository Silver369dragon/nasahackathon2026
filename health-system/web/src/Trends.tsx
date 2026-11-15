import { useEffect, useRef, useState } from 'react'
import { api, ApiError, newId, restricted } from './api'
import { ChatSource } from './ChatSource'
import { BaselineControls } from './BaselineControls'
import { analysisStatusText, monitoringMetrics, displayUnit, stamp, tx, type Lang, type MeasurementContext, type PersonalAnalysis, type PersonalBaseline, type Session } from './domain'
import { contextLabels, label } from './labels'
import './trends.css'

type Point = { id: string; observedAt: string; quality: string; value: number | null; segment?: number; analysisId?: string }
type Series = {
  source: string; method: string; origin: string; unit: string; context: MeasurementContext; synthetic: boolean
  count: number; valid: number; points: Point[]; latest: Point
  reference: { count: number; mean: number | null; sd: number | null; z: number | null; ewma: number | null }
  baseline?: PersonalBaseline | null
  analysis?: PersonalAnalysis | null
  candidate?: { from: string; to: string; count: number; mean: number | null; sd: number | null }
}
type Result = { from: string; to: string; referenceFrom: string; referenceTo: string; series: Series[] }
const number = (v: number | null, lang: Lang) => v === null ? '—' : v.toLocaleString(lang, { maximumFractionDigits: 2 })
const metrics = monitoringMetrics.filter(metric => metric.code !== 'work_of_breathing')
const unique = (values: string[]) => [...new Set(values)].sort()

export function TrendChart({ group, start, end, lang, select, metricCode, axisLabels, floor, band, second }: {
  group: Pick<Series, 'points' | 'unit'>; start: string; end: string; lang: Lang; select?: (point: Point) => void; metricCode: string
  axisLabels?: [string, string, string]
  floor?: number
  band?: [number, number]
  second?: Pick<Series, 'points'>
}) {
  const values = group.points.map(p => p.value as number)
  if (!values.length) return <p>{tx(lang, 'No valid readings to plot.', '這段期間沒有可繪圖的有效值。')}</p>
  const all = [...values, ...(second?.points.map(p => p.value as number) ?? [])]
  // Keep the reference band in view only near the data, so a single reading still draws a readable scale.
  const near = band ? band.map(v => Math.min(Math.max(v, Math.min(...all) - 15), Math.max(...all) + 15)) : []
  const min = Math.min(...all, ...near), max = Math.max(...all, ...near)
  const pad = Math.max((max - min) * .12, group.unit === 'Cel' ? .1 : 1)
  const low = Math.max(floor ?? -Infinity, min - pad), high = max + pad
  const first = Date.parse(start), duration = Date.parse(end) - first
  const x = (p: Point) => 52 + 298 * (Date.parse(p.observedAt) - first) / duration
  const y = (p: Point) => 20 + 140 * (high - (p.value as number)) / (high - low)
  const line = (points: Point[]) => points.map((p, i) =>
    (i && p.segment === points[i - 1].segment ? 'L' : 'M') + x(p) + ',' + y(p)).join(' ')
  const path = line(group.points)
  const yValue = (v: number) => 20 + 140 * (high - Math.min(high, Math.max(low, v))) / (high - low)
  return <div className="trend-plot">
    <svg viewBox="0 0 360 180" role="img" aria-label={tx(lang, 'Valid observations over time', '有效量測隨時間的變化')}>
      {band && <rect className="trend-band" x="52" width="298" y={yValue(band[1])} height={Math.max(0, yValue(band[0]) - yValue(band[1]))}/>}
      {[high, (high + low) / 2, low].map((v, i) => <g key={i}>
        <line x1="52" x2="350" y1={20 + 70 * i} y2={20 + 70 * i}/>
        <text x="46" y={24 + 70 * i} textAnchor="end">{band ? v.toFixed(group.unit === 'Cel' ? 1 : 0) : number(v, lang)}</text>
      </g>)}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2"/>
      {second && <path d={line(second.points)} fill="none" stroke="#77543b" strokeWidth="2" strokeDasharray="5 4"/>}
      {second?.points.map(p => <circle key={p.id} className="second" cx={x(p)} cy={y(p)} r="3"/>)}
      {group.points.map(p => <circle key={p.id} cx={x(p)} cy={y(p)} r="3" onClick={() => select?.(p)}>
        <title>{stamp(p.observedAt, lang)} · {p.value} {displayUnit(group.unit, metricCode)}</title>
      </circle>)}
    </svg>
    <div className="trend-axis"><span>{axisLabels?.[0] ?? new Date(start).toLocaleTimeString(lang, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false })}</span><span>{axisLabels?.[1] ?? 'UTC'}</span><span>{axisLabels?.[2] ?? new Date(end).toLocaleTimeString(lang, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false })}</span></div>
  </div>
}

function Group({ group, data, lang, deny, metricCode, session, refresh, ask }: {
  group: Series; data: Result; lang: Lang; deny: () => void; metricCode: string
  session: Session; refresh: () => void; ask: (id: string) => void
}) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const [pointId, setPointId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const command = useRef<{ commandId: string; measurementId: string; referenceTo: string } | null>(null)
  const points = [...group.points].reverse()
  if (!points.some(p => p.id === group.latest.id)) points.unshift(group.latest)
  const point = points.find(p => p.id === pointId) ?? group.latest
  const ref = group.reference
  const fixed = ['heart_rate', 'spo2', 'respiratory_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'temperature'].includes(metricCode)
  const baseline = group.baseline
  const candidate = group.candidate
  const reference = baseline ?? candidate
  const evidenceReference = fixed && !baseline && candidate ? candidate : ref
  const canCreate = candidate && candidate.count >= 30 && (candidate.sd ?? 0) > 1e-9
  async function createBaseline() {
    if (saving || !candidate || !canCreate) return
    if (!command.current) {
      command.current = { commandId: newId(), measurementId: group.latest.id, referenceTo: candidate.to }
    }
    setSaving(true)
    setSaveError(false)
    try {
      await api<PersonalBaseline>('/baselines', { body: command.current, token: session.csrfToken })
      command.current = null
      refresh()
    } catch (error) {
      if (restricted(error)) deny()
      else {
        if (error instanceof ApiError && [409, 422].includes(error.status)) { command.current = null; refresh() }
        setSaveError(true)
      }
    } finally {
      setSaving(false)
    }
  }
  return <article className="trend-series panel">
    <div className="trend-headline"><div><span>{t('Latest reading', '最近量測')}</span><strong>{group.latest.quality === 'good' ? number(group.latest.value, lang) : '—'}<small>{displayUnit(group.unit, metricCode)}</small></strong></div>
      <div className="trend-quality">{group.synthetic && <span className="simulation-label">{t('Simulation', '模擬資料')}</span>}<span>{group.valid} {t('valid samples', '筆有效樣本')}</span></div></div>
    <TrendChart group={group} start={data.from} end={data.to} lang={lang} select={p => setPointId(p.id)} metricCode={metricCode}/>
    <div className="trend-stats">
      <div><small>{fixed ? t('Fixed baseline mean', '固定基準平均') : t('Prior 7-day mean', '前七天參考平均')}</small><strong>{(!fixed || baseline) && ref.count >= 30 ? number(ref.mean, lang) : '—'}</strong></div>
      <div><small>Z-score</small><strong>{number(ref.z, lang)}</strong></div>
      <div><small>EWMA</small><strong>{number(ref.ewma, lang)}</strong></div>
    </div>
    {fixed && <div className="trend-baseline">
      {baseline ? <p data-testid="baseline-version">{group.analysis ? t('Baseline used by this saved analysis','此保存分析使用的基準') : t('Fixed baseline', '固定基準')} · v{baseline.version} · {baseline.count} {t('samples', '筆樣本')}
        <br/>{stamp(baseline.from, lang)} – {stamp(baseline.to, lang)}</p> : <>
        <p>{t('No fixed baseline yet. Review the seven-day sample statistics below before creating one. Use Baseline versions and review to prepare candidates, exclude periods and replace versions.',
          '尚未建立固定基準。請先檢視下方七天樣本統計再建立；也可在「基準版本與審核」準備候選、排除期間與替換版本。')}</p>
        {candidate && <p>{stamp(candidate.from, lang)} – {stamp(candidate.to, lang)} · {candidate.count} {t('comparable samples', '筆同條件樣本')}
          {canCreate ? ` · ${t('Mean', '平均')} ${number(candidate.mean, lang)} · SD ${number(candidate.sd, lang)}` :
            candidate.count < 30 ? t(' · At least 30 are required.', ' · 至少需要 30 筆。') : t(' · Insufficient variation.', ' · 樣本變異不足。')}</p>}
        <button type="button" className="secondary" disabled={saving || !canCreate} onClick={() => void createBaseline()}>
          {saving ? t('Creating…', '建立中…') : t('Create fixed baseline', '建立固定基準')}</button>
        {saveError && <p role="alert">{t('Could not create the baseline. Retry with the same request.', '無法建立基準，請重試相同請求。')}
          {command.current && <> · {t('Reference cutoff', '原請求基準截止')} {stamp(command.current.referenceTo, lang)}</>}</p>}
      </>}
      {group.analysis && <p>{analysisStatusText(group.analysis.status, lang)}</p>}
      {baseline && !group.analysis && <p>{t('This reading has no saved analysis after the baseline cutoff.', '這筆量測沒有基準截止時間之後的已保存分析。')}</p>}
      <p>{t('Training statistics; no clinical risk grade is assigned.', '訓練統計結果，未判定臨床風險等級。')}</p>
      <BaselineControls measurementId={group.latest.id} referenceTo={candidate?.to ?? data.referenceTo}
        analysisId={point.analysisId} lang={lang} session={session} deny={deny} refresh={refresh}/>
    </div>}
    <details className="disclosure trend-evidence" open={pointId ? true : undefined}><summary>{t('Sources & observations', '來源與量測資料')}</summary>
    <h2>{[label(group.source, lang), label(group.method, lang), ...contextLabels(group.context, lang)].join(' · ')}</h2>
    <p>{t('Reference period', '比較期間')} {stamp(reference?.from ?? data.referenceFrom, lang)} – {stamp(reference?.to ?? data.referenceTo, lang)} · {evidenceReference.count} {t('comparable valid samples', '筆同條件有效樣本')}
      {evidenceReference.count < 30 ? t(' (30 required).', '（至少需 30 筆）。') :
        (evidenceReference.sd ?? 0) <= 1e-9 ? t(' · No measurable variation.', ' · 樣本變異不足。') :
        ' · SD ' + number(evidenceReference.sd, lang)}
    </p>
    <label className="trend-record">{t('Select observation', '選擇量測點')}
      <select aria-label={t('Select observation', '選擇量測點')} value={point.id} onChange={e => setPointId(e.target.value)}>{points.map(p =>
        <option key={p.id} value={p.id}>{stamp(p.observedAt, lang)} · {number(p.value, lang)} {displayUnit(group.unit, metricCode)} · {label(p.quality, lang)}</option>)}</select>
    </label>
    <ChatSource key={point.id} citation={{ kind: 'measurement', id: point.id, title: stamp(point.observedAt, lang) }} lang={lang} deny={deny}/>
    {point.analysisId && <>
      <ChatSource key={point.analysisId} citation={{ kind: 'analysis', id: point.analysisId, title: stamp(point.observedAt, lang) }} lang={lang} deny={deny}/>
      <button type="button" className="secondary" onClick={() => ask(point.analysisId!)}>{t('Ask about this analysis', '詢問助手這筆分析')}</button>
    </>}
    </details>
  </article>
}

const periods = ['1h', '24h', '7d', '30d', 'custom'] as const
type Period = typeof periods[number]

function useTrendData(query: string | null, period: Period, revision: string | undefined, deny: () => void, retry: number) {
  const [result, setResult] = useState<{ query: string; data: Result } | null>(null)
  const [error, setError] = useState(false)
  const lastRevision = useRef(revision)
  const fetchedRevision = useRef(revision)
  useEffect(() => { lastRevision.current = revision }, [revision])
  useEffect(() => {
    if (!query) return
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
        setResult({ query: query!, data })
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
  }, [query, period, retry, deny])
  return { data: query && result?.query === query ? result.data : null, error }
}

// Phone layout: one button per vital. Blood pressure draws systolic and diastolic together.
const phoneMetrics: [string, string, string, string | null][] = [
  ['heart_rate', 'Heart rate', '心率', null], ['spo2', 'Oxygen', '血氧', null],
  ['blood_pressure_systolic', 'Blood pressure', '血壓', 'blood_pressure_diastolic'],
  ['temperature', 'Temp', '體溫', null], ['respiratory_rate', 'Breathing', '呼吸', null],
]
// Training reference: the NEWS2 (RCP 2017) zero-score range for each vital. Not a mission medical threshold.
export const referenceBand: Record<string, [number, number]> = {
  heart_rate: [51, 90], spo2: [96, 100], blood_pressure_systolic: [111, 219], temperature: [36.1, 38], respiratory_rate: [12, 20],
}
export function Trends({ lang, deny, revision, session, ask, simple = false }: {
  lang: Lang; deny: () => void; revision?: string; simple?: boolean
  session: Session; ask: (id: string) => void
}) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const [detailed, setDetailed] = useState(false)
  const [metric, setMetric] = useState('heart_rate')
  const [period, setPeriod] = useState<Period>('24h')
  const [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [source, setSource] = useState(''), [method, setMethod] = useState('')
  const [retry, setRetry] = useState(0)
  const params = new URLSearchParams({ metricCode: metric, period })
  const valid = period !== 'custom' || (!!start && !!end && start < end)
  if (period === 'custom' && valid) {
    params.set('from', new Date(start + 'Z').toISOString())
    params.set('to', new Date(end + 'Z').toISOString())
  }
  const query = params.toString()
  const pair = simple ? phoneMetrics.find(m => m[0] === metric)?.[3] ?? null : null
  const pairParams = new URLSearchParams(params)
  if (pair) pairParams.set('metricCode', pair)
  const { data, error } = useTrendData(valid ? query : null, period, revision, deny, retry)
  const pairData = useTrendData(valid && pair ? pairParams.toString() : null, period, revision, deny, retry).data
  const [sourceKey, setSourceKey] = useState('')
  const groups = data?.series ?? []
  const filtered = groups.filter(g => (!source || source === g.source) && (!method || method === g.method))
  const methods = unique(groups.filter(g => !source || source === g.source).map(g => g.method))
  if (simple && !detailed) return <PhoneTrends {...{ lang, deny, metric, period, data, pairData, error, valid, start, end, sourceKey }}
    setMetric={(m: string) => { setMetric(m); setSourceKey('') }} setPeriod={setPeriod} setStart={setStart} setEnd={setEnd}
    setSourceKey={setSourceKey} retry={() => setRetry(n => n + 1)} details={() => setDetailed(true)} />
  return <section className="trends">
    {simple && <button type="button" className="secondary" onClick={() => setDetailed(false)}>{t('Back to trend summary', '返回趨勢摘要')}</button>}
    <div className="trend-controls panel">
      <div className="trend-periods" aria-label={t('Time range', '時間範圍')}>{periods.map((p, i) =>
        <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
          {lang === 'en' ? ['1 hour','24 hours','7 days','30 days','Custom'][i] : ['1 小時','24 小時','7 天','30 天','自訂'][i]}</button>)}</div>
      {period === 'custom' && <details className="trend-custom" open><summary>{t('Custom dates', '自訂日期')}</summary><div className="trend-fields">
        <label>{t('From (UTC)', '開始（UTC）')}<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}/></label>
        <label>{t('To (UTC)', '結束（UTC）')}<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)}/></label>
      </div></details>}
      <div className="trend-fields">
        <label>{t('Metric', '指標')}<select aria-label={t('Metric', '指標')} value={metric} onChange={e => { setMetric(e.target.value); setSource(''); setMethod('') }}>
          {metrics.flatMap(m => m.fields.map(field => <option key={field} value={field}>{t(m.en, m.zh)}
            {field.includes('systolic') ? t(' · Systolic',' · 收縮壓') : field.includes('diastolic') ? t(' · Diastolic',' · 舒張壓') : ''}</option>))}
        </select></label>
        <details className="trend-filters"><summary>{t('Filters', '篩選')}</summary><div className="trend-fields"><label>{t('Source', '來源')}<select aria-label={t('Source', '來源')} value={source} onChange={e => { setSource(e.target.value); setMethod('') }}>
          <option value="">{t('All sources','全部來源')}</option>{unique([...groups.map(g => g.source), ...(source ? [source] : [])]).map(v => <option key={v} value={v}>{label(v,lang)}</option>)}
        </select></label>
        <label>{t('Method', '量測方法')}<select aria-label={t('Method', '量測方法')} value={method} onChange={e => setMethod(e.target.value)}>
          <option value="">{t('All methods','全部方法')}</option>{unique([...methods, ...(method ? [method] : [])]).map(v => <option key={v} value={v}>{label(v,lang)}</option>)}
        </select></label>
        </div></details>
      </div>
    </div>
    {!valid ? <p className="panel empty-state">{t('Select a start and a later end time in UTC.', '請選擇開始與結束時間（UTC），結束須晚於開始。')}</p> :
      error ? <p className="panel empty-state" role="alert">{t('Could not update trends.', '無法更新趨勢。')} <button onClick={() => setRetry(n => n + 1)}>{t('Retry','重試')}</button></p> :
      !data ? <p className="panel empty-state">{t('Loading trends…','正在讀取趨勢…')}</p> :
      !filtered.length ? <p className="panel empty-state">{t('No matching readings in this period.','這段期間沒有符合條件的量測。')}</p> :
      filtered.map(g => <Group key={JSON.stringify([metric,g.source,g.method,g.origin,g.synthetic,g.context])} group={g} data={data} lang={lang} deny={deny} metricCode={metric}
        session={session} refresh={() => setRetry(n => n + 1)} ask={ask}/>)}
  </section>
}

const seriesKey = (g: Series) => JSON.stringify([g.source, g.method, g.origin, g.synthetic, g.context])

function PhoneTrends({ lang, deny, metric, period, data, pairData, error, valid, start, end, sourceKey,
  setMetric, setPeriod, setStart, setEnd, setSourceKey, retry, details }: {
  lang: Lang; deny: () => void; metric: string; period: Period; data: Result | null; pairData: Result | null
  error: boolean; valid: boolean; start: string; end: string; sourceKey: string
  setMetric: (m: string) => void; setPeriod: (p: Period) => void; setStart: (v: string) => void; setEnd: (v: string) => void
  setSourceKey: (k: string) => void; retry: () => void; details: () => void
}) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const groups = data?.series ?? []
  const group = groups.find(g => seriesKey(g) === sourceKey) ?? groups[0]
  const second = group && pairData?.series.find(g => seriesKey(g) === seriesKey(group))
  const unit = group ? displayUnit(group.unit, metric) : ''
  const band = referenceBand[metric]
  const ref = group?.reference
  const latest = group?.latest.quality === 'good' ? group.latest.value : null
  const diff = latest !== null && ref && ref.count >= 30 && ref.mean !== null ? latest - ref.mean : null
  const sourceName = (g: Series) => [label(g.source, lang), ...contextLabels(g.context, lang)].join(' · ')
  return <section className="trends phone-trends">
    <button type="button" className="secondary" onClick={details}>{t('Baseline & detailed analysis', '個人基準與詳細分析')}</button>
    <div className="phone-trend-metrics" role="tablist" aria-label={t('Metric', '指標')}>
      {phoneMetrics.map(([code, en, zh]) => <button key={code} role="tab" aria-selected={metric === code}
        className={metric === code ? 'selected' : ''} onClick={() => setMetric(code)}>{t(en, zh)}</button>)}
    </div>
    <div className="trend-periods" aria-label={t('Time range', '時間範圍')}>{periods.map((p, i) =>
      <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
        {lang === 'en' ? ['1h','24h','7d','30d','Custom'][i] : ['1 小時','24 小時','7 天','30 天','自訂'][i]}</button>)}</div>
    {period === 'custom' && <div className="trend-fields">
      <label>{t('From (UTC)', '開始（UTC）')}<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}/></label>
      <label>{t('To (UTC)', '結束（UTC）')}<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)}/></label>
    </div>}
    {groups.length > 1 && <div className="phone-trend-sources" aria-label={t('Source', '來源')}>{groups.map(g =>
      <button key={seriesKey(g)} aria-pressed={g === group} onClick={() => setSourceKey(seriesKey(g))}>{sourceName(g)}</button>)}</div>}
    {!valid ? <p className="panel empty-state">{t('Select a start and a later end time in UTC.', '請選擇開始與結束時間（UTC），結束須晚於開始。')}</p> :
      error ? <p className="panel empty-state" role="alert">{t('Could not update trends.', '無法更新趨勢。')} <button onClick={retry}>{t('Retry','重試')}</button></p> :
      !data ? <p className="panel empty-state">{t('Loading trends…','正在讀取趨勢…')}</p> :
      !group ? <p className="panel empty-state">{t('No readings in this period.','這段期間沒有量測。')}</p> :
      <article className="trend-series panel">
        <div className="trend-headline"><div><span>{t('Latest reading', '最近量測')}</span>
          <strong>{latest === null ? '—' : number(latest, lang)}{second && <>/{second.latest.quality === 'good' ? number(second.latest.value, lang) : '—'}</>}<small>{unit}</small></strong></div>
          {group.synthetic && <span className="simulation-label">{t('Simulation', '模擬資料')}</span>}</div>
        <TrendChart group={group} second={second} band={band} start={data.from} end={data.to} lang={lang} metricCode={metric}/>
        <p className="phone-trend-legend">{band && <><span className="swatch"/>{t('NEWS2 reference range · training', 'NEWS2 參考範圍 · 訓練用')}</>}
          {second && <><span className="swatch dashed"/>{t('Diastolic', '舒張壓')}</>}</p>
        <p className="phone-trend-compare">{diff === null
          ? t('A matching fixed baseline and usable reading are required for comparison.', '需要相符的固定基準與可用量測，才能比較。')
          : Math.abs(diff) < 0.05 ? t('Same as the fixed baseline mean.', '跟固定基準平均一樣。')
          : t(`${diff > 0 ? 'Higher' : 'Lower'} than the fixed baseline mean by ${number(Math.abs(diff), lang)} ${unit}.`,
            `比固定基準平均${diff > 0 ? '高' : '低'} ${number(Math.abs(diff), lang)} ${unit}。`)}</p>
        <details className="disclosure trend-evidence"><summary>{t('Statistics & sources', '統計與來源')}</summary>
          <div className="trend-stats">
            <div><small>{t('Fixed baseline mean', '固定基準平均')}</small><strong>{ref && ref.count >= 30 ? number(ref.mean, lang) : '—'}</strong></div>
            <div><small>Z-score</small><strong>{number(ref?.z ?? null, lang)}</strong></div>
            <div><small>EWMA</small><strong>{number(ref?.ewma ?? null, lang)}</strong></div>
          </div>
          <p>{sourceName(group)} · {group.valid} {t('valid samples', '筆有效樣本')}</p>
          <ChatSource key={group.latest.id} citation={{ kind: 'measurement', id: group.latest.id, title: stamp(group.latest.observedAt, lang) }} lang={lang} deny={deny}/>
        </details>
      </article>}
  </section>
}
