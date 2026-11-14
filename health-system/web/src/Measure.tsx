import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, CircleCheck, ClipboardCheck, ScanLine } from 'lucide-react'
import { api, newId, restricted } from './api'
import {
  localDateTime,
  metrics,
  stamp,
  tx,
  type Lang,
  type Metric,
  type Quality,
  type Session,
} from './domain'
import { contexts, makeCommand, type Draft } from './manual'
import { label } from './labels'
import { metricIcons } from './Readings'

function newDraft(metric: Metric): Draft {
  return {
    values: metric.fields.map(() => ''),
    time: localDateTime(),
    method: 'manual_training_entry',
    context: Object.fromEntries(Object.entries(contexts[metric.code]).map(([key, opts]) => [key, opts[0]])),
    quality: 'good',
    reason: '',
  }
}

export function Measure({
  session,
  lang,
  deny,
  overview,
}: {
  session: Session
  lang: Lang
  deny: () => void
  overview: () => void
}) {
  const [metric, setMetric] = useState<Metric>(metrics[0])
  const [draft, setDraft] = useState<Draft>(() => newDraft(metrics[0]))
  const [command, setCommand] = useState<ReturnType<typeof makeCommand> | null>(null)
  const [ids, setIds] = useState<string[] | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const metricName = t(metric.en, metric.zh)
  const fieldName = (index: number) =>
    metric.code !== 'blood_pressure'
      ? metricName
      : index === 0
        ? t('Systolic', '收縮壓')
        : t('Diastolic', '舒張壓')
  const contextNames: Record<string, string> = {
    activity: t('Activity', '活動情境'),
    posture: t('Posture', '姿勢'),
    measurementSite: t('Measurement site', '量測部位'),
    temperatureType: t('Temperature type', '溫度類型'),
  }
  const change = (next: Metric) => {
    setMetric(next)
    setDraft(newDraft(next))
    setCommand(null)
    setIds(null)
    setError('')
  }
  const review = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      setCommand(makeCommand(metric, session.crewId!, draft, newId))
    } catch (e) {
      const reasons: Record<string, string> = {
        missing_reason: t(
          'Add a reason for the missing or low-quality measurement.',
          '請填寫缺值或品質問題原因。',
        ),
        missing_value: t('Enter a value or select Missing.', '請輸入數值或選擇缺值。'),
        invalid_number: t('Enter a finite number.', '請輸入有限數值。'),
        invalid_time: t('Enter a valid observation time.', '請填寫有效量測時間。'),
        missing_method: t('Enter a measurement method.', '請填寫量測方法。'),
      }
      setError(reasons[(e as Error).message] ?? t('Check the form fields.', '請檢查欄位。'))
    }
  }
  async function save() {
    if (!command || sending) return
    setSending(true)
    setError('')
    try {
      const accepted = await api<{ measurementIds: string[] }>('/manual-measurements', {
        body: command,
        token: session.csrfToken,
      })
      setIds(accepted.measurementIds)
    } catch (e) {
      if (restricted(e)) {
        deny()
        return
      }
      setError(
        t('Save could not be confirmed. Retry this measurement. ', '尚未確認保存結果，請重試本筆量測。') +
          (e as Error).message,
      )
    } finally {
      setSending(false)
    }
  }
  const unusualOrder =
    metric.code === 'blood_pressure' &&
    draft.values.every(Boolean) &&
    Number(draft.values[0]) <= Number(draft.values[1])
  const needReason =
    draft.quality !== 'good' ||
    (metric.code === 'blood_pressure' && draft.values.some(Boolean) && draft.values.some((v) => !v))
  if (ids)
    return (
      <section className="panel saved-panel" role="status">
        <CircleCheck size={34} />
        <h2>{t('Measurement saved', '量測已保存')}</h2>
        <p>{t('Measurement IDs', '量測識別碼')}</p>
        <div className="saved-ids">
          {ids.map((id) => (
            <code key={id}>{id}</code>
          ))}
        </div>
        <div className="actions">
          <button className="primary" onClick={overview}>
            {t('View overview', '查看總覽')}
            <ArrowRight size={16} />
          </button>
          <button className="secondary" onClick={() => change(metric)}>
            {t('Record another', '新增下一筆')}
          </button>
        </div>
      </section>
    )
  if (command)
    return (
      <section className="panel form-panel">
        <div className="panel-head">
          <h2>
            <ClipboardCheck size={19} />
            {t('Review measurement', '檢查量測')}
          </h2>
        </div>
        <div className="form-body">
          <dl className="review-list">
            <div>
              <dt>{t('Crew member', '船員')}</dt>
              <dd>{session.crewId}</dd>
            </div>
            {command.metrics.map((row, i) => (
              <div key={row.code}>
                <dt>{fieldName(i)}</dt>
                <dd>
                  {row.value ?? '—'} {metric.unit} · {label(row.quality, lang)}
                </dd>
              </div>
            ))}
            <div>
              <dt>{t('Observed (UTC)', '量測時間 (UTC)')}</dt>
              <dd>{stamp(command.observedAt, lang)}</dd>
            </div>
            <div>
              <dt>{t('Source', '來源')}</dt>
              <dd>
                {label('manual', lang)} · {label('synthetic', lang)}
              </dd>
            </div>
            <div>
              <dt>{t('Method', '方法')}</dt>
              <dd>{label(command.method, lang)}</dd>
            </div>
            {Object.entries(draft.context).map(([k, v]) => (
              <div key={k}>
                <dt>{contextNames[k]}</dt>
                <dd>{label(v, lang)}</dd>
              </div>
            ))}
            {needReason && (
              <div>
                <dt>{t('Reason', '原因')}</dt>
                <dd>{draft.reason}</dd>
              </div>
            )}
          </dl>
          {unusualOrder && (
            <p className="notice">
              {t('Check the order of the systolic and diastolic readings.', '請核對收縮壓與舒張壓次序。')}
            </p>
          )}
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              className="secondary"
              disabled={sending}
              onClick={() => {
                setCommand(null)
                setError('')
              }}
            >
              <ArrowLeft size={15} />
              {t('Edit', '修改')}
            </button>
            <button className="primary" disabled={sending} onClick={save}>
              {sending ? t('Saving…', '保存中…') : t('Save measurement', '保存量測')}
              <Check size={16} />
            </button>
          </div>
        </div>
      </section>
    )
  return (
    <div className="measure-layout">
      <section className="panel">
        <div className="panel-head">
          <h2>
            <ScanLine size={18} />
            {t('Select a metric', '選擇指標')}
          </h2>
        </div>
        <div className="metric-choices">
          {metrics.map((m) => {
            const Icon = metricIcons[m.code]
            return (
              <button
                key={m.code}
                aria-pressed={m.code === metric.code}
                className={m.code === metric.code ? 'selected' : ''}
                onClick={() => {
                  if (m.code !== metric.code) change(m)
                }}
              >
                <Icon size={18} />
                {t(m.en, m.zh)}
                {m.code === metric.code && <Check size={15} />}
              </button>
            )
          })}
        </div>
      </section>
      <section className="panel form-panel">
        <div className="panel-head">
          <h2>{metricName}</h2>
          <span className="micro">{label('manual', lang)}</span>
        </div>
        <form className="form-body" onSubmit={review}>
          <p className="form-intro">
            {t(
              'Confirm the reading and its observation time before saving.',
              '保存前請確認儀器讀值與量測時間。',
            )}
          </p>
          <div className="fields">
            {metric.fields.map((code, i) => (
              <label key={code}>
                {fieldName(i)}
                <div className="unit-input">
                  <input
                    aria-label={fieldName(i)}
                    type="number"
                    step="any"
                    value={draft.values[i]}
                    disabled={draft.quality === 'missing'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        values: draft.values.map((v, n) => (n === i ? e.target.value : v)),
                      })
                    }
                  />
                  <span>{metric.unit}</span>
                </div>
              </label>
            ))}
            <label>
              {t('Observed time (local)', '量測時間（本機）')}
              <input
                type="datetime-local"
                step="1"
                required
                value={draft.time}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })}
              />
            </label>
            <label>
              {t('Method', '方法')}
              <input
                required
                value={draft.method}
                onChange={(e) => setDraft({ ...draft, method: e.target.value })}
              />
            </label>
            {Object.entries(contexts[metric.code]).map(([key, opts]) => (
              <label key={key}>
                {contextNames[key]}
                <select
                  value={draft.context[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, context: { ...draft.context, [key]: e.target.value } })
                  }
                >
                  {opts.map((v: string) => (
                    <option value={v} key={v}>
                      {label(v, lang)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              {t('Quality', '品質')}
              <select
                value={draft.quality}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    quality: e.target.value as Quality,
                    values: e.target.value === 'missing' ? metric.fields.map(() => '') : draft.values,
                  })
                }
              >
                {['good', 'poor', 'invalid', 'missing'].map((q) => (
                  <option key={q} value={q}>
                    {label(q, lang)}
                  </option>
                ))}
              </select>
            </label>
            {needReason && (
              <label className="wide">
                {t('Quality or missing reason', '品質或缺值原因')}
                <input
                  required
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                />
              </label>
            )}
          </div>
          <p className="check-line">
            {t('Source · Manual, synthetic training data', '來源 · 人工輸入的合成訓練資料')}
          </p>
          {unusualOrder && (
            <p className="notice">
              {t('Check the order of the systolic and diastolic readings.', '請核對收縮壓與舒張壓次序。')}
            </p>
          )}
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button className="primary">
              {t('Review measurement', '檢查量測')}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
