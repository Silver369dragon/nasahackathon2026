import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookHeart, MessageCircle, Send } from 'lucide-react'
import { api, newId, restricted } from './api'
import { detectFirstAid, type AidTarget } from './aidRouting'
import { ChatSource, type ChatCitation } from './ChatSource'
import { tx, type Lang, type Session } from './domain'
import './chat.css'

type Turn = {
  id: string; conversationId: string; question: string; language: Lang; text: string;
  citations: ChatCitation[]; status: 'pending' | 'completed' | 'fallback' | 'no_evidence'; reason?: string
}
type History = { items: Turn[]; conversationId: string | null }
type Props = { session: Session; lang: Lang; deny: () => void; openAid: (id: AidTarget) => void
  assessmentId?: string; clearAssessment: () => void }

function responsePreview(text: string) {
  const paragraph = text.split(/\n+/).find(line => line.trim()) ?? text
  if (paragraph.length <= 280) return paragraph
  const sentenceEnd = paragraph.slice(0, 280).search(/[。！？]|[.!?](?=\s)/)
  return sentenceEnd >= 0 ? paragraph.slice(0, sentenceEnd + 1) : paragraph
}

export function Chat({ session, lang, deny, openAid, assessmentId, clearAssessment }: Props) {
  const [items, setItems] = useState<Turn[]>([])
  const [conversation, setConversation] = useState<string | null>(null)
  const [question, setQuestion] = useState(assessmentId ? tx(lang, 'What is missing from this NEWS2 assessment?', '這次 NEWS2 評估還缺哪些資料？') : '')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const flight = useRef<AbortController | null>(null)
  const command = useRef<{ text: string; id: string; lang: Lang } | null>(null)
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const last = items.at(-1)
  const pending = last?.status === 'pending' ? last.id : null

  useEffect(() => {
    const controller = new AbortController()
    void api<History>('/assistant/history', { signal: controller.signal }).then(history => {
      if (controller.signal.aborted) return
      setItems(history.items)
      setConversation(history.conversationId)
      setLoading(false)
      setError(false)
    }).catch((e: unknown) => {
      if (controller.signal.aborted) return
      if (restricted(e)) deny()
      else { setError(true); setLoading(false) }
    })
    return () => { controller.abort(); flight.current?.abort() }
  }, [deny, attempt])

  useEffect(() => {
    if (!pending) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    function poll() {
      void api<Turn>('/assistant/explanations/' + pending, { signal: controller.signal }).then(turn => {
        if (controller.signal.aborted) return
        setError(false)
        if (turn.status === 'pending') timer = setTimeout(poll, 450)
        else setItems(rows => rows.map(row => row.id === turn.id ? turn : row))
      }).catch((e: unknown) => {
        if (controller.signal.aborted) return
        if (restricted(e)) { deny(); return }
        setError(true)
        timer = setTimeout(poll, 2000)
      })
    }
    timer = setTimeout(poll, 350)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [deny, pending])

  async function ask(e: FormEvent) {
    e.preventDefault()
    const text = question.trim()
    if (!text) return
    const aid = detectFirstAid(text)
    if (aid) { openAid(aid); return }
    if (loading || sending || pending || flight.current) return
    const controller = new AbortController()
    flight.current = controller
    setSending(true)
    setError(false)
    if (command.current?.text !== text) command.current = { text, id: newId(), lang }
    try {
      const turn = await api<Turn>('/assistant/query', {
        body: { question: text, language: command.current.lang, conversationId: conversation, commandId: command.current.id,
          assessmentId: /news\s*2|評估|assessment|有缺|還缺|missing/i.test(text) ? assessmentId : undefined },
        token: session.csrfToken, signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setConversation(turn.conversationId)
      setItems(rows => rows.some(row => row.id === turn.id) ? rows : [...rows, turn])
      setQuestion('')
      clearAssessment()
      command.current = null
    } catch (e: unknown) {
      if (!controller.signal.aborted) {
        if (restricted(e)) deny()
        else setError(true)
      }
    } finally {
      flight.current = null
      if (!controller.signal.aborted) setSending(false)
    }
  }
  return <section className="chat-workspace">
    <div className="chat-toolbar">
      <p><MessageCircle size={20}/>{t('Your records, explained.', '讀懂你的健康紀錄。')}</p>
      <button className="secondary" onClick={() => openAid('first-aid')}><BookHeart size={16}/>{t('First aid', '急救指引')}</button>
    </div>
    {!items.length && !loading && <div className="chat-starters">
      {[t('Which tasks have I completed today?', '我今天完成了哪些訓練？'), t('Was my latest heart rate measured at rest?', '這筆心率是靜息量到的嗎？'), t('Why did I get a sensor alert?', '為什麼剛才出現警示？'), t('What is missing from my latest NEWS2 assessment?', '最新的 NEWS2 評估還缺哪些資料？')].map(prompt =>
        <button className="secondary" key={prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>)}
    </div>}
    <div aria-live="polite" className="chat-log">{items.map(turn => <article className="chat-turn" key={turn.id} data-testid="chat-turn">
      <h3>{turn.question}</h3>
      <small><MessageCircle size={14}/>{turn.status === 'completed' ? t('AI · verified records','AI · 已核對資料') :
        turn.status === 'pending' ? t('Local summary · AI is responding','本機摘要 · AI 回覆中') :
        turn.status === 'no_evidence' ? t('Local · limited evidence','本機 · 資料不足') : t('Local summary · cloud unavailable','本機摘要 · 雲端回覆未採用')}</small>
      <p>{responsePreview(turn.text)}</p>
      {responsePreview(turn.text) !== turn.text && <details className="disclosure"><summary>{t('Full response', '完整回覆')}</summary><p>{turn.text}</p></details>}
      <details className="disclosure chat-evidence"><summary>{turn.citations.length} {t('linked sources', '筆引用來源')}</summary>
        <div className="chat-sources">{turn.citations.map(ref => <ChatSource key={[ref.kind,ref.id,ref.chunkId].join('-')} citation={ref} lang={lang} deny={deny}/>)}</div>
      </details>
    </article>)}</div>
    {error && <p className="notice" role="alert">{t('Could not sync this conversation.', '對話尚未同步。')}
      <button type="button" className="text-btn" onClick={() => setAttempt(a => a + 1)}>{t('Reload','重新載入')}</button></p>}
    <form onSubmit={ask} className="chat-compose">
      <label htmlFor="health-question">{t('Your question','你的問題')}</label>
      <textarea id="health-question" rows={2} placeholder={t('Ask about a reading…', '詢問一筆量測…')} maxLength={1600} value={question} onChange={e => setQuestion(e.target.value)}/>
      <button className="primary" disabled={!question.trim() || ((loading || sending || !!pending) && !detectFirstAid(question))}><Send size={15}/>{t('Send','送出')}</button>
    </form>
  </section>
}

