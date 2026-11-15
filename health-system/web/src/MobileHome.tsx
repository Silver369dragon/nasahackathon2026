import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  BookHeart,
  BookOpen,
  ChevronRight,
  ClipboardList,
  History,
  Layers3,
  LifeBuoy,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Radiation,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { tx, type Lang } from './domain'
import './mobile-home.css'

// Phone layouts (<= 650px) replace the drop-down menu with a home screen of
// large buttons; each button opens one existing section as its own screen.
const MOBILE_QUERY = '(max-width: 650px)'

export function useMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}

type Link = { path: string; en: string; zh: string; Icon: LucideIcon }

export type MobilePaths = {
  tasks: string
  body: string
  aid: string
  measure: string
  trends: string
  chat: string
  more: string
  assessment: string
  history: string
  radiation: string
  catalog: string
}

function LinkButton({ link, lang, go, className }: { link: Link; lang: Lang; go: (p: string) => void; className: string }) {
  const { Icon } = link
  return (
    <button className={className} onClick={() => go(link.path)}>
      <Icon aria-hidden="true" />
      <span>{tx(lang, link.en, link.zh)}</span>
    </button>
  )
}

export function HelpButton({ lang, request, disabled, pending }: {
  lang: Lang; request: () => void; disabled: boolean; pending: boolean
}) {
  return (
    <button className="mobile-help" data-testid="request-help" disabled={disabled}
      onClick={event => { if (event.detail < 2) request() }}>
      <LifeBuoy aria-hidden="true" />
      {pending ? tx(lang, 'Retry help request', '重送求助通知') : tx(lang, 'Request help', '緊急求助')}
    </button>
  )
}

export function MobileHome({ lang, go, paths, help }: {
  lang: Lang
  go: (p: string) => void
  paths: MobilePaths
  help: { request: () => void; disabled: boolean; pending: boolean }
}) {
  const main: Link[] = [
    { path: paths.tasks, en: 'Daily training', zh: '每日訓練', Icon: Activity },
    { path: paths.body, en: 'Body hologram', zh: '身體全息圖', Icon: Layers3 },
    { path: paths.aid, en: 'First aid', zh: '急救指引', Icon: BookHeart },
  ]
  const more: Link[] = [
    { path: paths.measure, en: 'Record', zh: '新增量測', Icon: Plus },
    { path: paths.trends, en: 'Trends', zh: '健康趨勢', Icon: TrendingUp },
    { path: paths.chat, en: 'Assistant', zh: '健康助手', Icon: MessageCircle },
    { path: paths.more, en: 'More', zh: '更多', Icon: MoreHorizontal },
  ]
  return (
    <nav className="mobile-home" aria-label={tx(lang, 'Sections', '功能')}>
      <div className="mobile-main">
        {main.map(link => <LinkButton key={link.path} link={link} lang={lang} go={go} className="mobile-main-btn" />)}
      </div>
      <div className="mobile-minor">
        {more.map(link => <LinkButton key={link.path} link={link} lang={lang} go={go} className="mobile-minor-btn" />)}
      </div>
      <HelpButton lang={lang} {...help} />
    </nav>
  )
}

export function MobileMore({ lang, go, paths, signOut }: {
  lang: Lang
  go: (p: string) => void
  paths: MobilePaths
  signOut?: () => void
}) {
  const links: Link[] = [
    { path: paths.assessment, en: 'NEWS2 assessment', zh: 'NEWS2 健康評估', Icon: ClipboardList },
    { path: paths.history, en: 'Measurement history', zh: '量測歷史', Icon: History },
    { path: paths.radiation, en: 'Radiation', zh: '輻射監測', Icon: Radiation },
    { path: paths.catalog, en: 'Metric catalog', zh: '指標目錄', Icon: BookOpen },
  ]
  return (
    <nav className="mobile-more" aria-label={tx(lang, 'More sections', '更多功能')}>
      {links.map(({ path, en, zh, Icon }) => (
        <button key={path} className="mobile-more-btn" onClick={() => go(path)}>
          <Icon aria-hidden="true" />
          <span>{tx(lang, en, zh)}</span>
          <ChevronRight aria-hidden="true" />
        </button>
      ))}
      {signOut && (
        <button className="mobile-more-btn sign-out" onClick={signOut}>
          <LogOut aria-hidden="true" />
          <span>{tx(lang, 'Sign out', '登出')}</span>
        </button>
      )}
    </nav>
  )
}

export function MobileBack({ lang, onClick }: { lang: Lang; onClick: () => void }) {
  return (
    <button className="mobile-back" onClick={onClick}>
      <ArrowLeft aria-hidden="true" />
      {tx(lang, 'Home', '返回首頁')}
    </button>
  )
}
