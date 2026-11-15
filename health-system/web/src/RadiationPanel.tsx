import { useEffect, useState } from 'react'
import { api, ApiError, newId, restricted } from './api'
import { stamp, tx, type Lang, type Session } from './domain'
import { TrendChart } from './Trends'
import { radiationFresh, radiationNumber as number, type RadiationHistory, type RadiationPerson, type RadiationSnapshot } from './radiation'

function History({ crewId, lang, deny }: { crewId: string; lang: Lang; deny: () => void }) {
  const [items, setItems] = useState<RadiationHistory[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    api<{items:RadiationHistory[]}>('/radiation/crew/' + crewId + '/history', {signal:controller.signal})
      .then(data => { if (!controller.signal.aborted) setItems(data.items) })
      .catch(e => { if (!controller.signal.aborted) { if (restricted(e)) deny(); else setError(true) } })
    return () => controller.abort()
  }, [crewId, deny])
  if (error) return <p role="alert">{tx(lang, 'History unavailable.', '無法讀取歷史紀錄。')}</p>
  if (!items) return <p>{tx(lang, 'Loading…', '讀取中…')}</p>
  return <ul className="radiation-history" data-testid="radiation-history">{items.map(record => <li key={record.id}>
    <strong>{number(record.doseEquivalentMsv, 1)} mSv · {record.exposureDays} {tx(lang, 'days', '天')}</strong>
    <small>{stamp(record.startAt, lang)} — {stamp(record.endAt, lang)}</small>
    <small>{record.missionLabel} · Simulation · {record.method}</small>
  </li>)}</ul>
}

function Person({ person, fresh, lang, deny }: { person:RadiationPerson; fresh:boolean; lang:Lang; deny:()=>void }) {
  const [expanded, setExpanded] = useState(false)
  const t = (en:string, zh:string) => tx(lang, en, zh)
  return <article className="radiation-person" data-testid={'radiation-person-' + person.crewId}>
    <h3>{person.crewId[0].toUpperCase() + person.crewId.slice(1)} · {t('Estimated Cumulative Radiation Dose Equivalent', '累積輻射劑量當量估計')}</h3>
    <strong className="radiation-value" data-testid="radiation-total">{number(fresh ? person.comparableTotalMsv : null, 4)} <small>mSv</small></strong>
    <div className="radiation-breakdown"><span>{t('Prior exposure', '歷史暴露')} <b>{number(person.historyMsv, 4)} mSv</b></span>
      <span>{t('Shared increment', '全員共同新增')} <b>{number(fresh ? person.currentMsv : null, 4)} mSv</b></span></div>
    <p>{person.experienceYears} {t('years of service', '年年資')} · {person.historyDays} {t('prior days in space', '天過往太空任務')} · Simulation</p>
    {person.historyStatus !== 'complete' && <p>{t('Incomplete or incompatible history; total unavailable.', '歷史缺失或口徑不可比，無法提供合計。')}</p>}
    <details onToggle={event => setExpanded(event.currentTarget.open)}><summary>{t('Exposure history', '暴露歷史紀錄')}</summary>
      {expanded && <History key={person.crewId} crewId={person.crewId} lang={lang} deny={deny}/>}</details>
  </article>
}

type Command = {commandId:string; expectedControlVersion:number; action:'start'|'end'; preset?:'spe'|'elevated'; eventId?:string}
function Controls({data, session, lang, deny}: {data:RadiationSnapshot; session:Session; lang:Lang; deny:()=>void}) {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState<Command | null>(null), [error, setError] = useState('')
  const t = (en:string, zh:string) => tx(lang, en, zh)
  async function send(command:Command) {
    setBusy(true); setError('')
    try { await api('/radiation/demo-event', {body:command, token:session.csrfToken, signal:AbortSignal.timeout(8000)}); setFailed(null) }
    catch (e) {
      if (restricted(e)) deny()
      else {
        setFailed(e instanceof ApiError && e.status < 500 ? null : command)
        setError(t('Update unconfirmed. Check the latest event or retry the same command.', '尚未確認更新，請查看最新狀態或重試同一指令。'))
      }
    } finally { setBusy(false) }
  }
  return <details className="radiation-controls" data-testid="radiation-controls"><summary>{t('Simulation controls', '模擬事件控制')}</summary>
    <p>{t('Affects the whole crew. Presets are demonstration values, not medical limits.', '影響全體船員；展示數值不是醫療警戒值。')}</p>
    <div className="radiation-actions">{data.activeEvent ? <button data-testid="radiation-end" disabled={busy || !!failed} onClick={() => void send({commandId:newId(),expectedControlVersion:data.controlVersion,action:'end',eventId:data.activeEvent!.id})}>{t('End event', '結束事件')}</button> :
      (['elevated','spe'] as const).map(preset => <button key={preset} data-testid={'radiation-' + preset} disabled={busy || !!failed}
        onClick={() => void send({commandId:newId(),expectedControlVersion:data.controlVersion,action:'start',preset})}>{preset === 'spe' ? 'SPE · 750 μSv/h' : 'Elevated · 150 μSv/h'}</button>)}
      {failed && <button disabled={busy} onClick={() => void send(failed)}>{t('Retry command', '重試指令')}</button>}</div>
    {error && <p role="alert">{error}</p>}
  </details>
}

export function Radiation({data, connected, session, lang, deny, crewId, board = false, phone = false}: {
  data:RadiationSnapshot | null; connected:boolean; session:Session; lang:Lang; deny:()=>void; crewId?:string | null; board?:boolean
  phone?:boolean
}) {
  const [now, setNow] = useState(Date.now)
  const [tab, setTab] = useState<'environment' | 'mine'>('environment')
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const t = (en:string, zh:string) => tx(lang, en, zh)
  const fresh = radiationFresh(data, connected, now)
  const elevated = fresh && data?.environment.radiationEvent !== 'background'
  const labels:Record<string,string> = {background:t('Background','背景輻射'), elevated_exposure:t('Elevated Exposure','暴露升高'), radiation_event:t('Radiation Event','輻射事件')}
  if (board) return <section className={'panel radiation-panel radiation-board' + (elevated ? ' radiation-event' : '')} data-testid="radiation-panel">
    <div><h2>{t('Space Radiation Monitoring', '太空輻射監測')}</h2><span className="simulation-label">Simulation</span></div>
    <div><small>{t('Dose equivalent rate', '環境劑量當量率')}</small><strong className="radiation-value"><span data-testid="radiation-rate">{number(fresh ? data?.environment.rateUsvH : null, 1)}</span> <small>μSv/h</small></strong></div>
    <div><span data-testid="radiation-status">{fresh ? labels[data!.environment.radiationEvent] : t('Data unavailable', '資料缺失或更新中')}</span>
      <small>{t('Last saved', '最後保存')}：{data ? stamp(data.checkpointAt, lang) : '—'}</small></div>
    <div><small>{t('Shared monitoring time', '共同監測時間')}：{data ? (data.elapsedMs / 3600000).toFixed(4) : '—'} h</small>
      <small>{t('Shared increment', '全員共同新增')}：{number(fresh ? data?.sharedExposure.currentMsv : null, 4)} mSv</small></div>
  </section>
  const people = board ? [] : data?.crewExposure.filter(p => !crewId || p.crewId === crewId) ?? []
  const points = data?.recentRatePoints ?? []
  let segment = 0
  const plotPoints = points.flatMap((p, i) => {
    if (p.rateUsvH === null) { segment++; return [] }
    return [{id:String(i), observedAt:new Date(p.elapsedMs).toISOString(),value:p.rateUsvH,quality:'good',segment}]
  })
  const start = points[0]?.elapsedMs ?? 0, end = Math.max(start + 1, data?.elapsedMs ?? 1)
  const chart = <TrendChart group={{points:plotPoints,unit:'μSv/h'}} start={new Date(start).toISOString()} end={new Date(end).toISOString()}
      lang={lang} metricCode="radiation" floor={0} axisLabels={[(start/1000).toFixed(0)+' s',t('Monitoring time','監測時間'),(end/1000).toFixed(0)+' s']}/>
  const about = <details><summary>{t('Estimate and source', '估計方法與來源')}</summary><p>{t('Fictional past missions plus one shared cabin exposure estimate. Not absorbed dose, organ-weighted effective dose or a health diagnosis.', '虛構歷史任務加上全艙共同暴露估計；不等同吸收劑量、器官加權有效劑量或健康診斷。')}</p>
      <p>{t('75 μSv/h is a historical Mars-cruise demonstration reference, not a safety threshold.', '75 μSv/h 為火星航程歷史量級的展示參考，不是安全門檻。')} <a href="https://www.jpl.nasa.gov/news/data-from-nasa-rovers-voyage-to-mars-aids-planning/" target="_blank" rel="noreferrer">NASA/JPL</a></p></details>
  // Phone layout: a colored status card, then one of two views (cabin environment or my total).
  if (phone) {
    const level = !fresh ? 'unknown' : data!.environment.radiationEvent
    return <section className={'panel radiation-panel radiation-phone'} data-testid="radiation-panel">
      <div className={'radiation-status-card ' + level}>
        <div><span>{t('Cabin radiation now', '現在艙內輻射')}</span>
          <strong className="radiation-value"><span data-testid="radiation-rate">{number(fresh ? data?.environment.rateUsvH : null, 1)}</span> <small>μSv/h</small></strong></div>
        <b data-testid="radiation-status">{fresh ? labels[data!.environment.radiationEvent] : t('Data unavailable', '資料缺失或更新中')}</b>
        <small>{t('Last saved', '最後保存')} {data ? stamp(data.checkpointAt, lang) : '—'} · Simulation</small>
      </div>
      <div className="radiation-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'environment'} className={tab === 'environment' ? 'selected' : ''} onClick={() => setTab('environment')}>{t('Cabin', '艙內環境')}</button>
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'selected' : ''} onClick={() => setTab('mine')}>{t('My total', '我的累積')}</button>
      </div>
      {tab === 'environment' ? <div className="radiation-tab-body">{chart}
        <p>{t('Shared increment this mission', '本次任務全員共同新增')} <b>{number(fresh ? data?.sharedExposure.currentMsv : null, 4)} mSv</b></p>
        <small>{t('Shared monitoring time', '共同監測時間')} {data ? (data.elapsedMs / 3600000).toFixed(2) : '—'} h</small>
        {!fresh && data && <small>{t('Last valid increment', '最後有效新增量')}：{number(data.sharedExposure.lastValidCurrentMsv, 4)} mSv</small>}
        {data?.sharedExposure.coverage !== 'complete' && <small>{t('Coverage incomplete; known subtotal only.', '資料涵蓋不完整，僅提供已知小計。')}</small>}
      </div> : <div className="radiation-tab-body">{people.length ? people.map(person => <Person key={person.crewId} {...{person,fresh,lang,deny}}/>)
        : <p>{t('No personal record.', '尚無個人紀錄。')}</p>}</div>}
      {data && fresh && session.roles.includes('monitor') && data.sourceMode === 'simulation' && <Controls {...{data,session,lang,deny}}/>}
      {about}
    </section>
  }
  return <section className={'panel radiation-panel' + (elevated ? ' radiation-event' : '')} data-testid="radiation-panel">
    <div className="radiation-heading"><h2>{t('Space Radiation Monitoring', '太空輻射監測')}</h2><span className="simulation-label">Simulation</span></div>
    <div className="radiation-environment"><div><p>{t('Current Radiation Dose Equivalent Rate', '當前環境輻射劑量當量率')}</p>
      <strong className="radiation-value"><span data-testid="radiation-rate">{number(fresh ? data?.environment.rateUsvH : null, 1)}</span> <small>μSv/h</small></strong>
      <p data-testid="radiation-status">{fresh ? labels[data!.environment.radiationEvent] : t('Data unavailable / last update below', '資料缺失或更新中／最後更新如下')}</p>
      <small>{t('Last saved', '最後保存')}：{data ? stamp(data.checkpointAt, lang) : '—'}</small>
      <p>{t('Shared monitoring time', '共同監測時間')}：{data ? (data.elapsedMs / 3600000).toFixed(4) : '—'} h</p>
      <p>{t('Shared increment', '全員共同新增')}：{number(fresh ? data?.sharedExposure.currentMsv : null, 4)} mSv</p>
      {!fresh && data && <small>{t('Last valid increment', '最後有效新增量')}：{number(data.sharedExposure.lastValidCurrentMsv, 4)} mSv</small>}
      {data?.sharedExposure.coverage !== 'complete' && <p>{t('Coverage incomplete; known subtotal only.', '資料涵蓋不完整，僅提供已知小計。')}</p>}
    </div><div><small>μSv/h</small>{chart}</div></div>
    {!!people.length && <div className="radiation-crew" data-testid="radiation-crew">{people.map(person => <Person key={person.crewId} {...{person,fresh,lang,deny}}/>)}</div>}
    {data && fresh && session.roles.includes('monitor') && !board && data.sourceMode === 'simulation' && <Controls {...{data,session,lang,deny}}/>}
    {about}
  </section>
}
