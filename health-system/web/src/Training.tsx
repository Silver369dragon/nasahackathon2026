import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Award, Bell, Bike, CalendarDays, Check, Circle, ClipboardList, HeartPulse,
  LockKeyhole, Moon, Play, Timer, UsersRound,
} from 'lucide-react'
import { api, ApiError, newId, restricted } from './api'
import { stamp, tx, type Lang, type Session } from './domain'
import { isActiveReminder, newTaskReminders } from './trainingReminders'
import './training.css'

type Activity = 'cycle' | 'resistance' | 'treadmill'
type Rating = 'good' | 'fatigued' | 'unwell'
type Task = {
  id: string; date: string; kind: 'exercise' | 'measurement' | 'self_check'
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'exempt'
  version: number; dueAt: string; activity: Activity | null; startedAt: string | null
  completedAt: string | null; remindedAt: string | null; snoozedUntil: string | null
  overdue: boolean; reminderActive: boolean
  evidence: {
    activity?: Activity; durationSeconds?: number; source?: 'timer' | 'manual'; rating?: Rating
    note?: string; reason?: string; measurementIds?: string[]; replacesTaskId?: string
  } | null
}
type Counts = { completed: number; pending: number; skipped: number; exempt: number }
type TeamDay = Counts & { date: string }
type BadgeCode = 'first_exercise' | 'exercise_3_days' | 'exercise_7_days'
type Plan = {
  date: string; timezone: string; items: Task[]
  history: (TeamDay & { exerciseCompleted: boolean })[]
  badges: { code: BadgeCode; awardedAt: string; qualifyingRecordId: string }[]
}
type Action = {
  action: 'start' | 'complete' | 'skip' | 'snooze'; activity?: Activity; durationMinutes?: number
  rating?: Rating; note?: string; reason?: string
}
type CommonProps = { lang: Lang; deny: () => void; refreshToken: string | number }
type T = (en: string, zh: string) => string
const activities: Activity[] = ['cycle', 'resistance', 'treadmill']
const ratings: Rating[] = ['good', 'fatigued', 'unwell']
const countKeys: (keyof Counts)[] = ['completed', 'pending', 'skipped', 'exempt']
const badges: BadgeCode[] = ['first_exercise', 'exercise_3_days', 'exercise_7_days']
const names = {
  exercise: ['Exercise', '運動訓練'], measurement: ['Measurement', '健康量測'], self_check: ['Daily check-in', '每日自評'],
  pending: ['Pending', '待辦'], in_progress: ['In progress', '進行中'], completed: ['Completed', '已完成'],
  skipped: ['Skipped', '已略過'], exempt: ['Exempt', '已免除'],
  cycle: ['Cycle ergometer', '自行車測功儀'], resistance: ['Resistance training', '阻力訓練'], treadmill: ['Treadmill', '跑步機'],
  good: ['Good', '良好'], fatigued: ['Fatigued', '疲憊'], unwell: ['Unwell', '不適'],
  first_exercise: ['First exercise', '首次完成運動'], exercise_3_days: ['3 training days', '累積訓練 3 天'],
  exercise_7_days: ['7 training days', '累積訓練 7 天'],
} as const
function label(t: T, code: keyof typeof names) {
  const [en, zh] = names[code]
  return t(en, zh)
}

function useTrainingData<D>(path: string, refreshToken: string | number, deny: () => void) {
  const [data, setData] = useState<D | null>(null)
  const [failed, setFailed] = useState(false)
  const active = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    try {
      const result = await api<D>(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
      if (!controller.signal.aborted) {
        setData(result)
        setFailed(false)
      }
    } catch (err) {
      if (controller.signal.aborted) return
      if (restricted(err)) { deny(); return }
      setFailed(true)
    }
  }, [path, deny])
  useEffect(() => {
    void reload()
    const onVisible = () => { if (!document.hidden) void reload() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', reload)
    window.addEventListener('focus', onVisible)
    return () => {
      active.current?.abort()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', reload)
      window.removeEventListener('focus', onVisible)
    }
  }, [reload, refreshToken])
  return { data, failed, reload }
}

function LoadNotice({ failed, reload, t }: { failed: boolean; reload: () => void; t: T }) {
  return <p role="status" className="training-load">{failed
    ? <>{t('Could not update tasks.', '無法更新任務。')} <button className="text-btn" onClick={reload}>{t('Retry', '重試')}</button></>
    : t('Loading tasks…', '正在載入任務…')}</p>
}

function useDesktopReminders(plan: Plan | null, username: string, lang: Lang) {
  const fallback = useRef<Record<string, string>>({})
  useEffect(() => {
    if (!plan) return
    const storageKey = 'orbital.task-reminders.' + username
    let previous = fallback.current
    try {
      const entry = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (entry?.date === plan.date && typeof entry.seen === 'object' && entry.seen) {
        previous = { ...previous }
        for (const [key, value] of Object.entries(entry.seen)) {
          if (typeof value === 'string' && (!previous[key] || Date.parse(value) > Date.parse(previous[key]))) previous[key] = value
        }
      }
    } catch { /* Use the in-memory record when storage is unavailable. */ }
    const { seen, desktop } = newTaskReminders(plan.items, previous, {
      hidden: document.hidden, permission: 'Notification' in window ? Notification.permission : null,
    })
    fallback.current = Object.fromEntries(Object.entries(seen).filter(([key]) => key.startsWith(plan.date + '/')))
    try { localStorage.setItem(storageKey, JSON.stringify({ date: plan.date, seen: fallback.current })) } catch { /* In-memory fallback. */ }
    for (const task of desktop) {
      try {
        new Notification(tx(lang, 'Orbital · Task reminder', 'Orbital · 任務提醒'), {
          body: tx(lang, names[task.kind][0], names[task.kind][1]), tag: 'orbital-task-' + username + '-' + task.kind + '-' + task.remindedAt,
        })
      } catch { /* The in-app reminder is available on browsers without desktop delivery. */ }
    }
  }, [plan, username, lang])
}

function Progress({ plan, lang }: { plan: Plan; lang: Lang }) {
  const t: T = (en, zh) => tx(lang, en, zh)
  const dayFormat = new Intl.DateTimeFormat(lang, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  return <div className="training-progress">
    <section className="panel training-history" data-testid="task-week">
      <h3><CalendarDays size={17}/>{t('Last seven days', '最近七天')}</h3>
      <p className="training-caption">{t('Completed / scheduled tasks · UTC', '已完成／已安排任務數 · UTC')}</p>
      <ol>{plan.history.map(day => {
        const total = countKeys.reduce((sum, key) => sum + day[key], 0)
        const activity = day.exerciseCompleted ? t('Exercise completed', '已完成運動') : t('No completed exercise', '未完成運動')
        return <li key={day.date} className={day.exerciseCompleted ? 'trained' : ''}>
          <time dateTime={day.date}>{dayFormat.format(new Date(day.date + 'T12:00:00Z'))}</time>
          <span className="training-day-icon" role="img" aria-label={activity} title={activity}>{day.exerciseCompleted ? <Check size={15}/> : <Circle size={12}/>}</span>
          <span>{day.completed}/{total}</span>
        </li>
      })}</ol>
      <p className="training-legend"><Check size={13}/>{t('Exercise completed', '當日已完成運動')}</p>
    </section>
    <section className="panel training-badges" data-testid="task-badges">
      <h3><Award size={18}/>{t('Exercise badges', '運動徽章')}</h3>
      <ul>{badges.map(code => {
        const earned = plan.badges.find(award => award.code === code)
        return <li className={earned ? 'awarded' : ''} key={code}>
          {earned ? <Award size={17}/> : <LockKeyhole size={15}/>}
          <span>{label(t, code)}</span><small>{earned ? stamp(earned.awardedAt, lang) : t('Locked', '未取得')}</small>
        </li>
      })}</ul>
    </section>
  </div>
}

export function PersonalTraining({ lang, session, refreshToken, deny, showTasks, goMeasure }: CommonProps & {
  session: Session; showTasks: boolean; goMeasure: () => void
}) {
  const { data: plan, failed, reload } = useTrainingData<Plan>('/tasks', refreshToken, deny)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState<'conflict' | 'rejected' | 'unknown' | null>(null)
  const running = useRef(false)
  const lastCommand = useRef<{ key: string; id: string } | null>(null)
  useDesktopReminders(plan, session.username, lang)
  const t: T = (en, zh) => tx(lang, en, zh)
  async function run(task: Task, action: Action) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setIssue(null)
    const key = JSON.stringify([task.id, task.version, action])
    if (lastCommand.current?.key !== key) lastCommand.current = { key, id: newId() }
    try {
      await api('/tasks/' + encodeURIComponent(task.id) + '/actions', {
        token: session.csrfToken, body: { ...action, commandId: lastCommand.current.id, expectedVersion: task.version },
        signal: AbortSignal.timeout(12000),
      })
      lastCommand.current = null
      await reload()
    } catch (err) {
      if (restricted(err)) { deny(); return }
      if (err instanceof ApiError && err.status === 409) {
        setIssue('conflict')
        await reload()
      } else {
        setIssue(err instanceof ApiError && err.status < 500 ? 'rejected' : 'unknown')
        await reload()
      }
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const active = plan?.items.filter(isActiveReminder) ?? []
  return <>
    {active.length > 0 && <section className="training-reminders" data-testid="training-reminders">
      <h2><Bell size={17}/>{t('Task reminders', '任務提醒')}</h2>
      <ul aria-live="polite">{active.map(task => <li key={task.kind + task.remindedAt}>
        <span>{label(t, task.kind)} · {t('Due', '截止')} {stamp(task.dueAt, lang)}</span>
        <button className="secondary" disabled={busy} onClick={() => run(task, { action: 'snooze' })}>
          <Moon size={13}/>{t('Snooze 15 min', '延後 15 分鐘')}</button>
      </li>)}</ul>
    </section>}
    {issue && <p role="alert" className="notice">{issue === 'conflict'
      ? t('This task changed. Check its latest status.', '任務狀態已變更，請確認最新進度。')
      : issue === 'rejected' ? t('Check the task details and try again.', '請檢查任務內容並重試。')
        : t('Could not confirm the change. Check the task and retry if needed.', '尚未確認是否儲存，請檢查任務狀態並視需要重試。')}</p>}
    {showTasks && <section className="training-plan" data-testid="personal-training">
      <div className="section-title"><ClipboardList size={19}/><h2>{t("Today's tasks", '今日任務')}</h2>
        {plan && <time dateTime={plan.date}>{plan.date} {plan.timezone}</time>}</div>
      {(failed || !plan) && <LoadNotice failed={failed} reload={reload} t={t}/>}
      {plan && <>
        <div className="training-grid">{plan.items.map(task => <TaskCard key={task.id} task={task} lang={lang}
          locked={busy} run={run} goMeasure={goMeasure}/>)}</div>
        <Progress plan={plan} lang={lang}/>
      </>}
    </section>}
  </>
}

export function TeamTraining({ lang, deny, refreshToken }: CommonProps) {
  const { data, failed, reload } = useTrainingData<TeamDay>('/tasks/team', refreshToken, deny)
  const t: T = (en, zh) => tx(lang, en, zh)
  return <section className="training-team" data-testid="team-training">
    <div className="section-title"><UsersRound size={19}/><h2>{t('Team tasks today', '今日團隊任務')}</h2>
      {data && <time dateTime={data.date}>{data.date} UTC</time>}</div>
    {(failed || !data) && <LoadNotice failed={failed} reload={reload} t={t}/>}
    {data && <dl className="panel training-counts">{countKeys.map(key =>
      <div key={key}><dt>{label(t, key)}</dt><dd data-testid={'team-task-' + key}>{data[key]}</dd></div>)}</dl>}
  </section>
}

function TimerReadout({ startedAt, t }: { startedAt: string; t: T }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  return <div className="training-clock"><Timer size={15}/>{t('Elapsed', '已計時')}
    <span role="timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
  </div>
}

type CardProps = {
  task: Task; lang: Lang; locked: boolean; goMeasure: () => void
  run: (task: Task, action: Action) => void
}
function TaskCard({ task, lang, locked, run, goMeasure }: CardProps) {
  const t: T = (en, zh) => tx(lang, en, zh)
  const [activity, setActivity] = useState<Activity>(task.activity ?? 'cycle')
  const [manual, setManual] = useState(false)
  const [duration, setDuration] = useState('')
  const [rating, setRating] = useState<Rating | ''>('')
  const [note, setNote] = useState('')
  const [skip, setSkip] = useState(false)
  const [reason, setReason] = useState('')
  const open = task.status === 'pending' || task.status === 'in_progress'
  const started = task.status === 'in_progress'
  const Icon = { exercise: Bike, measurement: HeartPulse, self_check: ClipboardList }[task.kind]
  const evidence = task.evidence
  return <article className="panel training-task" data-testid={'task-' + task.kind}>
    <header><div className="training-symbol"><Icon size={19}/></div>
      <h3>{label(t, task.kind)}</h3><span className={'training-status ' + task.status}>{label(t, task.status)}</span>
    </header>
    <p className="training-due">{t('Due', '截止')} <time dateTime={task.dueAt}>{stamp(task.dueAt, lang)}</time></p>
    {task.snoozedUntil && open && !task.reminderActive && <p className="training-detail">{t('Reminder deferred until', '提醒已延後至')} {stamp(task.snoozedUntil, lang)}</p>}
    {open && <fieldset className="training-fields" disabled={locked}>
      {task.kind === 'exercise' && (started ? <>
        {task.activity && <strong>{label(t, task.activity)}</strong>}
        {task.startedAt && <TimerReadout startedAt={task.startedAt} t={t}/>}
        <button className="primary" onClick={() => run(task, { action: 'complete' })}>
          <Check size={15}/>{t('Finish exercise', '結束並記錄運動')}</button>
      </> : <>
        {task.activity && <p className="training-detail">{t('Scheduled activity', '今日安排')} · <strong>{label(t, task.activity)}</strong></p>}
        <label>{t('Approved activity', '核准運動項目')}
          <select value={activity} onChange={e => setActivity(e.target.value as Activity)}>
            {activities.map(item => <option value={item} key={item}>{label(t, item)}</option>)}
          </select>
        </label>
        {manual ? <form onSubmit={event => {
          event.preventDefault()
          if (Number(duration) > 0) run(task, { action: 'complete', activity, durationMinutes: Number(duration) })
        }}>
          <label>{t('Duration (minutes)', '運動時長（分鐘）')}
            <input required type="number" step="any" max={1440} min={0} value={duration} onChange={e => setDuration(e.target.value)}/>
          </label>
          <button className="primary" disabled={!(Number(duration) > 0)}>{t('Save exercise', '保存運動紀錄')}</button>
        </form> : <button className="primary" onClick={() => run(task, { action: 'start', activity })}>
          <Play size={14}/>{t('Start timer', '開始計時')}</button>}
        <button type="button" className="text-btn" onClick={() => setManual(!manual)}>
          {manual ? t('Use timer', '改用計時') : t('Log exercise manually', '補登運動')}</button>
      </>)}
      {task.kind === 'measurement' && <>
        <p className="training-detail">{t("Save today's measurement to complete this task.", '儲存今日的量測紀錄後，系統會自動更新此任務。')}</p>
        <button className="primary" onClick={goMeasure}>{t('Open measurement form', '開啟量測表單')}</button>
      </>}
      {task.kind === 'self_check' && <form onSubmit={e => {
        e.preventDefault()
        if (rating) run(task, { action: 'complete', rating, note: note.trim() })
      }}>
        <label>{t('How do you feel?', '今天感覺如何？')}
          <select required value={rating} onChange={e => setRating(e.target.value as Rating)}>
            <option value="" disabled>{t('Choose a rating', '選擇狀態')}</option>
            {ratings.map(item => <option key={item} value={item}>{label(t, item)}</option>)}
          </select>
        </label>
        <label>{t('Private note (optional)', '私人附註（選填）')}
          <input maxLength={500} value={note} onChange={e => setNote(e.target.value)}/>
        </label>
        <button className="primary">{t('Save check-in', '儲存自評')}</button>
      </form>}
      {skip ? <form className="training-skip-form" onSubmit={e => {
        e.preventDefault()
        if (reason.trim()) run(task, { action: 'skip', reason: reason.trim() })
      }}>
        <label>{t('Reason for skipping', '略過原因')}<input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label>
        <div className="training-buttons"><button className="secondary" disabled={!reason.trim()}>{t('Confirm skip', '確認略過')}</button>
          <button type="button" className="text-btn" onClick={() => setSkip(false)}>{t('Cancel', '取消')}</button></div>
      </form> : <button className="training-skip text-btn" onClick={() => setSkip(true)}>{t('Skip task', '略過任務')}</button>}
    </fieldset>}
    {!open && <div className="training-record">
      {task.completedAt && <time dateTime={task.completedAt}>{stamp(task.completedAt, lang)}</time>}
      {evidence?.activity && <strong>{label(t, evidence.activity)}</strong>}
      {evidence?.durationSeconds != null && <p>{t('Duration', '時長')} · {Math.floor(Math.round(evidence.durationSeconds) / 60)} {t('min', '分')} {Math.round(evidence.durationSeconds) % 60} {t('sec', '秒')}</p>}
      {evidence?.source && <p>{evidence.source === 'timer' ? t('Timer record', '計時紀錄') : t('Manual entry', '手動補登')}</p>}
      {evidence?.replacesTaskId && <p>{t('Approved alternative', '已採用核准替代項目')}</p>}
      {evidence?.rating && <strong>{label(t, evidence.rating)}</strong>}
      {evidence?.note && <p><LockKeyhole size={13}/> {evidence.note}</p>}
      {evidence?.reason && <p>{t('Reason', '原因')} · {evidence.reason}</p>}
      {!!evidence?.measurementIds?.length && <p>{t('Linked measurements', '已連結量測')} · {evidence.measurementIds.length}</p>}
    </div>}
  </article>
}
