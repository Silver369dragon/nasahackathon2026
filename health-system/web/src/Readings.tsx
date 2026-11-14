import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  Clock3,
  Database,
  Droplets,
  Gauge,
  HeartPulse,
  Thermometer,
} from 'lucide-react'
import { api, restricted } from './api'
import { monitoringMetrics as metrics, prettyValue, relativeTime, selectReadings, stamp, tx, displayUnit, workOfBreathingFields } from './domain'
import type { CrewSummary, Lang, Measurement, MonitoringMetric } from './domain'
import { contextLabels, label } from './labels'

export const metricIcons = {
  heart_rate: HeartPulse,
  spo2: Droplets,
  blood_pressure: Gauge,
  temperature: Thermometer,
  respiratory_rate: Activity,
  work_of_breathing: Activity,
}

function BreathingDetails({ record, lang }: { record: Measurement; lang: Lang }) {
  if (!record.value || typeof record.value !== 'object') return null
  return <dl className="breathing-details">{workOfBreathingFields(record.value, lang).map(([name, value]) =>
    <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
  </dl>
}

export function Reading({
  crew,
  metric,
  lang,
  compact = false,
  board = false,
}: {
  crew: CrewSummary
  metric: MonitoringMetric
  lang: Lang
  compact?: boolean
  board?: boolean
}) {
  const records = selectReadings(crew.metricCards, metric, 'latest')
  const valid = selectReadings(crew.metricCards, metric, 'lastValid')
  const record = records.find((r) => r !== null)
  const validRecord = valid.find((r) => r !== null)
  const issue = records.find((r) => r && r.quality !== 'good')
  const status = record
    ? (crew.metricCards.find((c) => c.metricCode === record.metricCode)?.freshness ?? 'last_measurement')
    : 'no_data'
  const Icon = metricIcons[metric.code]
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const contexts = record
    ? contextLabels(record.context ?? {}, lang)
    : []
  return (
    <article
      className={'reading ' + metric.code + (compact ? ' compact' : '')}
      data-testid={'metric-' + metric.code}
    >
      <header>
        <span className="metric-symbol">
          <Icon size={18} strokeWidth={1.7} />
        </span>
        <h3>{t(metric.en, metric.zh)}</h3>
      </header>
      <div className="reading-number">
        <strong>{records.map((r) => prettyValue(r, false, lang)).join(' / ')}</strong>
        <span>{metric.unit}</span>
      </div>
      <div className={'status-tag ' + (issue || status === 'stale' ? 'warn' : record ? 'ok' : '')}>
        <i />
        {issue ? label(issue.quality, lang) + ' · ' : ''}
        {label(status, lang)}
      </div>
      {record ? (
        <>
          {record.provenance.isSynthetic && <span className="simulation-label">{t('Simulation', '模擬資料')}</span>}
          <details className="reading-details">
          <summary>{t('Details', '詳細資料')}</summary>
          <div className="reading-meta">
            <span>
              {label(record.provenance.source, lang)}
              {record.provenance.isSynthetic && ' · ' + label('synthetic', lang)}
            </span>
            <span>
              {t('Quality', '品質')} · {label(record.quality, lang)}
            </span>
            <time dateTime={record.observedAt}>{stamp(record.observedAt, lang)}</time>
            {!compact && <span>{relativeTime(record.observedAt, lang)}</span>}
          </div>
          {issue?.qualityReason && <p className="reason">{issue.qualityReason}</p>}
          <BreathingDetails record={record} lang={lang} />
          {!board && (!compact || issue || status === 'stale') && (
            <div className="valid-row">
              <span>{t('Last valid measurement', '最近有效量測')}</span>
              {validRecord ? (
                <>
                  <b>
                    {valid.map((r) => prettyValue(r, false, lang)).join(' / ')} {metric.unit}
                  </b>
                  <time>{stamp(validRecord.observedAt, lang)}</time>
                </>
              ) : (
                <b>—</b>
              )}
            </div>
          )}
          {!compact && (
            <p className="method">
              {[label(record.method, lang), ...contexts].join(' · ')}
            </p>
          )}
          </details>
        </>
      ) : (
        <div className="reading-meta">
          <span>{t('Data unavailable', '尚無量測紀錄')}</span>
        </div>
      )}
    </article>
  )
}

export function CrewBoard({
  rows,
  lang,
  board,
  navigate,
}: {
  rows: CrewSummary[]
  lang: Lang
  board: boolean
  navigate: (path: string) => void
}) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  return (
    <section className="crew-list" aria-label={t('Crew measurements', '船員量測')}>
      {rows.map((crew) => (
        <div className="crew-row" key={crew.crewId} data-testid={'crew-' + crew.crewId}>
          <div className="crew-id">
            <div className="avatar">{crew.name.slice(0, 1).toUpperCase()}</div>
            {board ? (
              <h2>{crew.name}</h2>
            ) : (
              <button
                className="crew-link"
                onClick={() => navigate('/system/crew/' + encodeURIComponent(crew.crewId))}
              >
                {crew.name}
                <ArrowUpRight size={15} />
              </button>
            )}
            {crew.deviceStatus && (
              <small>
                {t('Device', '裝置')} · {label(crew.deviceStatus, lang)}
              </small>
            )}
          </div>
          {metrics.map((metric) => (
            <Reading crew={crew} lang={lang} metric={metric} compact board={board} key={metric.code} />
          ))}
        </div>
      ))}
    </section>
  )
}

export function History({ crew, lang, deny, historyRevision }: { crew: CrewSummary; lang: Lang; deny: () => void; historyRevision?: string }) {
  const [items, setItems] = useState<Measurement[] | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState('')
  const [next, setNext] = useState<string | null>(null)
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const crewId = crew.crewId
  const revision = page ? '' : historyRevision
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ crewId, limit: '30' })
    if (filter !== 'all') query.set('metricCode', filter)
    if (page) query.set('cursor', page)
    void api<{ items: Measurement[]; nextCursor: string | null }>('/measurements?' + query, {
      signal: controller.signal,
    })
      .then((data) => {
        setItems(data.items)
        setNext(data.nextCursor)
        setError(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        if (restricted(err)) {
          setItems(null)
          deny()
          return
        }
        setError(true)
      })
    return () => controller.abort()
  }, [crewId, revision, page, filter, deny, retry])
  function openPage(cursor: string) {
    setItems(null)
    setError(false)
    setNext(null)
    setPage(cursor)
  }
  return (
    <section className="panel history-panel">
      <div className="panel-head">
        <h2>
          <Clock3 size={18} />
          {t('Measurement history', '量測歷史')}
        </h2>
        <label className="filter">
          <select
            aria-label={t('Filter history', '篩選歷史')}
            value={filter}
            onChange={(e) => {
              openPage('')
              setFilter(e.target.value)
            }}
          >
            <option value="all">{t('All metrics', '所有指標')}</option>
            {metrics.flatMap((m) =>
              m.fields.map((field) => (
                <option key={field} value={field}>
                  {t(m.en, m.zh)}
                  {m.code === 'blood_pressure' &&
                    (field.endsWith('_systolic')
                      ? t(' · Systolic', ' · 收縮壓')
                      : t(' · Diastolic', ' · 舒張壓'))}
                </option>
              )),
            )}
          </select>
          <ChevronDown size={13} />
        </label>
      </div>
      {error ? (
        <div className="empty-state" role="alert">
          {t('History unavailable.', '無法讀取歷史。')}{' '}
          <button className="text-btn" onClick={() => setRetry(retry + 1)}>
            {t('Retry', '重試')}
          </button>
        </div>
      ) : !items ? (
        <p className="empty-state">{t('Loading history…', '載入歷史中…')}</p>
      ) : items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  t('Observed (UTC)', '量測時間 (UTC)'),
                  t('Metric', '指標'),
                  t('Value', '數值'),
                  t('Source', '來源'),
                  t('Quality', '品質'),
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const metric = metrics.find((m) => m.fields.some((code) => code === row.metricCode))
                const field = row.metricCode.includes('systolic')
                  ? t('Systolic', '收縮壓')
                  : row.metricCode.includes('diastolic')
                    ? t('Diastolic', '舒張壓')
                    : ''
                return (
                  <tr key={row.id}>
                    <td className="history-time"><time>{new Date(row.observedAt).toLocaleTimeString(lang, { timeZone: 'UTC', hour12: false })}</time>
                      <details><summary>{t('Record details', '紀錄詳情')}</summary>
                        <p>{stamp(row.observedAt, lang)} UTC</p><p>{label(row.provenance.source, lang)} · {label(row.quality, lang)}</p>
                        {row.qualityReason && <p>{row.qualityReason}</p>}<code>{row.id}</code>
                        <p>{contextLabels(row.context, lang).join(' · ')}</p>
                        <BreathingDetails record={row} lang={lang} />
                      </details>
                    </td>
                    <td>
                      {metric ? t(metric.en, metric.zh) : row.metricCode}
                      {field && ' · ' + field}
                      {row.provenance.isSynthetic && <span className="simulation-label">{t('Simulation', '模擬資料')}</span>}
                    </td>
                    <td>
                      <b className={typeof row.value === 'object' && row.value ? 'structured-value' : undefined}>{prettyValue(row, true, lang)}</b> {displayUnit(row.unit, row.metricCode)}
                      {row.quality !== 'good' && <span className="history-quality-note">
                        {label(row.quality, lang)}{row.qualityReason && ' · ' + row.qualityReason}
                      </span>}
                    </td>
                    <td>
                      {label(row.provenance.source, lang)}
                      {row.provenance.isSynthetic && ' · ' + label('synthetic', lang)}
                    </td>
                    <td>
                      {label(row.quality, lang)}
                      {row.qualityReason && ' · ' + row.qualityReason}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Database size={21} />
          <span>{t('No measurements recorded', '尚無量測紀錄')}</span>
        </div>
      )}
      {(page || next) && (
        <div className="pager">
          {page && (
            <button className="secondary" onClick={() => openPage('')}>
              {t('Latest measurements', '回到最新量測')}
            </button>
          )}
          {next && (
            <button className="secondary" onClick={() => openPage(next)}>
              {t('Older measurements', '較早量測')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

type CatalogItem = {
  id: string
  code: string
  label: string
  labelEn: string
  category: string
  dataType: string
  unit: string | null
  enabled: boolean
  assessmentForm?: string
  sourceOptions: string[]
}
export function Catalog({ lang, deny }: { lang: Lang; deny: () => void }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  const t = (en: string, zh: string) => tx(lang, en, zh)
  useEffect(() => {
    const controller = new AbortController()
    void api<{ items: CatalogItem[] }>('/catalog', { signal: controller.signal })
      .then((d) => {
        setItems(d.items)
        setError(false)
      })
      .catch((e) => {
        if (controller.signal.aborted) return
        if (restricted(e)) {
          setItems(null)
          deny()
          return
        }
        setError(true)
      })
    return () => controller.abort()
  }, [deny, retry])
  const filtered = items?.filter((i) =>
    [i.id, i.code, i.label, i.labelEn, i.category].join(' ').toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          <Activity size={18} />
          {t('Health metrics', '健康指標')}
        </h2>
        <input
          className="catalog-search"
          aria-label={t('Filter metrics', '篩選指標')}
          placeholder={t('Find a metric…', '尋找指標…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error ? (
        <div className="empty-state" role="alert">
          {t('Catalog unavailable.', '無法讀取目錄。')}
          <button className="text-btn" onClick={() => setRetry(retry + 1)}>
            {t('Retry', '重試')}
          </button>
        </div>
      ) : !filtered?.length ? (
        <p className="empty-state">
          {items ? t('No matching metrics', '無符合指標') : t('Loading catalog…', '載入目錄中…')}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  'ID',
                  t('Metric', '指標'),
                  t('Category', '分類'),
                  t('Data type', '型態'),
                  t('Unit', '單位'),
                  t('Sources', '輸入來源'),
                  t('Availability', '開放狀態'),
                ].map((v) => (
                  <th key={v}>{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td>{i.id}</td>
                  <td>{t(i.labelEn, i.label)}</td>
                  <td>{label(i.category, lang)}</td>
                  <td>{i.dataType}</td>
                  <td>{i.unit ? displayUnit(i.unit, i.code) : '—'}</td>
                  <td>{i.sourceOptions.map((s) => label(s, lang)).join(' · ')}</td>
                  <td>{i.enabled ? t('Enabled', '已開放') : i.assessmentForm === 'news2' ? t('NEWS2 assessment', 'NEWS2 評估表單') : t('Planned', '規劃中')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
