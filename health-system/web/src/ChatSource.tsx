import { Fragment, useEffect, useState } from 'react'
import { api, restricted } from './api'
import { stamp, tx, type Lang, type Measurement } from './domain'
import { label } from './labels'
import type { Assessment } from './news2'
import { AssessmentEvidence } from './AssessmentForm'
import './chat-source.css'

export type ChatCitation = {
  kind: 'measurement' | 'task' | 'alert' | 'knowledge' | 'assessment'
  id: string; title: string; version?: number; chunkId?: string
}
type Common = { citation: ChatCitation; lang: Lang; deny: () => void }
type LocalText = Record<Lang, string>
type Source = { id: string; title: string; url: string; version: string; section: string }
type KnowledgeRecord = {
  title: LocalText; version: number; purpose: LocalText; sources: Source[]
  chunks: { id: string; section: LocalText; text: LocalText; sources: Source[] }[]
}
type TaskRecord = {
  kind: string; status: string; date: string; version: number; dueAt: string
  activity?: string; startedAt?: string; completedAt?: string
  evidence?: { durationSeconds?: number; source?: string; activity?: string; rating?: string
    note?: string; reason?: string; measurementIds?: string[] }
}
type AlertRecord = {
  ruleId: string; ruleVersion: number; conditionState: string; reason: string; createdAt: string
  updatedAt: string; initialEvidenceMeasurementIds: string[]
}
type RecordResult = { kind: 'measurement'; record: Measurement } | { kind: 'task'; record: TaskRecord }
  | { kind: 'alert'; record: AlertRecord } | { kind: 'knowledge'; record: KnowledgeRecord } | { kind:'assessment'; record: Assessment }

const names: Record<string, [string, string]> = {
  assessment: ['NEWS2 assessment','NEWS2 健康評估'],
  measurement: ['Measurement', '量測紀錄'], knowledge: ['Local document', '本機文件'],
  task: ['Training task', '訓練任務'], alert: ['Training alert', '訓練警示'],
  heart_rate: ['Heart rate', '心率'], spo2: ['Oxygen saturation', '血氧飽和度'],
  temperature: ['Body temperature', '體溫'], blood_pressure_systolic: ['Systolic pressure', '收縮壓'],
  blood_pressure_diastolic: ['Diastolic pressure', '舒張壓'], self_check: ['Daily check-in', '每日自評'],
  pending: ['Pending', '待辦'], in_progress: ['In progress', '進行中'], completed: ['Completed', '已完成'],
  skipped: ['Skipped', '已略過'], exempt: ['Exempt', '已免除'], cycle: ['Cycle ergometer', '自行車測功儀'],
  resistance: ['Resistance training', '阻力訓練'], treadmill: ['Treadmill', '跑步機'], timer: ['Timer', '計時紀錄'],
  fatigued: ['Fatigued', '疲憊'], unwell: ['Unwell', '不適'], active: ['Active', '已觸發'],
  cleared: ['Cleared', '已解除'], unknown: ['Unknown', '未知'],
}
const readable = (code: string, lang: Lang) => names[code] ? tx(lang, ...names[code]) : label(code, lang)

async function readRecord(c: Pick<ChatCitation, 'kind' | 'id' | 'version'>, signal: AbortSignal): Promise<RecordResult> {
  const id = encodeURIComponent(c.id)
  const options = { signal }
  if (c.kind === 'knowledge') {
    const version = c.version == null ? '' : '?version=' + c.version
    return { kind: c.kind, record: await api<KnowledgeRecord>('/knowledge/documents/' + id + version, options) }
  }
  const path = '/assistant/records/' + c.kind + '/' + id
  if (c.kind === 'assessment') return { kind: c.kind, record: await api<Assessment>(path + '?version=' + c.version, options) }
  if (c.kind === 'measurement') return { kind: c.kind, record: await api<Measurement>(path, options) }
  if (c.kind === 'task') return { kind: c.kind, record: await api<TaskRecord>(path, options) }
  return { kind: c.kind, record: await api<AlertRecord>(path, options) }
}

function fields(result: Exclude<RecordResult, {kind: 'knowledge' | 'assessment'}>, lang: Lang): [string, string | undefined][] {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const translated = (s?: string) => s ? readable(s, lang) : undefined
  const time = (s?: string) => s ? stamp(s, lang) : undefined
  if (result.kind === 'measurement') {
    const m = result.record
    const context = Object.values(m.context).filter((s): s is string => typeof s === 'string' && !!s)
    return [
      [readable(m.metricCode, lang), m.value === null ? t('Missing', '缺值') : m.value + ' ' + m.unit],
      [t('Observed', '量測時間'), time(m.observedAt)], [t('Source', '來源'), translated(m.provenance.source)],
      [t('Method', '方法'), translated(m.method)], [t('Quality', '品質'), translated(m.quality)],
      [t('Quality note', '品質說明'), m.qualityReason ?? undefined],
      [t('Context', '量測情境'), context.map(s => readable(s, lang)).join(' · ') || t('Unrecorded', '未記錄')],
      [t('Data origin', '資料性質'), m.provenance.isSynthetic ? t('Synthetic', '合成資料') : translated(m.provenance.dataOrigin)],
    ]
  }
  if (result.kind === 'task') {
    const r = result.record
    const e = r.evidence
    const seconds = e?.durationSeconds == null ? null : Math.round(e.durationSeconds)
    return [
      [t('Task', '任務'), translated(r.kind)], [t('Status', '狀態'), translated(r.status)],
      [t('Due', '截止時間'), time(r.dueAt)], [t('Started', '開始時間'), time(r.startedAt)],
      [t('Closed', '結束時間'), time(r.completedAt)], [t('Activity', '活動'), translated(e?.activity ?? r.activity)],
      [t('Duration', '時長'), seconds === null ? undefined : Math.floor(seconds / 60) + t(' min ', ' 分 ') + seconds % 60 + t(' s', ' 秒')],
      [t('Source', '來源'), translated(e?.source)], [t('Self-rating', '自評'), translated(e?.rating)],
      [t('Note', '備註'), e?.note], [t('Reason', '原因'), e?.reason],
    ]
  }
  const a = result.record
  return [
    [t('Rule', '規則'), a.ruleId + ' · v' + a.ruleVersion], [t('Status', '狀態'), translated(a.conditionState)],
    [t('Triggered', '觸發時間'), time(a.createdAt)], [t('Updated', '更新時間'), time(a.updatedAt)],
    [t('Recorded reason', '原始紀錄原因'), a.reason],
  ]
}

function KnowledgeExcerpt({ record, citation, lang }: { record: KnowledgeRecord; citation: ChatCitation; lang: Lang }) {
  const c = record.chunks.find(item => item.id === citation.chunkId)
  if (citation.chunkId && !c) return <p>{tx(lang, 'The cited section was not found in this version.', '此版本找不到引用的段落。')}</p>
  return <>
    <strong>{record.title[lang]} · v{record.version}</strong>
    {c && <h4>{c.section[lang]}</h4>}
    <p>{(c?.text ?? record.purpose)[lang]}</p>
    <ul>{(c?.sources ?? record.sources).map(s => <li key={s.id}>
      {s.url.startsWith('https://') ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : <strong>{s.title}</strong>}
      <small>{s.section} · {s.version}</small>
    </li>)}</ul>
  </>
}

function SourceDetail({ citation, lang, deny }: Common) {
  const [data, setData] = useState<RecordResult | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { kind, id, version } = citation
  useEffect(() => {
    const controller = new AbortController()
    void readRecord({ kind, id, version }, controller.signal).then(record => {
      if (!controller.signal.aborted) setData(record)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (restricted(error)) { deny(); return }
      setFailed(true)
    })
    return () => controller.abort()
  }, [kind, id, version, attempt, deny])
  if (failed) return <p role="alert">{tx(lang, 'Could not load the cited record.', '無法載入引用紀錄。')}{' '}
    <button type="button" onClick={() => { setFailed(false); setAttempt(n => n + 1) }}>{tx(lang, 'Retry', '重試')}</button></p>
  if (!data) return <p role="status">{tx(lang, 'Loading record…', '讀取紀錄中…')}</p>
  if (data.kind === 'assessment') return <AssessmentEvidence record={data.record} lang={lang}/>
  if (data.kind === 'knowledge') return <KnowledgeExcerpt record={data.record} citation={citation} lang={lang}/>
  const ids = data.kind === 'task' ? data.record.evidence?.measurementIds
    : data.kind === 'alert' ? data.record.initialEvidenceMeasurementIds : []
  return <><dl>{fields(data, lang).map(([name, value]) => value && <Fragment key={name}><dt>{name}</dt><dd>{value}</dd></Fragment>)}</dl>
    {ids?.map((mid, i) => <ChatSource key={mid} lang={lang} deny={deny} citation={{ kind: 'measurement',
      id: mid, title: tx(lang, 'Linked measurement ', '關聯量測 ') + (i + 1) }}/>)}</>
}

export function ChatSource({ citation, lang, deny }: Common) {
  const [expanded, setExpanded] = useState(false)
  return <details className="chat-source" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary data-testid={['citation', citation.kind, citation.id, citation.chunkId].filter(Boolean).join('-')}>
      <span>{readable(citation.kind, lang)}</span> {citation.title}
    </summary>
    {expanded && <div className="chat-source-body"><SourceDetail key={[citation.kind, citation.id, citation.version, citation.chunkId].join('-')}
      citation={citation} lang={lang} deny={deny}/></div>}
  </details>
}
