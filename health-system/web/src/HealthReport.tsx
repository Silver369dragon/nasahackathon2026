import { useEffect, useRef, useState } from 'react'
import { api, ApiError, newId, restricted } from './api'
import { analysisStatusText, displayUnit, stamp, tx, type Lang, type Measurement, type PersonalAnalysis, type Session } from './domain'
import { contextLabels, label } from './labels'
import { assessmentText, interpretationFor, interpretationNote, nameOf, riskBandText, type Assessment, type Field } from './news2'

export type ReportSummary = {
  id: string; crewId: string; version: number; createdAt: string
  assessmentId: string | null; assessmentVersion: number | null; news2Score: number | null
  news2Status: string; statisticsAvailable: number; statisticsTotal: number; activeAlertCount: number
  knowledgeVersions: {documentId: string; version: number}[]; limitCodes: string[]
}
export type HealthReport = {
  id: string; crewId: string; version: number; createdAt: string; templateVersion: string; mode: string
  news2: Assessment | null; measurements: Measurement[]; summary: ReportSummary
  statistics: { metricCode: string; measurementId: string | null; analysis: PersonalAnalysis | null
    status: string; reason: string; observedAt?: string | null; quality?: string | null; source?: string | null; ageSeconds?: number | null }[]
  ruleEvaluations: {id: string; ruleId: string; ruleVersion: number; status: string; reason: string}[]
  alerts: {id: string; ruleId: string; version: number; conditionState: string; severity: string; reason: string}[]
  knowledge: {documentId: string; version: number; chunkId: string; section: Record<Lang,string>; text: Record<Lang,string>}[]
  limits: {code: string; metricCode?: string; text: Record<Lang,string>}[]
}
const statName = (code: string, lang: Lang) => code === 'blood_pressure_diastolic' ? tx(lang,'Diastolic pressure','舒張壓') : nameOf(code as Field,lang)
const number = (value: number | null | undefined) => value == null ? '—' : Number(value.toPrecision(6)).toString()

export function HealthReportView({ report, lang }: { report: HealthReport; lang: Lang }) {
  const t = (en: string, zh: string) => tx(lang,en,zh)
  const interpretation = report.news2 ? interpretationFor(report.news2) : null
  return <div className="health-report" data-testid="health-report" data-id={report.id}>
    <h3>{t('Saved three-layer report','已保存三層評估')}</h3>
    <p>{stamp(report.createdAt,lang)} · {t('Training only','僅供訓練')} · {report.templateVersion}</p>
    <h4>{t('Rules and NEWS2','規則與 NEWS2')}</h4>
    {report.news2 ? <p><strong>{assessmentText(report.news2,lang)}</strong><br/>
      {riskBandText(interpretation!.riskBand,lang)}<br/>
      {interpretationNote(report.news2,lang) && <>{interpretationNote(report.news2,lang)}<br/></>}
      {t('Assessment version','評估版本')} {report.news2.version} · {report.news2.ruleSetVersion ?? '—'}<br/>
      {report.news2.validCount}/8 {t('usable inputs','項可用')}</p> : <p>{t('No saved NEWS2 assessment.','尚無保存的 NEWS2 評估。')}</p>}
    {interpretation && interpretation.singleHighParameters.length>0 && <p>{t('Single score of 3: ','單項 3 分：')}
      {interpretation.singleHighParameters.map(code=>nameOf(code,lang)).join('、')}</p>}
    {report.news2?.scoringSource && <p><a href={report.news2.scoringSource} target="_blank" rel="noreferrer">RCP · Chart 1</a>{' · '}
      {report.news2.interpretationSource && <a href={report.news2.interpretationSource} target="_blank" rel="noreferrer">Chart 2</a>}</p>}
    <p>{report.summary.activeAlertCount} {t('active training alerts at capture','筆保存當時有效的訓練警示')}</p>
    {report.alerts.map(a => <p key={a.id}>{a.ruleId} · v{a.version} · {label(a.conditionState,lang)} · {a.reason}</p>)}
    {report.ruleEvaluations.length > 0 && <details><summary>{t('Saved rule evaluations','已保存規則判定')}</summary>
      <ul>{report.ruleEvaluations.map(r => <li key={r.id}>{r.ruleId} · v{r.ruleVersion} · {label(r.status,lang)} · {r.reason}</li>)}</ul></details>}
    <h4>{t('Personal baseline evidence','個人基準證據')}</h4>
    <p>{report.summary.statisticsAvailable}/{report.summary.statisticsTotal} {t('usable saved analyses','項可用的已保存分析')}</p>
    <ul className="report-statistics">{report.statistics.map(s => {
      const measurement=report.measurements.find(m=>m.id===s.measurementId)
      return <li key={s.metricCode}>
      <strong>{statName(s.metricCode,lang)}</strong>
      {s.measurementId && <>
        <span>{s.observedAt ? stamp(s.observedAt,lang) : '—'} · {label(s.quality ?? 'unknown',lang)} · {label(s.source ?? 'unknown',lang)}</span>
        {measurement && <span>{number(typeof measurement.value==='number' ? measurement.value : null)} {displayUnit(measurement.unit,s.metricCode)} · {label(measurement.method,lang)}
          {' · '}{contextLabels(measurement.context,lang).join(' · ')}</span>}
        {s.ageSeconds!=null && <small>{t('Age at capture','保存時資料年齡')} {number(s.ageSeconds)} s</small>}
        <small>{t('Measurement ID','量測編號')} {s.measurementId}</small>
      </>}
      {s.analysis ? <><span>{analysisStatusText(s.analysis.status,lang)} · {stamp(s.analysis.observedAt,lang)}</span>
        <span>{number(s.analysis.value)} {displayUnit(s.analysis.unit,s.metricCode)} · Z={number(s.analysis.z)} · EWMA={number(s.analysis.ewma)}</span>
        <span>{t('Baseline','基準')} v{s.analysis.baselineVersion} · {s.analysis.baselineId}</span>
        <small>{t('Analysis ID','分析編號')} {s.analysis.id}</small>
        {s.analysis.baseline && <small>{label(s.analysis.baseline.source,lang)} · {contextLabels(s.analysis.baseline.context,lang).join(' · ')}
          {' · '}n={s.analysis.baseline.count} · {t('Mean','平均')} {number(s.analysis.baseline.mean)} · SD={number(s.analysis.baseline.sd)}</small>}</>
        : <span>{t('No matching saved analysis; a different reading is not substituted.','沒有相符的已保存分析；不以其他量測代替。')}</span>}
    </li>})}</ul>
    <h4>{t('Evidence limits','資料限制')}</h4>
    <ul>{report.limits.map((limit,i) => <li key={limit.code+i}>{limit.text[lang]}</li>)}</ul>
    <p>{t('The layers retain their own meaning. Statistical deviation is not a diagnosis; there is no combined health score.',
      '各層保留原本意義。統計偏離不等於診斷，本報告不合成另一個健康分數。')}</p>
    <details><summary>{t('Pinned knowledge sources','固定版本的知識來源')} ({report.knowledge.length})</summary>
      {report.knowledge.map(k => <article key={k.documentId+k.chunkId}><strong>{k.section[lang]} · v{k.version}</strong><p>{k.text[lang]}</p></article>)}
    </details>
  </div>
}

export function HealthReportPanel({ assessment, lang, session, deny, ask }: {
  assessment: Assessment | null; lang: Lang; session: Session; deny: () => void; ask: (id: string) => void
}) {
  const t = (en: string, zh: string) => tx(lang,en,zh)
  const [history,setHistory] = useState<ReportSummary[]>([])
  const [selected,setSelected] = useState('')
  const [report,setReport] = useState<HealthReport | null>(null)
  const [error,setError] = useState(false)
  const [saveError,setSaveError] = useState(false)
  const [saving,setSaving] = useState(false)
  const [retry,setRetry] = useState(0)
  const command = useRef<{signature:string; id:string} | null>(null)
  const flight = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    void api<{items:ReportSummary[]}>('/health-reports',{signal:controller.signal}).then(data => {
      if (controller.signal.aborted) return
      setHistory(data.items); setError(false)
      setSelected(id => id || data.items[0]?.id || '')
    }).catch(e => { if (!controller.signal.aborted) { if (restricted(e)) deny(); else setError(true) } })
    return () => controller.abort()
  },[deny,retry,session.username])
  useEffect(() => {
    const controller = new AbortController()
    if (!selected) return () => controller.abort()
    void api<HealthReport>('/health-reports/'+encodeURIComponent(selected),{signal:controller.signal}).then(data => {
      if (!controller.signal.aborted) { setReport(data); setError(false) }
    }).catch(e => { if (!controller.signal.aborted) { if (restricted(e)) deny(); else setError(true) } })
    return () => controller.abort()
  },[selected,deny,retry])
  async function save() {
    if (flight.current) return
    const body = assessment ? {assessmentId:assessment.id,assessmentVersion:assessment.version} : {}
    const signature = JSON.stringify(body)
    if (command.current?.signature !== signature) command.current = {signature,id:newId()}
    flight.current = true; setSaving(true); setError(false); setSaveError(false)
    try {
      const data = await api<HealthReport>('/health-reports',{body:{...body,commandId:command.current.id},token:session.csrfToken})
      setReport(data); setSelected(data.id); setRetry(n=>n+1); command.current = null
    } catch(e) {
      if (restricted(e)) deny()
      else { setSaveError(true); if (e instanceof ApiError && e.status === 409) command.current = null }
    } finally { setSaving(false); flight.current = false }
  }
  return <section className="panel health-report-panel">
    <h2>{t('Three-layer evidence','三層評估證據')}</h2>
    <p>{t('Save the assessment, matching statistics and rule evidence together. Older reports remain unchanged.',
      '一起保存本次評估、相符統計與規則證據。先前報告保持不變。')}</p>
    <button className="secondary" disabled={saving} onClick={() => void save()}>{t('Save three-layer report','保存三層評估')}</button>
    {history.length > 0 && <label>{t('Saved reports','已保存報告')}<select value={selected} onChange={e=>{setReport(null);setSelected(e.target.value)}}>
      {history.map(r => <option key={r.id} value={r.id}>{stamp(r.createdAt,lang)} · {r.id.slice(0,8)}</option>)}
    </select></label>}
    {(error || saveError) && <p role="alert">{saveError ? t('Could not confirm the saved report. Retry the same request.','無法確認報告是否保存，請重試相同請求。') : t('Could not load the report.','無法載入報告。')}
      {' '}<button disabled={saving} onClick={()=>saveError ? void save() : setRetry(n=>n+1)}>{t('Retry','重試')}</button></p>}
    {report && <><HealthReportView report={report} lang={lang}/><button className="secondary" onClick={()=>ask(report.id)}>{t('Ask about this report','詢問助手這份報告')}</button></>}
  </section>
}

export function HealthReportMonitor({ lang, deny }: { lang: Lang; deny: () => void }) {
  const [items,setItems] = useState<ReportSummary[]>([])
  const [failed,setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const data = await api<{items:ReportSummary[]}>('/health-reports',{signal:controller.signal})
        if (controller.signal.aborted) return
        setItems(data.items.filter((r,i,rows)=>rows.findIndex(other=>other.crewId===r.crewId)===i)); setFailed(false)
      } catch(e) {
        if (controller.signal.aborted) return
        if (restricted(e)) { deny(); return }
        setFailed(true)
      }
      if (!controller.signal.aborted) timer = setTimeout(poll,5000)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  },[deny])
  return <section className="panel news-monitor"><h2>{tx(lang,'Saved three-layer reports','已保存三層評估報告')}</h2>
    {failed && <p role="status">{tx(lang,'Could not refresh; showing saved reports.','更新失敗；目前顯示已保存報告。')}</p>}
    {items.map(r => <article key={r.crewId}><strong>{r.crewId}</strong><div>{stamp(r.createdAt,lang)}<br/>
      {assessmentText(r,lang)} · {r.statisticsAvailable}/{r.statisticsTotal} {tx(lang,'usable analyses','項分析可用')} · {r.limitCodes.length} {tx(lang,'data limits','項資料限制')}</div></article>)}
    {!items.length && <p>{tx(lang,'No saved reports.','尚無保存報告。')}</p>}
  </section>
}
