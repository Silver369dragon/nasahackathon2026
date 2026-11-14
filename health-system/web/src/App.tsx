import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  Earth,
  Eye,
  EyeOff,
  Globe2,
  Grid2X2,
  HeartPulse,
  History as HistoryIcon,
  Layers3,
  LayoutDashboard,
  MessageCircle,
  BookHeart,
  LifeBuoy,
  LogOut,
  Maximize,
  Orbit,
  PanelTop,
  Plus,
  Radio,
  Satellite,
  ShieldCheck,
  WifiOff,
} from 'lucide-react'
import { api, restricted, stationBase } from './api'
import { canView, home, metrics, tx, type Emergency, type Lang, type Session, type View } from './domain'
import { Catalog, CrewBoard, History, Reading } from './Readings'
import { Measure } from './Measure'
import { label } from './labels'
import { useFeed } from './useFeed'
import { DesktopNoticeOptIn, desktopNotice, EmergencyNotices } from './EmergencyNotices'
import { clearSavedHelp, useHelp } from './useHelp'
import { PersonalTraining, TeamTraining } from './Training'
import { FirstAid } from './FirstAid'
import { Chat } from './Chat'
import { Trends } from './Trends'
import { AssessmentStatus, News2 } from './AssessmentForm'
import { BodyOverview } from './BodyOverview'
import './style.css'

const BodyMap = lazy(() => import('./BodyMap'))

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Orbit size={27} strokeWidth={1.85} />
      </span>
      <span>
        Orbital<span className="brand-sub">CREW HEALTH</span>
      </span>
    </div>
  )
}
function Language({ lang, change }: { lang: Lang; change: () => void }) {
  return (
    <button
      className="language"
      aria-label={tx(lang, '切換至繁體中文', 'Switch to English')}
      onClick={change}
    >
      <Globe2 size={15} />
      {lang === 'en' ? '繁中' : 'English'}
    </button>
  )
}
function OrbitArt() {
  return (
    <div className="orbit-art" aria-hidden="true">
      <div className="orbit-path path-a" />
      <div className="orbit-path path-b" />
      <div className="planet" />
      <div className="orbiter" />
    </div>
  )
}
function Login({
  lang,
  toggleLang,
  success,
  expired,
}: {
  lang: Lang
  toggleLang: () => void
  success: (s: Session) => void
  expired: boolean
}) {
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const t = (en: string, zh: string) => tx(lang, en, zh)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      success(await api<Session>('/auth/login', { body: { username: name.trim(), password: pass } }))
    } catch (err) {
      setError(
        restricted(err)
          ? t('Check your username and password.', '請檢查帳號與密碼。')
          : t('The local server is unavailable. Try again.', '本機伺服器無法連線，請再試一次。'),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="login">
      <section className="login-art">
        <Brand />
        <OrbitArt />
        <div className="login-copy">
          <div className="kicker dark-kicker">
            <span />
            {t('Onboard operations', '船內作業')}
          </div>
          <h1>
            {t('Crew health', '船員健康')}
            <br />
            <em>{t('console', '監測台')}</em>
          </h1>
          <p>
            {t(
              'Record vital signs and monitor crew measurements on the local spacecraft network.',
              '透過船內網路記錄生命徵象，查看船員的量測資料。',
            )}
          </p>
        </div>
        <div className="login-art-foot">
          <Satellite size={16} />
          {t('Local mission workspace', '船內任務工作區')}
        </div>
      </section>
      <section className="login-pane">
        <div className="login-top">
          <Language lang={lang} change={toggleLang} />
        </div>
        <div className="login-form">
          <div className="form-emblem">
            <ShieldCheck size={26} />
          </div>
          <h2>{t('Sign in', '登入')}</h2>
          <p>{t('Use your local crew or duty station account.', '請使用船員或值勤站的本機帳號。')}</p>
          <form onSubmit={submit}>
            <label>
              {t('Username', '帳號')}
              <input
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              {t('Password', '密碼')}
              <span className="password-field">
                <input
                  aria-label={t('Password', '密碼')}
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={show ? t('Hide password', '隱藏密碼') : t('Show password', '顯示密碼')}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            {(error || expired) && (
              <p role="alert" className="notice">
                {error || t('Session access changed. Sign in again.', '授權已變更，請重新登入。')}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? t('Signing in…', '登入中…') : t('Sign in', '登入')}
              <ArrowRight size={17} />
            </button>
          </form>
          <details className="demo-accounts">
            <summary>{t('Demo accounts', '示範帳號')}</summary>
            <p>
              {t('Crew', '船員')} · mira / kai / lin / noa / sol
              <br />
              {t('Duty stations', '值勤站')} · monitor / display
              <br />
              {t('Default demo password', '預設示範密碼')} · <code>orbital-demo</code>
            </p>
          </details>
        </div>
      </section>
    </div>
  )
}

const paths = {
  personal: '/app/overview',
  body: '/app/body-map',
  measure: '/app/measure',
  history: '/app/history',
  trends: '/app/trends',
  assessment: '/app/news2',
  catalog: '/app/catalog',
  tasks: '/app/tasks',
  chat: '/app/assistant',
  aid: '/app/first-aid',
  system: '/system/overview',
  systemCatalog: '/system/catalog',
  board: '/board',
}
function utcClock() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date())
}
function Clock() {
  const [time, setTime] = useState(utcClock)
  useEffect(() => {
    const id = setInterval(() => setTime(utcClock()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="clock">
      <Clock3 size={14} />
      {time} UTC
    </span>
  )
}
type ShellProps = {
  lang: Lang
  toggleLang: () => void
  path: string
  navigate: (p: string) => void
  session: Session
  deny: () => void
  logout: () => Promise<void>
}
function Console({
  lang,
  toggleLang,
  path,
  navigate,
  session,
  deny,
  logout,
  view,
}: ShellProps & { view: View }) {
  const onEmergency = useCallback((item: Emergency) => desktopNotice(item, session.crewId,
    document.documentElement.lang === 'zh-TW' ? 'zh-TW' : 'en'), [session.crewId])
  const feed = useFeed(view, deny, onEmergency)
  const [logoutError, setLogoutError] = useState(false)
  const [chatAssessment, setChatAssessment] = useState<string | undefined>()
  const isBoard = view === 'system_display'
  const personal = view === 'personal'
  const connected = feed.status === 'connected'
  const help = useHelp(session, connected && personal, deny)
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const reference = path.startsWith('/system/crew/')
    ? decodeURIComponent(path.slice('/system/crew/'.length))
    : session.crewId
  const crew = feed.rows.find((row) => row.crewId === reference)
  const detail = path.startsWith('/system/crew/')
  const aidPage = path === paths.aid || path.startsWith(paths.aid + '/')
  const nav = [
    ...(session.roles.includes('crew') && session.crewId
      ? [
          { path: paths.personal, text: t('Overview', '個人總覽'), Icon: LayoutDashboard },
          { path: paths.body, text: t('Body hologram', '身體全息圖'), Icon: Layers3 },
          { path: paths.tasks, text: t('Daily training', '每日訓練'), Icon: Activity },
          { path: paths.chat, text: t('Health assistant', '健康助手'), Icon: MessageCircle },
          { path: paths.aid, text: t('First aid', '急救指引'), Icon: BookHeart },
          { path: paths.measure, text: t('Record measurement', '新增量測'), Icon: HeartPulse },
          { path: paths.assessment, text: t('NEWS2 assessment', 'NEWS2 健康評估'), Icon: HeartPulse },
          { path: paths.trends, text: t('Personal health trends', '個人健康趨勢'), Icon: Activity },
          { path: paths.history, text: t('Measurement history', '量測歷史'), Icon: HistoryIcon },
        ]
      : []),
    ...(session.roles.includes('monitor')
      ? [
          { path: paths.system, text: t('Crew overview', '全員總覽'), Icon: LayoutDashboard },
          { path: paths.board, text: t('Display board', '大螢幕'), Icon: PanelTop },
        ]
      : []),
    ...(!isBoard
      ? [
          {
            path: personal ? paths.catalog : paths.systemCatalog,
            text: t('Metric catalog', '指標目錄'),
            Icon: BookOpen,
          },
        ]
      : []),
  ]
  const where =
    nav.find((n) => n.path === (aidPage ? paths.aid : path))?.text ??
    (detail ? t('Crew detail', '船員詳情') : t('Display board', '大螢幕'))
  const title =
    path === paths.personal
      ? t('Health overview', '健康總覽')
      : detail
        ? (crew?.name ?? t('Crew detail', '船員詳情'))
        : where
  const scopeName = personal
    ? t('Personal station', '個人值勤站')
    : isBoard
      ? t('Read-only display', '唯讀大螢幕')
      : t('Monitoring station', '監測值勤站')
  const signOut = () => {
    void logout().catch(() => setLogoutError(true))
  }
  const overview = path === paths.personal || path === paths.system || isBoard
  const withData = feed.rows.filter((r) => r.metricCards.some((c) => c.latest !== null)).length
  const go = (p: string) => {
    if (p !== paths.chat) setChatAssessment(undefined)
    navigate(p)
    window.scrollTo({ top: 0 })
  }
  return (
    <div className={'workspace' + (isBoard ? ' board' : '')}>
      {!isBoard && (
        <aside className="rail">
          <Brand />
          <div className="rail-section">{t('Workspace', '工作區')}</div>
          <nav aria-label={t('Workspace navigation', '工作區導覽')}>
            {nav.map(({ path: dest, text, Icon }) => (
              <a
                href={stationBase + dest}
                key={dest}
                className={dest === path || (detail && dest === paths.system) ? 'active' : ''}
                aria-current={dest === path ? 'page' : undefined}
                onClick={(e) => {
                  if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    go(dest)
                  }
                }}
              >
                <Icon size={17} />
                {text}
              </a>
            ))}
          </nav>
          <div className="rail-bottom">
            <div className="station-label">
              <Satellite size={19} />
              <div>
                {t('Onboard network', '船內網路')}
                <small>{t('Local workspace', '本機工作區')}</small>
              </div>
            </div>
            {!stationBase && <button className="logout" onClick={signOut}>
              <LogOut size={16} />
              {t('Sign out', '登出')}
            </button>}
          </div>
        </aside>
      )}
      <div className="main-shell">
        <header className="topbar">
          {isBoard ? (
            <Brand />
          ) : (
            <div className="breadcrumb">
              <Layers3 size={15} />
              {scopeName}
              <ChevronRight size={13} />
              <b>{where}</b>
            </div>
          )}
          <div className="top-actions">
            <Clock />
            <Language lang={lang} change={toggleLang} />
            {isBoard && (
              <>
                <button
                  className="icon-btn"
                  aria-label={t('Toggle full screen', '切換全螢幕')}
                  onClick={() => {
                    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
                    else void document.documentElement.requestFullscreen().catch(() => {})
                  }}
                >
                  <Maximize size={17} />
                </button>
                {session.roles.includes('monitor') && (
                  <button
                    className="icon-btn"
                    aria-label={t('Crew overview', '全員總覽')}
                    onClick={() => go(paths.system)}
                  >
                    <LayoutDashboard size={17} />
                  </button>
                )}
                {!stationBase && <button className="icon-btn" aria-label={t('Sign out', '登出')} onClick={signOut}>
                  <LogOut size={17} />
                </button>}
              </>
            )}
          </div>
        </header>
        <main className="content">
          <div className="scope-line">
            <span>
              <CircleDot size={14} />
              {scopeName}
              <b className="training-mode">
                {session.mode && session.mode !== 'training' ? session.mode : t('Training', '訓練模式')}
              </b>
            </span>
            <span className={'connection ' + feed.status}>
              {feed.status === 'offline' ? <WifiOff size={13} /> : <Radio size={13} />}
              {label(feed.status, lang)}
            </span>
          </div>
          {logoutError && (
            <p role="alert" className="notice">
              {t('Sign out could not be confirmed. Try again.', '尚未確認登出結果，請再試一次。')}
            </p>
          )}
          {feed.status === 'offline' && (
            <p role="status" className="notice">
              {t('Reconnecting to the local server.', '正在重新連線至本機伺服器。')}
              {feed.syncedAt &&
                ' ' + t('Last sync', '最後同步') + ' ' + new Date(feed.syncedAt).toLocaleTimeString(lang)}
            </p>
          )}
          <EmergencyNotices items={feed.emergencies} lang={lang} username={session.username} crewId={session.crewId}/>
          {detail && (
            <button className="back" onClick={() => go(paths.system)}>
              <ArrowLeft size={14} />
              {t('Crew overview', '全員總覽')}
            </button>
          )}
          {path !== paths.body && <div className={'page-title' + (overview && !isBoard ? ' page-hero' : '')}>
            {overview && !isBoard && <OrbitArt />}
            <div>
              <div className="kicker">
                <span />
                {personal ? session.username : t('Crew operations', '船員作業')}
              </div>
              <h1>{title}</h1>
              {overview && !isBoard && (
                <p>
                  {personal
                    ? t('Latest vital signs and measurement quality.', '查看最近的生命徵象與量測品質。')
                    : t('Latest vital signs across the onboard crew.', '查看全體船員最近的生命徵象。')}
                </p>
              )}
            </div>
            {path === paths.personal && (
              <div className="hero-actions">
                <button className="hero-btn" onClick={() => go(paths.measure)}>
                  <Plus size={17}/>{t('Record measurement', '新增量測')}
                </button>
                <button className="hero-btn" onClick={() => go(paths.aid)}>
                  <BookHeart size={17}/>{t('First aid', '急救指引')}
                </button>
                <button className="hero-btn help-hero" data-testid="request-help" disabled={help.sending || (help.pending && !connected)}
                  onClick={event => { if (event.detail < 2) help.request() }}>
                  <LifeBuoy size={17}/>{help.pending ? t('Retry help request', '重送求助通知') : t('Request help', '緊急求助')}
                </button>
              </div>
            )}
          </div>}
          {path === paths.personal && <BodyOverview key={session.username} lang={lang} deny={deny} open={() => go(paths.body)} />}
          {path === paths.personal && help.status === 'sent' && <p className="help-sent" data-testid="help-sent" role="status">
            <CheckCircle2 size={17}/>{t('Help request sent to the crew.', '緊急求助通知已發出。')}</p>}
          {path === paths.personal && help.status === 'queued' && <p className="notice" role="status">
            {t('Your help request will be sent when the connection returns.', '求助通知已暫存，恢復連線後會送出。')}</p>}
          {path === paths.personal && help.status === 'unknown' && <p className="notice" role="status">
            {t('Delivery is unconfirmed. Retry to check or send the same request.', '尚未確認送達。重新送出會查核同一筆求助。')}</p>}
          {path === paths.personal && help.status === 'rejected' && <p className="notice" role="alert">
            {t('The server could not accept the request. Try again.', '伺服器未受理求助，請再試一次。')}</p>}
          {personal && path !== paths.body && <PersonalTraining session={session} lang={lang} deny={deny} refreshToken={feed.trainingRevision}
            showTasks={path === paths.personal || path === paths.tasks} goMeasure={() => go(paths.measure)} />}
          {path === paths.body ? (
            <Suspense fallback={<div className="panel empty-state">{t('Loading body view…', '正在載入人體檢視…')}</div>}>
              <BodyMap key={session.username + session.csrfToken} session={session} lang={lang} deny={deny} back={() => go(paths.personal)} />
            </Suspense>
          ) : path === paths.assessment ? (
            <News2 session={session} lang={lang} deny={deny} assessmentRevision={feed.assessmentRevision}
              revision={feed.historyRevision[session.username]} measure={() => go(paths.measure)}
              ask={id => { setChatAssessment(id); go(paths.chat) }}/>
          ) : path === paths.trends ? (
            <Trends lang={lang} deny={deny} revision={feed.historyRevision[session.username]}/>
          ) : path === paths.tasks ? null : path === paths.chat ? (
            <Chat session={session} lang={lang} deny={deny} assessmentId={chatAssessment} clearAssessment={() => setChatAssessment(undefined)}
              openAid={id => go(id === 'first-aid' ? paths.aid : paths.aid + '/' + id)} />
          ) : aidPage ? (
            <FirstAid key={path} lang={lang} initialId={path.split('/')[3]} onDenied={deny}
              onHelp={help.request} helpStatus={help.status} />
          ) : path === paths.measure ? (
            <Measure session={session} lang={lang} deny={deny} overview={() => go(paths.personal)} />
          ) : path.endsWith('/catalog') ? (
            <Catalog lang={lang} deny={deny} />
          ) : !feed.loaded ? (
            <div className="panel empty-state">
              <Radio size={22} />
              {t('Waiting for snapshot…', '等待資料快照…')}
            </div>
          ) : path === paths.system || isBoard ? (
            <>
              <div className="summary-strip">
                <div>
                  <Grid2X2 size={18} />
                  <span>{t('Crew monitored', '監測人數')}</span>
                  <b>{feed.rows.length}</b>
                </div>
                <div>
                  <CheckCircle2 size={18} />
                  <span>{t('With measurements', '已有量測')}</span>
                  <b>{withData}</b>
                </div>
                <div>
                  <Database size={18} />
                  <span>{t('No measurements', '尚無量測')}</span>
                  <b>{feed.rows.length - withData}</b>
                </div>
              </div>
              <SectionTitle text={t('Crew measurements', '船員量測')} />
              <CrewBoard board={isBoard} rows={feed.rows} lang={lang} navigate={go} />
              {!isBoard && <section className="panel news-monitor"><h2>{t('Latest NEWS2 assessments','最新 NEWS2 健康評估')}</h2>
                {feed.assessments.length ? feed.assessments.map(a => <article key={a.crewId}>
                  <strong>{feed.rows.find(r => r.crewId === a.crewId)?.name ?? a.crewId}</strong>
                  <AssessmentStatus item={a} lang={lang}/></article>) : <p>{t('No assessments recorded.','尚無評估紀錄。')}</p>}
              </section>}
              <TeamTraining lang={lang} deny={deny} refreshToken={feed.trainingRevision}/>
            </>
          ) : !crew ? (
            <div className="panel empty-state">{t('Data unavailable', '無可用資料')}</div>
          ) : (
            <div data-testid={'crew-' + crew.crewId}>
              {path !== paths.history && (
                <>
                  <SectionTitle text={t('Vital signs', '生命徵象')} />
                  <div className="metric-grid">
                    {metrics.map((m) => (
                      <Reading key={m.code} crew={crew} metric={m} lang={lang} />
                    ))}
                  </div>
                </>
              )}
              <History key={crew.crewId} crew={crew} lang={lang} deny={deny} historyRevision={feed.historyRevision[crew.crewId]} />
            </div>
          )}
          <footer>
            <span>
              <Earth size={13} />
              Orbital / Crew Health
            </span>
            {!stationBase && <DesktopNoticeOptIn lang={lang} session={session}/>}
            <span>{t('Onboard local system', '船內本機系統')}</span>
          </footer>
        </main>
      </div>
    </div>
  )
}
function SectionTitle({ text }: { text: string }) {
  return (
    <div className="section-title">
      <Activity size={19} />
      <h2>{text}</h2>
    </div>
  )
}
function normalize(path: string, s: Session) {
  if (path === '/') return home(s)
  if (path === '/app' || path === '/app/') return paths.personal
  if (path === '/system' || path === '/system/') return paths.system
  return path.replace(/\/$/, '')
}
export default function App() {
  const [lang, setLang] = useState<Lang>(() =>
    localStorage.getItem('orbital.lang') === 'zh-TW' ? 'zh-TW' : 'en',
  )
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [expired, setExpired] = useState(false)
  const [path, setPath] = useState(window.location.pathname.slice(stationBase.length))
  const [attempt, setAttempt] = useState(0)
  const [authError, setAuthError] = useState(false)
  const navigate = useCallback((p: string) => {
    window.history.pushState(null, '', stationBase + p)
    setPath(p)
  }, [])
  const deny = useCallback(() => {
    setSession(old => {
      if (old) clearSavedHelp(old.username)
      return null
    })
    setExpired(true)
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
    localStorage.setItem('orbital.lang', lang)
  }, [lang])
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.slice(stationBase.length))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void api<Session>('/auth/me', { signal: controller.signal })
      .then((s) => {
        setSession(s)
        setAuthError(false)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setAuthError(!restricted(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [attempt])
  const route = session ? normalize(path, session) : path
  useEffect(() => {
    if (session && path !== route) {
      window.history.replaceState(null, '', stationBase + route)
      setPath(route)
    }
  }, [session, path, route])
  useEffect(() => {
    if (!stationBase || loading || session || authError) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function restoreDevice() {
      try {
        const response = await fetch(stationBase + '/prepare', {
          method: 'POST', headers: { 'X-Ship-Setup': '1' }, signal: controller.signal,
        })
        if (!response.ok) throw new Error('Device sign-in unavailable')
        if (!controller.signal.aborted) {
          setLoading(true)
          setAttempt(n => n + 1)
        }
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(restoreDevice, 3000)
      }
    }
    void restoreDevice()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [loading, session, authError])
  const toggleLang = () => setLang(lang === 'en' ? 'zh-TW' : 'en')
  const logout = async () => {
    if (!session) return
    try {
      await api('/auth/logout', { body: {}, token: session.csrfToken })
    } catch (e) {
      if (!restricted(e)) throw e
    }
    clearSavedHelp(session.username)
    setSession(null)
    setExpired(false)
    navigate('/')
  }
  if (loading || authError)
    return (
      <main className="splash">
        <Brand />
        {authError ? (
          <>
            <p>{tx(lang, 'Local server unavailable.', '無法連線至本機伺服器。')}</p>
            <button
              className="secondary"
              onClick={() => {
                setLoading(true)
                setAuthError(false)
                setAttempt(attempt + 1)
              }}
            >
              {tx(lang, 'Retry', '重試')}
            </button>
          </>
        ) : (
          <p>{tx(lang, 'Opening station…', '正在開啟工作站…')}</p>
        )}
      </main>
    )
  if (!session && stationBase)
    return <main className="splash"><Brand /><p>{tx(lang, 'Restoring device sign-in…', '正在恢復裝置登入…')}</p></main>
  if (!session)
    return (
      <Login
        lang={lang}
        toggleLang={toggleLang}
        expired={expired}
        success={(s) => {
          setSession(s)
          setExpired(false)
        }}
      />
    )
  const known = Object.values(paths).includes(route) || /^\/system\/crew\/[^/]+$/.test(route) ||
    /^\/app\/first-aid\/(unresponsive|severe-bleeding)$/.test(route)
  if (!known || !canView(route, session))
    return (
      <main className="splash">
        <Brand />
        <h1>
          {known ? tx(lang, 'Access restricted', '權限不足') : tx(lang, 'Page unavailable', '頁面不存在')}
        </h1>
        {home(session) !== route && (
          <button className="primary" onClick={() => navigate(home(session))}>
            {tx(lang, 'Open my station', '返回我的工作站')}
          </button>
        )}
        <button
          className="secondary"
          onClick={() => {
            void logout().catch(() => setAuthError(true))
          }}
        >
          {tx(lang, 'Sign out', '登出')}
        </button>
      </main>
    )
  const view = route === paths.board ? 'system_display' : route.startsWith('/system/') ? 'system' : 'personal'
  return (
    <Console
      key={session.username + view}
      {...{ lang, toggleLang, session, path: route, navigate, view, deny, logout }}
    />
  )
}
