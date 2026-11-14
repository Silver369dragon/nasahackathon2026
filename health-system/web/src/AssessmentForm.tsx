import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, newId, restricted } from './api'
import { stamp, tx, type Lang, type Measurement, type Session } from './domain'
import { label } from './labels'
import { choices, nameOf, problemText, units, valueOf, vitalCodes, type Assessment, type AssessmentSummary, type Field, type Vital } from './news2'
import './news2.css'

type Draft = {
  id: string; version: number; observedAt: string; time: string
  fields: Partial<Record<Field,string>>; links: Partial<Record<Vital,string>>; poor: Field[]
}
const utcMinute = () => new Date().toISOString().slice(0,16)
const blank = (): Draft => ({ id: newId(), version: 0, observedAt: '', time: utcMinute(), fields: {}, links: {}, poor: [] })
const fromRecord = (a: Assessment): Draft => ({ id: a.id, version: a.version, observedAt: a.observedAt,
  time: a.observedAt.slice(0,16), fields: Object.fromEntries(Object.entries(a.inputs).filter(([,v]) => v != null)
    .map(([k,v]) => [k,String(v)])), links: a.measurementIds, poor: a.poorQuality })

export function AssessmentStatus({ item, lang }: { item: AssessmentSummary; lang: Lang }) {
  return <div className="news-status" data-testid={'news2-status-' + item.crewId} data-id={item.id} data-version={item.version}>
    <strong>{item.validCount}/8 {tx(lang,'usable inputs','項可用')}</strong>
    <span>{problemText(item, lang) || tx(lang, 'Inputs complete. Mission scoring profile pending approval.',
      '資料已齊，船內評分設定待核准。')}</span>
    <small>{stamp(item.observedAt,lang)} · v{item.version} · {tx(lang, 'Total unavailable', '總分未提供')}</small>
    {item.vitalReadings && Object.keys(item.vitalReadings).length > 0 && <details>
      <summary>{tx(lang,'Recorded vital signs','本次生命徵象')}</summary>
      <ul>{Object.entries(item.vitalReadings).map(([k,v]) => <li key={k}>{nameOf(k as Field,lang)} · {valueOf(k as Field,v,lang)}</li>)}</ul>
    </details>}
  </div>
}

export function News2({ lang, session, assessmentRevision, revision, deny, ask, measure }: {
  lang: Lang; session: Session; assessmentRevision: number; revision?: string; deny: () => void
  ask: (id: string) => void; measure: () => void
}) {
  const t = (en: string, zh: string) => tx(lang,en,zh)
  const [draft, setDraft] = useState<Draft>(blank)
  const [record, setRecord] = useState<Assessment | null>(null)
  const [history, setHistory] = useState<AssessmentSummary[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [ready, setReady] = useState(false)
  const [candidates, setCandidates] = useState<Partial<Record<Vital,Measurement[]>>>({})
  const [candidateError, setCandidateError] = useState(false)
  const command = useRef(newId())
  const flight = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    void api<{items: AssessmentSummary[]}>('/news2', { signal: controller.signal }).then(async ({items}) => {
      if (controller.signal.aborted) return
      setHistory(items)
      const id = active ?? items[0]?.id
      if (id && !dirty) {
        const data = await api<Assessment>('/news2/' + encodeURIComponent(id), { signal: controller.signal })
        if (controller.signal.aborted) return
        setRecord(data); setDraft(fromRecord(data)); setActive(id)
      }
      setLoadError(false); setReady(true)
    }).catch(e => {
      if (controller.signal.aborted) return
      if (restricted(e)) deny()
      else setLoadError(true)
    })
    return () => controller.abort()
  }, [active, dirty, assessmentRevision, deny, retry])

  useEffect(() => {
    const controller = new AbortController()
    const ms = Date.parse(draft.observedAt || draft.time + 'Z')
    setCandidates({})
    setCandidateError(false)
    if (!Number.isFinite(ms)) return
    void Promise.all(vitalCodes.map(async code => {
      const params = new URLSearchParams({ metricCode: code, limit:'50', from: new Date(ms - 300000).toISOString(),
        to: new Date(ms + 300000).toISOString() })
      const data = await api<{items: Measurement[]}>('/measurements?' + params, { signal: controller.signal })
      return [code,data.items]
    })).then(rows => { if (!controller.signal.aborted) setCandidates(Object.fromEntries(rows)) })
      .catch(e => { if (!controller.signal.aborted) { if (restricted(e)) deny(); else setCandidateError(true) } })
    return () => controller.abort()
  }, [draft.observedAt,draft.time,revision,retry,deny])

  function edit(update: Partial<Draft>) {
    setDirty(true); setError(''); command.current = newId()
    setDraft(d => ({ ...d, ...update }))
  }
  function select(id: string) {
    setActive(id); setError(''); setDirty(false); setRecord(null); setReady(!id)
    setDraft(blank()); command.current = newId(); setRetry(n => n + 1)
  }
  function field(k: Field, input: string) {
    const fields = { ...draft.fields, [k]: input }
    if (k === 'spo2_scale' && input !== 'scale2') delete fields.scale2Documented
    edit({ fields })
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (flight.current) return
    flight.current = true; setBusy(true); setError('')
    try {
      const inputs: Record<string, unknown> = {}
      for (const [k,v] of Object.entries(draft.fields)) {
        if (v === '' || v == null || draft.links[k as Vital]) continue
        inputs[k] = k === 'supplemental_oxygen' || k === 'scale2Documented' ? v === 'true' : k in units ? Number(v) : v
      }
      const data = await api<Assessment>('/news2', { body: {
        id: draft.id, commandId: command.current, expectedVersion: draft.version,
        observedAt: draft.observedAt || new Date(draft.time + 'Z').toISOString(), inputs,
        measurementIds: draft.links, poorQuality: draft.poor,
      }, token: session.csrfToken })
      setRecord(data); setDraft(fromRecord(data)); setActive(data.id); setDirty(false); setRetry(n => n + 1)
    } catch(e) {
      if (restricted(e)) deny()
      else setError(e instanceof ApiError && e.status === 409 ? 'conflict' : 'save')
    } finally { setBusy(false); flight.current = false }
  }
  function control(k: Field) {
    const opts = choices[k]
    const name = nameOf(k,lang)
    return <label key={k}>{name}{units[k] ? ' (' + units[k] + ')' : ''}
      {opts ? <select aria-label={name} value={draft.fields[k] ?? ''} onChange={e => field(k,e.target.value)}>
        <option value="">{t('Not recorded','未記錄')}</option>{opts.map(([v,en,zh]) => <option key={v} value={v}>{t(en,zh)}</option>)}
      </select> : <input aria-label={name} type={units[k] ? 'number' : 'text'} min={k === 'temperature' ? undefined : k === 'observationSeconds' ? 1 : 0}
        max={k === 'spo2' ? 100 : undefined} maxLength={180} step={k === 'observationSeconds' ? '1' : 'any'}
        value={draft.fields[k] ?? ''} onChange={e => field(k,e.target.value)}/>}
    </label>
  }
  function quality(k: Field) {
    return <label className="news-quality"><input type="checkbox" checked={draft.poor.includes(k)}
      onChange={e => edit({ poor: e.target.checked ? [...draft.poor,k] : draft.poor.filter(i => i !== k) })}/>
      {t('Unusable reading','量測品質不足')}</label>
  }
  function vital(k: Vital) {
    const chosen = draft.links[k]
    const options = candidates[k] ?? []
    return <div className="news-vital" key={k}>
      <label>{nameOf(k,lang)} · {t('Source','來源')}
        <select aria-label={nameOf(k,lang) + t(' source','來源')} value={chosen ?? ''} onChange={e => {
          const links = { ...draft.links }
          if (e.target.value) links[k] = e.target.value
          else delete links[k]
          edit({ links })
        }}><option value="">{t('Enter this observation','輸入本次觀察')}</option>
          {chosen && !options.some(v => v.id === chosen) && <option value={chosen}>{t('Linked reading','已連結的量測')}</option>}
          {options.map(m => <option key={m.id} value={m.id}>{stamp(m.observedAt,lang)} · {m.value ?? '—'} {units[k]} · {label(m.provenance.source,lang)} · {label(m.quality,lang)}</option>)}
        </select>
      </label>
      {!chosen && control(k)}
      {k === 'temperature' && !chosen && <>{control('temperatureSite')}{control('temperatureMethod')}</>}
      {quality(k)}
    </div>
  }
  return <section className="news2">
    <div className="panel news-history"><label>{t('Assessment record','評估紀錄')}
      <select aria-label={t('Assessment record','評估紀錄')} disabled={busy} value={active ?? ''} onChange={e => select(e.target.value)}>
        <option value="">{t('New assessment','新評估')}</option>{history.map(a => <option key={a.id} value={a.id}>{stamp(a.observedAt,lang)} · {a.validCount}/8 · v{a.version}</option>)}
      </select></label>
      {active && <button type="button" disabled={busy} className="secondary" onClick={() => select('')}>{t('New assessment','新增一次評估')}</button>}
    </div>
    {loadError && <p role="alert">{t('Could not load assessments.','無法載入評估。')} <button onClick={() => setRetry(n => n+1)}>{t('Retry','重試')}</button></p>}
    {record && <div className="panel news-result"><AssessmentStatus item={record} lang={lang}/>
      <button className="secondary" type="button" onClick={() => ask(record.id)}>{t('Ask about this NEWS2 assessment','詢問助手這次評估還缺什麼')}</button></div>}
    {ready && <form onSubmit={save} className="panel news-form">
      <fieldset disabled={busy}><legend>{t('Observations from this assessment','本次評估觀察')}</legend>
        <label>{t('Observation time (UTC)','觀察時間（UTC）')}<input type="datetime-local" required disabled={draft.version > 0}
          value={draft.time} onChange={e => edit({ time: e.target.value })}/></label>
        <p>{t('Enter readings taken together at this time, or select matching records within five minutes. You can save a partial assessment.',
          '輸入同次、同時觀察的資料，或選取前後五分鐘內的原始量測。可先儲存已知項目，再回來補齊。')}</p>
        {candidateError && <p role="alert">{t('Could not load linked readings.','無法載入可連結量測。')} <button type="button" onClick={() => setRetry(n => n+1)}>{t('Retry','重試')}</button></p>}
        <div className="news-grid">{vitalCodes.map(vital)}</div>
        <div className="news-grid">
          <div className="news-vital">{control('respiratory_rate')}{control('observationSeconds')}{quality('respiratory_rate')}</div>
          <div className="news-vital">{control('neurological_assessment')}{control('supplemental_oxygen')}</div>
          <div className="news-vital">{control('spo2_scale')}{draft.fields.spo2_scale === 'scale2' && control('scale2Documented')}</div>
        </div>
        <p>{t('Training records · ACVPU 2017. Record the scale selected by the clinician.','合成訓練紀錄 · ACVPU 2017。血氧尺度依醫療人員指定紀錄填寫。')} <a href="https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/" target="_blank" rel="noreferrer">RCP NEWS2</a></p>
        <button className="primary" type="submit" disabled={busy || (!!record && !dirty)}>{t('Save assessment','儲存評估')}</button>
      </fieldset>
      {error && <p role="alert">{error === 'conflict' ? t('Another session updated this assessment. Reload its latest version.','另一個工作階段已更新評估。請載入最新版本。') :
        t('Could not save. Check the time and inputs, then retry.','儲存失敗，請檢查觀察時間和輸入後重試。')}
        {error === 'conflict' && <button type="button" onClick={() => select(draft.id)}>{t('Reload','重新載入')}</button>}</p>}
    </form>}
    {!dirty && <button className="secondary" type="button" onClick={measure}>{t('Open vital-sign measurement form','開啟生命徵象量測表單')}</button>}
  </section>
}

export function AssessmentEvidence({ record, lang }: { record: Assessment; lang: Lang }) {
  const reason = { outside_training_window: tx(lang,'Outside training time window','超出訓練時間窗'),
    missing_context: tx(lang,'Incomplete context','缺觀察資料'), unusable_quality: tx(lang,'Unusable quality','品質不足') }
  return <><AssessmentStatus item={record} lang={lang}/><dl>
    {(Object.keys(record.effectiveInputs) as Field[]).map(k => <div key={k}><dt>{nameOf(k,lang)}</dt>
      <dd>{valueOf(k,record.effectiveInputs[k],lang)} {record.invalidReasons[k] && reason[record.invalidReasons[k]!]}
        {record.linkedRecords[k as Vital] && <small> · {label(record.linkedRecords[k as Vital]!.source,lang)} · {stamp(record.linkedRecords[k as Vital]!.observedAt,lang)} · {label(record.linkedRecords[k as Vital]!.quality,lang)}</small>}</dd></div>)}
  </dl></>
}
