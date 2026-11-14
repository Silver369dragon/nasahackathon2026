import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, HeartPulse, LifeBuoy } from 'lucide-react'
import { api, restricted } from './api'
import { tx, type Lang } from './domain'
import './first-aid.css'

type Bilingual = Record<Lang, string>
type Source = { id: string; title: string; version: string; url: string; section: string }
type Chunk = { id: string; version: number; section: Bilingual; text: Bilingual; sources: Source[] }
type Card = {
  id: string; title: Bilingual; environment: string; audience: Bilingual; purpose: Bilingual
  version: number; reviewStatus: string; missionApproved: boolean; sources: Source[]; chunks: Chunk[]
}
type CardList = { items: Omit<Card, 'chunks'>[] }

function useReading<T>(path: string | null, onDenied: () => void) {
  const [result, setResult] = useState<{ path: string; data?: T; failed?: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    void api<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ path, data })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (restricted(error)) { onDenied(); return }
      setResult({ path, failed: true })
    })
    return () => controller.abort()
  }, [path, onDenied, attempt])
  return { result: result?.path === path ? result : null, retry: () => { setResult(null); setAttempt(n => n + 1) } }
}

function environment(value: string, lang: Lang) {
  return value === 'microgravity' ? tx(lang, 'Microgravity', '微重力')
    : tx(lang, 'Ground exercise', '地面演練')
}

const delivery: Record<string, [string, string]> = {
  sending: ['Sending…', '正在發送…'],
  queued: ['Queued on this device. Tell a nearby crewmate now.', '已在裝置上排隊等待連線。請立即呼叫附近隊友。'],
  sent: ['Help request sent to the crew.', '緊急求助通知已發給船員。'],
  unknown: ['Delivery is unconfirmed. You can retry the same request.', '尚未確認送達。可重送同一筆求助。'],
  rejected: ['The station could not accept the request. Call a nearby crewmate.', '工作站未受理求助。請直接呼叫附近隊友。'],
}

export function FirstAid({ lang, initialId, onHelp, helpStatus = 'idle', onDenied }: {
  lang: Lang; initialId?: string | null; onHelp: () => void; helpStatus?: string; onDenied: () => void
}) {
  const [selection, setSelection] = useState(initialId && initialId !== 'first-aid' ? { id: initialId, version: 1 } : null)
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const index = useReading<CardList>(selection ? null : '/procedures', onDenied)
  const detail = useReading<Card>(selection
    ? '/procedures/' + encodeURIComponent(selection.id) + '?version=' + selection.version : null, onDenied)
  const active = selection ? detail : index
  const card = detail.result?.data
  const status = delivery[helpStatus]
  return <section className="aid-page" aria-label={t('First aid', '急救')}>
    <div className="aid-top">
      <div><h2>{t('First-aid cards', '急救流程卡')}</h2>
        <p>{t('These local training cards can be read without an internet connection.', '連上船內網路即可閱讀這些本機訓練卡。')}</p>
      </div>
      <div className="aid-contact"><button type="button" className="aid-help" disabled={helpStatus === 'sending' || helpStatus === 'queued'}
        onClick={event => { if (event.detail < 2) onHelp() }}><LifeBuoy size={18}/>
        {helpStatus === 'unknown' ? t('Retry help request', '重送求助通知') : t('Request crew help', '通知船員求助')}</button>
        <small>{t('Alerts this training crew only.', '通知對象為本訓練工作區船員。')}</small>
      </div>
    </div>
    {status && <p role="status" className="aid-feedback">{t(...status)}</p>}
    {selection && <button className="aid-back" type="button" onClick={() => setSelection(null)}><ArrowLeft size={15}/>
      {t('All first-aid cards', '所有急救卡')}</button>}
    {active.result?.failed ? <p className="notice" role="alert">{t('The local card could not be loaded.', '無法載入本機急救卡。')}{' '}
      <button type="button" className="aid-back" onClick={active.retry}>{t('Retry', '重試')}</button></p>
      : !active.result?.data && <p role="status">{t('Loading local cards…', '正在讀取本機卡片…')}</p>}
    {!selection && index.result?.data && <div className="aid-index">{index.result.data.items.map(item =>
      <button type="button" key={item.id} onClick={() => setSelection({ id: item.id, version: item.version })}>
        <span className="aid-icon">{item.id === 'unresponsive' ? <HeartPulse size={22}/> : <BookOpen size={22}/>}</span>
        <span><small>{environment(item.environment, lang)}</small><strong>{item.title[lang]}</strong></span><ArrowRight size={17}/>
      </button>)}</div>}
    {selection && card && <article className="aid-card" data-testid={'procedure-' + card.id}>
      <header><span className="aid-scope">{environment(card.environment, lang)} · v{card.version}</span>
        <h3>{card.title[lang]}</h3><p>{card.purpose[lang]}</p>
        <p className="aid-review">{card.audience[lang]} · {t('Educational material. No mission medical approval.',
          '教育用途。尚未取得任務醫療審核核准。')}</p>
      </header>
      <ol className="aid-steps">{card.chunks.map(c => <li key={c.id}>
        <h4>{c.section[lang]}</h4><p>{c.text[lang]}</p>
      </li>)}</ol>
      <footer><h4>{t('Sources', '資料來源')}</h4><ul>{card.sources.map(s => <li key={s.id}>
        <a href={s.url} target="_blank" rel="noreferrer">{s.title} <ExternalLink size={13}/></a>
        <small>{s.version}</small>
      </li>)}</ul></footer>
    </article>}
  </section>
}
