import { useEffect, useState } from 'react'
import { api, restricted } from './api'
import { analysisStatusText, displayUnit, stamp, tx, type Lang, type Session } from './domain'
import { AssessmentStatus } from './AssessmentForm'
import { label } from './labels'
import { analysisPhase, profileEntryText, summaryMetrics, summaryNumber, summaryPollMs,
  type DemoAssessment, type DemoBaseline } from './demo-summary'
import './demo-summary.css'

function Baseline({ item, data, lang, ask }: {
  item: DemoBaseline; data: DemoAssessment; lang: Lang; ask?: (id: string) => void
}) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const metric = summaryMetrics.find(([code]) => code === item.metricCode)
  const analysis = item.analysis
  const phase = analysisPhase(analysis, data.playback)
  const usable = analysis?.status === 'ready' && phase !== 'stale'
  const phaseText = {
    history: t('Saved history', '已保存歷史'), playback: t('This playback', '本次回放'),
    stale: t('Playback data stale', '回放資料已過期'), unavailable: t('No saved analysis', '尚無已保存分析'),
  }[phase]
  return <article className="demo-baseline" data-testid={'summary-baseline-' + item.metricCode}>
    <h3>{metric ? t(metric[1], metric[2]) : item.metricCode}</h3>
    {!item.baselineId ? <p>{t('Fixed baseline unavailable.', '固定基準未提供。')}</p> : <>
      <p>{t('Fixed baseline', '固定基準')} · {summaryNumber(item.count, 0)} {t('samples', '筆樣本')}</p>
      <p>{t('Mean', '平均')} {summaryNumber(item.mean)} {displayUnit(item.unit ?? '', item.metricCode)} · SD {summaryNumber(item.sd)}</p>
    </>}
    <strong className={'demo-phase ' + phase}>{phaseText}</strong>
    {analysis && <>
      <p>{analysisStatusText(analysis.status, lang)}</p>
      <p>{t('Reading', '讀值')} {usable ? summaryNumber(analysis.value) : '—'} {displayUnit(analysis.unit, item.metricCode)}</p>
      <p>Z {usable ? summaryNumber(analysis.z) : '—'} · EWMA {usable ? summaryNumber(analysis.ewma) : '—'}</p>
      <small>{stamp(analysis.observedAt, lang)}{analysis.analysisCadenceSeconds != null &&
        <> · {t('Analysis cadence', '分析取樣間隔')} {summaryNumber(analysis.analysisCadenceSeconds)} s</>}</small>
    </>}
    {item.baselineId && <details><summary>{t('Saved evidence', '已保存證據')}</summary>
      <p>{t('Baseline ID', '基準 ID')} <code>{item.baselineId}</code></p>
      {item.from && item.to && <p>{stamp(item.from, lang)} – {stamp(item.to, lang)}</p>}
      {item.context?.activity && <p>{t('Comparable activity', '可比活動條件')} · {label(String(item.context.activity), lang)}</p>}
      {analysis && <>
        <p>{t('Analysis ID', '分析 ID')} <code>{analysis.id}</code></p>
        <p>{t('Measurement ID', '量測 ID')} <code>{analysis.measurementId}</code></p>
        <p>{t('Algorithm', '演算法')} {analysis.algorithmVersion} · {t('Segment', '趨勢段')} <code>{analysis.segmentId}</code></p>
        {ask && <button type="button" className="secondary" onClick={() => ask(analysis.id)}>{t('Ask about this analysis', '詢問助手這筆分析')}</button>}
      </>}
    </details>}
  </article>
}

export function DemoSummary({ session, lang, deny, crew, navigate, askAnalysis, askAssessment }: {
  session: Session; lang: Lang; deny: () => void; crew: { crewId: string; name: string }[]
  navigate: (path: string) => void; askAnalysis: (id: string) => void; askAssessment: (id: string) => void
}) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const monitor = session.roles.includes('monitor')
  const [selected, setSelected] = useState(session.crewId ?? 'mira')
  const crewId = monitor ? selected : session.crewId
  const [result, setResult] = useState<{ crewId: string; data: DemoAssessment; syncedAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!crewId) return
    const controller = new AbortController()
    let pending = false
    async function load() {
      if (pending) return
      pending = true
      try {
        const data = await api<DemoAssessment>('/demo/assessment?crewId=' + encodeURIComponent(crewId!),
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
        if (controller.signal.aborted) return
        setResult({ crewId: crewId!, data, syncedAt: new Date().toISOString() })
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        if (restricted(err)) deny()
        else { setResult(null); setError(crewId) }
      } finally { pending = false }
    }
    void load()
    const timer = setInterval(() => void load(), summaryPollMs)
    return () => { controller.abort(); clearInterval(timer) }
  }, [crewId, deny, retry])
  const current = result?.crewId === crewId ? result : null
  const data = current?.data
  const profile = data?.profile
  const playback = data?.playback
  const news = data?.news2
  const radiation = data?.radiation
  const exposure = radiation?.crewExposure.find(person => person.crewId === crewId)
  const own = crewId === session.crewId
  const activity = playback?.activities.find(item => item.crewId === crewId)
  const playbackLabels: Record<string, [string, string]> = {
    unavailable: ['Unavailable', '尚未準備'], ready: ['Ready', '已準備'], playing: ['Playing', '播放中'],
    completed: ['Completed', '已完成'], stopped: ['Stopped', '已停止'], interrupted: ['Interrupted', '已中斷'], failed: ['Failed', '失敗'],
  }
  return <section className="panel demo-summary" data-testid="demo-health-summary">
    <div className="demo-summary-head"><div><h2>{t('Health assessment summary', '健康評估摘要')}</h2>
      <p>{t('Synthetic training records · Each assessment keeps its own evidence.', '合成訓練資料 · 各項評估保留各自的證據。')}</p></div>
      {monitor && <label>{t('Crew', '船員')}<select value={selected} onChange={event => setSelected(event.target.value)}>
        {['mira', 'kai', 'lin', 'noa', 'sol'].map(id => <option key={id} value={id}>{crew.find(person => person.crewId === id)?.name ?? id}</option>)}
      </select></label>}
    </div>
    {!data ? <p role={error === crewId ? 'alert' : 'status'}>{error === crewId ? t('Summary unavailable. Saved numbers are not shown.', '無法取得摘要，暫不顯示先前數值。') : t('Loading summary…', '正在載入摘要…')}
      {error === crewId && <button className="secondary" onClick={() => setRetry(value => value + 1)}>{t('Retry', '重試')}</button>}</p> : <>
      <div className="demo-timeline">
        <p><strong>{t('30-day history', '30 天歷史')}</strong> · {t('Prepared at', '準備時間')} {playback?.preparedAt ? stamp(playback.preparedAt, lang) : '—'}</p>
        <p><strong>{t('5-minute playback', '5 分鐘回放')}</strong> · {playback && t(...(playbackLabels[playback.status] ?? [playback.status, playback.status]))} · {summaryNumber((playback?.elapsedMs ?? 0) / 1000, 0)} / {summaryNumber((playback?.durationMs ?? 0) / 1000, 0)} s
          {activity && <> · {label(activity.activity, lang)}</>}</p>
        {playback?.startedAt && <p>{t('Playback started', '回放開始')} {stamp(playback.startedAt, lang)}</p>}
        {playback?.error && <p role="alert">{t('Playback needs attention.', '回放發生問題。')} {playback.error}</p>}
        <small>{t('Summary refreshed every 5 seconds', '摘要每 5 秒更新')} · {current && stamp(current.syncedAt, lang)}</small>
      </div>
      <details className="demo-profile" open><summary>{t('Personal profile', '個人基本資料')}</summary>
        <dl><div><dt>{t('Date of birth', '出生日期')}</dt><dd>{profile?.dateOfBirth ?? t('Unknown / not provided', '未知／未提供')}</dd></div>
          <div><dt>{t('Height', '身高')}</dt><dd>{summaryNumber(profile?.heightCm)} cm</dd></div>
          <div><dt>{t('Experience', '太空經驗')}</dt><dd>{summaryNumber(profile?.experienceYears)} {t('years', '年')}</dd></div>
          <div><dt>{t('Medical history', '病史')}</dt><dd>{profileEntryText(profile?.medicalHistory, lang)}</dd></div>
          <div><dt>{t('Medications', '用藥')}</dt><dd>{profileEntryText(profile?.medications, lang)}</dd></div>
          <div><dt>{t('Allergies', '過敏')}</dt><dd>{profileEntryText(profile?.allergies, lang)}</dd></div></dl>
      </details>
      <h3>{t('Six personal baselines', '六項個人基準')}</h3>
      <p>{t('Saved Z and EWMA describe deviation from a comparable fixed baseline; no overall health score is calculated.', '已保存的 Z 與 EWMA 描述相對同條件固定基準的偏離，未計算綜合健康分數。')}</p>
      <div className="demo-baselines">{summaryMetrics.map(([code]) => <Baseline key={code}
        item={data.baselines.find(item => item.metricCode === code) ?? { metricCode: code, baselineId: null, analysis: null }}
        data={data} lang={lang} ask={own ? askAnalysis : undefined}/>)}</div>
      <div className="demo-other-assessments">
        <article><h3>{t('NEWS2 training assessment', 'NEWS2 訓練評估')}</h3>
          {news ? <><AssessmentStatus item={news} lang={lang}/>
            <p><code>{news.id}</code></p>{own && <button type="button" className="secondary" onClick={() => askAssessment(news.id)}>{t('Ask about this assessment', '詢問助手這筆評估')}</button>}</>
            : <p>{t('No saved assessment.', '尚無已保存評估。')}</p>}
          {own && <button type="button" className="secondary" onClick={() => navigate('/app/news2')}>{t('Open NEWS2 details', '查看 NEWS2 詳情')}</button>}
        </article>
        <article><h3>{t('Body composition', '身體組成')}</h3>
          {data.body ? <><p>{t('Muscle', '肌肉')} {summaryNumber(data.body.totals.muscleMassKg)} kg · {t('Fat', '脂肪')} {summaryNumber(data.body.totals.fatMassKg)} kg</p>
            <p>{data.body.findingsCount} {t('recorded findings', '筆觀察紀錄')}</p><small>{stamp(data.body.observedAt, lang)}</small><p><code>{data.body.id}</code></p></> : <p>{t('No saved body scan.', '尚無身體掃描紀錄。')}</p>}
          {own && <button type="button" className="secondary" onClick={() => navigate('/app/body-map')}>{t('Open body view', '查看人體圖')}</button>}
        </article>
        <article data-testid="summary-radiation"><h3>{t('Radiation exposure', '輻射曝露')}</h3>
          <p>{t('Prior missions', '既往任務')} {summaryNumber(data.radiationBreakdown?.priorMissionsMsv, 5)} mSv</p>
          <p>{t('These 30 days', '這 30 天')} {summaryNumber(data.radiationBreakdown?.history30DaysMsv, 5)} mSv</p>
          <p>{t('This playback live increment', '本輪即時新增')} {summaryNumber(exposure?.currentMsv, 5)} mSv</p>
          {data.radiationBreakdown && <details><summary>{t('Saved exposure records', '已保存曝露紀錄')}</summary>
            <p>{t('Prior mission IDs', '既往任務 ID')} <code>{data.radiationBreakdown.priorRecordIds.join(' · ') || '—'}</code></p>
            <p>{t('30-day history IDs', '30 天歷史 ID')} <code>{data.radiationBreakdown.historyRecordIds.join(' · ') || '—'}</code></p>
          </details>}
          <p>{t('Source status', '來源狀態')} · {radiation ? label(radiation.environment.sourceStatus, lang) : t('Unavailable', '未提供')}</p>
          {radiation && <p>{t('Mission ID', '任務 ID')} <code>{radiation.missionId}</code></p>}
          {monitor ? <a href="#radiation-panel">{t('Open radiation details below', '查看下方輻射詳情')}</a>
            : <button type="button" className="secondary" onClick={() => navigate('/app/radiation')}>{t('Open radiation details', '查看輻射詳情')}</button>}
        </article>
      </div>
      {own && <button type="button" className="secondary" onClick={() => navigate('/app/trends')}>{t('Open trends and original evidence', '查看趨勢與原始證據')}</button>}
    </>}
  </section>
}
