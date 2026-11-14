import { useEffect, useState } from 'react'
import { BellRing, ChevronDown, ChevronUp } from 'lucide-react'
import { shouldNotifyDesktop, stamp, tx, type CrewSummary, type Emergency, type Lang, type Session } from './domain'
import { api } from './api'

function sourceLabel(item: Emergency, lang: Lang) {
  return item.source === 'sensor' ? tx(lang, 'Training sensor alert', '訓練感測警示') : tx(lang, 'Manual help request', '主動求助')
}
const nameOf = (item: Emergency) => item.crewId.charAt(0).toUpperCase() + item.crewId.slice(1)

export async function desktopNotice(item: Emergency, crewId: string | null, lang: Lang) {
  if (!('Notification' in window) || !shouldNotifyDesktop(item, { hidden: document.hidden, permission: Notification.permission, crewId })) return
  try {
    const title = tx(lang, 'Orbital · Emergency notification', 'Orbital · 緊急通知')
    const options = {
      body: nameOf(item) + ' · ' + sourceLabel(item, lang) + ' · ' + stamp(item.createdAt, lang), tag: item.id,
    }
    const worker = await navigator.serviceWorker?.getRegistration()
    if (worker) await worker.showNotification(title, options)
    else new Notification(title, options)
  } catch { /* The in-page emergency feed remains available. */ }
}

export function DesktopNoticeOptIn({ lang, session }: { lang: Lang; session: Session }) {
  const [permission, setPermission] = useState(() => 'Notification' in window ? Notification.permission : null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const push = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window
  const t = (en: string, zh: string) => tx(lang, en, zh)

  useEffect(() => {
    if (!push) return
    const controller = new AbortController()
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
    void api<{ enabled: boolean }>('/push/device', { signal: controller.signal })
      .then(data => setEnabled(data.enabled)).catch(() => {})
    return () => controller.abort()
  }, [push, session.username])
  async function toggle() {
    setBusy(true)
    setError(false)
    try {
      if (enabled) {
        await api('/push/disable', { body: {}, token: session.csrfToken })
        setEnabled(false)
        return
      }
      const access = await Notification.requestPermission()
      setPermission(access)
      if (access !== 'granted' || !push) return
      await navigator.serviceWorker.register('/sw.js')
      const registration = await navigator.serviceWorker.ready
      const { publicKey } = await api<{ publicKey: string }>('/push/device')
      const key = Uint8Array.from(atob(publicKey.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0))
      let sub = await registration.pushManager.getSubscription()
      if (sub && String(new Uint8Array(sub.options.applicationServerKey ?? new ArrayBuffer(0))) !== String(key)) {
        await sub.unsubscribe()
        sub = null
      }
      sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      await api('/push/subscribe', { token: session.csrfToken, body: { endpoint: sub.endpoint, keys: sub.toJSON().keys, lang } })
      setEnabled(true)
    } catch { setError(true) }
    finally { setBusy(false) }
  }
  if (!window.isSecureContext || !permission) return null
  if (permission === 'denied') return <span>{t('Notifications blocked in browser settings', '瀏覽器設定已封鎖通知')}</span>
  if (permission === 'granted' && !push) return null
  return <div><button type="button" className="desktop-opt-in" onClick={() => void toggle()} disabled={busy}>
    <BellRing size={14}/>{enabled ? t('Disable device push', '關閉裝置推播') : t('Enable device notifications', '啟用裝置通知')}
  </button>{error && <span role="status">{t('Could not enable or update push. Try again.', '無法更新裝置推播，請重試。')}</span>}</div>
}

export function EmergencyNotices({ items, lang, username, crewId, crew }: {
  items: Emergency[]; lang: Lang; username: string; crewId: string | null; crew: CrewSummary[]
}) {
  const foldedKey = 'orbital.emergency.folded.' + username
  const [folded, setFolded] = useState(() => sessionStorage.getItem(foldedKey) ?? '')
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const newest = items[0]
  const mine = newest.source === 'manual' && newest.crewId === crewId
  const collapsed = folded === newest.id
  const t = (en: string, zh: string) => tx(lang, en, zh)
  function toggle() {
    const value = collapsed ? '' : newest.id
    sessionStorage.setItem(foldedKey, value)
    setFolded(value)
    setAll(false)
  }
  return <section className={'emergency-notices' + (mine ? ' own-notice' : '')} aria-label={t('Emergency notifications', '緊急通知')}>
    <button type="button" className="emergency-heading" onClick={toggle} aria-expanded={!collapsed}>
      <BellRing size={19}/><strong>{t('Emergency notifications', '緊急通知')}</strong>
      <span>{items.length}</span>{collapsed ? <ChevronDown size={17}/> : <ChevronUp size={17}/>}
    </button>
    {!collapsed && <>
      <ul className="emergency-log" aria-live={mine ? 'off' : 'polite'}>{(all ? items : [newest]).map(item => <li key={item.id} data-testid={'emergency-' + item.id}>
        <div><b>{crew.find(row => row.crewId === item.crewId)?.name ?? nameOf(item)}</b><span>{sourceLabel(item, lang)}</span></div>
        <time dateTime={item.createdAt}>{stamp(item.createdAt, lang)}</time>
      </li>)}</ul>
      {items.length > 1 && <button className="emergency-history" type="button" aria-expanded={all} onClick={() => setAll(!all)}>
        {all ? t('Show latest only', '僅顯示最新通知') : t('Show earlier notifications', '查看較早通知')}</button>}
    </>}
  </section>
}
