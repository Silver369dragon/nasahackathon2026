import { useEffect, useState } from 'react'
import { Square, Volume2, X } from 'lucide-react'
import { api, restricted } from './api'
import { metrics, prettyValue, selectReadings, tx, type CrewSummary, type Lang, type Measurement } from './domain'
import type { ScanList } from './body-map'
import { metricIcons } from './Readings'
import { referenceBand } from './Trends'

// Phone home: four vital tiles with an icon, a large colored value and a status pill.
// Blood oxygen is drawn as a ring; heart rate gets a small pulse line.
// Status uses the NEWS2 training reference range (see Trends.tsx), not a clinical threshold.
// A stale reading (the live sensor stopped updating) never shows as normal; an out-of-range value
// stays flagged even when stale, since the last thing we saw was abnormal.
type State = 'inside' | 'outside' | 'unusable' | 'stale' | 'none'

function stateOf(m: Measurement | null, cards: CrewSummary['metricCards']): State {
  if (!m) return 'none'
  if (m.quality !== 'good' || m.value === null || typeof m.value !== 'number') return 'unusable'
  const band = referenceBand[m.metricCode]
  if (band && (m.value < band[0] || m.value > band[1])) return 'outside'
  return cards.find(c => c.metricCode === m.metricCode)?.freshness === 'stale' ? 'stale' : 'inside'
}

// Early warning: the last three valid readings moved the same way twice in a row and the newest
// one is already on that side of the reference range's middle (for example temperature rising
// toward the upper edge), even if still in range. Blood oxygen only warns when falling.
type Trend = 'rising' | 'falling' | null
// Breathing has no home tile; its early warning only shows in the banner.
const trendCodes = ['heart_rate', 'spo2', 'blood_pressure_systolic', 'temperature', 'respiratory_rate']
function trendOf(code: string, items: Measurement[]): Trend {
  const band = referenceBand[code]
  const values = items.filter(m => m.quality === 'good' && typeof m.value === 'number')
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).slice(-3).map(m => m.value as number)
  if (!band || values.length < 3) return null
  const middle = code === 'spo2' ? 100 : (band[0] + band[1]) / 2
  if (code !== 'spo2' && values[2] > values[1] && values[1] > values[0] && values[2] > middle) return 'rising'
  if (values[2] < values[1] && values[1] < values[0] && values[2] < middle) return 'falling'
  return null
}

function useTrends(crewId: string, revision: string | undefined, deny: () => void) {
  const [trends, setTrends] = useState<Record<string, Trend>>({})
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all(trendCodes.map(async code => {
      const query = new URLSearchParams({ crewId, metricCode: code, limit: '6' })
      const data = await api<{ items: Measurement[] }>('/measurements?' + query, { signal: controller.signal })
      return [code, trendOf(code, data.items)] as const
    })).then(rows => { if (!controller.signal.aborted) setTrends(Object.fromEntries(rows)) })
      .catch(err => { if (!controller.signal.aborted && restricted(err)) deny() })
    return () => controller.abort()
  }, [crewId, revision, deny])
  return trends
}

// Muscle loss: in microgravity muscle shrinks even with daily exercise (ISS crews lost about 13% of
// calf volume over 6 months), so three body scans in a row with falling muscle mass, down at least
// 1% overall to ignore small measurement noise, prompt the crew toward resistance training.
function useMuscleTrend(revision: string | undefined, deny: () => void) {
  const [falling, setFalling] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void api<ScanList>('/body-scans?limit=3', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return
      const masses = [...data.items].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
        .map(scan => scan.totals.muscleMassKg).filter((m): m is number => typeof m === 'number')
      setFalling(masses.length === 3 && masses[1] < masses[0] && masses[2] < masses[1] && (masses[0] - masses[2]) / masses[0] >= 0.01)
    }).catch(err => { if (!controller.signal.aborted && restricted(err)) deny() })
    return () => controller.abort()
  }, [revision, deny])
  return falling
}

// One plain next step for each early warning, shown in the home banner.
const advice: Record<string, Record<'rising' | 'falling', [string, string]>> = {
  heart_rate: {
    rising: ['Heart rate rose 3 times in a row. Rest a few minutes, then measure again.', '心率連續 3 次上升，先休息幾分鐘再量一次'],
    falling: ['Heart rate fell 3 times in a row. Sit down and measure again.', '心率連續 3 次下降，先坐下再量一次'],
  },
  spo2: {
    rising: ['', ''],
    falling: ['Blood oxygen fell 3 times in a row. Check the sensor fit, then measure again.', '血氧連續 3 次下降，確認感測器戴好後再量一次'],
  },
  blood_pressure_systolic: {
    rising: ['Blood pressure rose 3 times in a row. Sit and rest 5 minutes, then measure again.', '血壓連續 3 次上升，坐好休息 5 分鐘後再量一次'],
    falling: ['Blood pressure fell 3 times in a row. Sit and rest 5 minutes, then measure again.', '血壓連續 3 次下降，坐好休息 5 分鐘後再量一次'],
  },
  respiratory_rate: {
    rising: ['Breathing got faster 3 times in a row. Sit and rest a few minutes, then measure again.', '呼吸連續 3 次變快，先坐下休息幾分鐘再量一次'],
    falling: ['Breathing got slower 3 times in a row. Ask a crewmate to check on you.', '呼吸連續 3 次變慢，請隊友協助確認狀況'],
  },
  temperature: {
    rising: ['Temperature rose 3 times in a row. Measure again in 30 minutes.', '體溫連續 3 次上升，建議 30 分鐘後再量一次'],
    falling: ['Temperature fell 3 times in a row. Keep warm and measure again in 30 minutes.', '體溫連續 3 次下降，注意保暖，30 分鐘後再量一次'],
  },
}

type Warning = { key: string; arrow: string; text: string; action?: { label: string; run: () => void } }

function TrendBanner({ warnings, lang }: { warnings: Warning[]; lang: Lang }) {
  const key = warnings.map(w => w.key).join('|')
  const [closed, setClosed] = useState('')
  const [expanded, setExpanded] = useState(false)
  if (!warnings.length || closed === key) return null
  const first = warnings[0]
  return <div className="trend-banner-wrap" data-testid="trend-banner">
    <div className="trend-banner" role="status">
      <span aria-hidden="true">{first.arrow}</span>
      <p>{first.text}{warnings.length > 1 && <button type="button" className="trend-banner-more" aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}>{expanded ? tx(lang, ' (hide)', '（收起）')
          : tx(lang, ` (+${warnings.length - 1} more)`, `（另有 ${warnings.length - 1} 項）`)}</button>}</p>
      {first.action && <button type="button" className="trend-banner-action" onClick={first.action.run}>{first.action.label}</button>}
      <button type="button" onClick={() => setClosed(key)} aria-label={tx(lang, 'Dismiss', '關閉提示')}><X size={18}/></button>
    </div>
    {expanded && warnings.slice(1).map(w => <div key={w.key} className="trend-banner trend-banner-extra" role="status">
      <span aria-hidden="true">{w.arrow}</span><p>{w.text}</p>
      {w.action && <button type="button" className="trend-banner-action" onClick={w.action.run}>{w.action.label}</button>}
    </div>)}
  </div>
}

// Read the vitals aloud with the browser's built-in speech (works offline on most phones), for
// moments when the crew cannot look at the screen. Phones only allow it after a tap.
// Desktop systems also list novelty voices (Albert, Bells, Zarvox…); prefer natural ones.
const novelty = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Kathy|Fred|Grandma|Grandpa|Rocko|Shelley|Sandy|Flo|Eddy|Reed)\b/
const preferred = /Samantha|Google US English|Google 國語|Microsoft (Aria|Jenny|Guy|Hanhan|Zhiwei|HsiaoChen)|Karen|Daniel|Moira|Tessa|美佳|Meijia|Mei-Jia|Sin-ji|Tingting|婷婷/
// Some browsers (and the desktop app's built-in browser) ignore the chosen voice and use the
// system voice; a Chinese system voice then reads digits in Chinese. Spelling the numbers out
// in English words keeps English readouts in English whichever voice speaks.
const ones = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve',
  'thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
const tens = ['', '', 'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']
function words(n: number): string {
  if (n < 20) return ones[n]
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '')
  if (n < 1000) return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + words(n % 100) : '')
  return String(n)
}
const spellNumbers = (text: string) => text.replace(/\d+(\.\d+)?/g, match => {
  const [whole, fraction] = match.split('.')
  return words(Number(whole)) + (fraction ? ' point ' + [...fraction].map(d => ones[Number(d)]).join(' ') : '')
})

function pickVoice(voices: SpeechSynthesisVoice[], lang: Lang) {
  const tag = lang === 'en' ? 'en' : 'zh'
  const usable = voices.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith(tag) && !novelty.test(v.name))
  const exact = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase() === (lang === 'en' ? 'en-us' : 'zh-tw')
  return usable.find(v => preferred.test(v.name) && exact(v)) ?? usable.find(v => preferred.test(v.name))
    ?? usable.find(exact) ?? usable[0]
}
function SpeakButton({ text, lang }: { text: string; lang: Lang }) {
  const [speaking, setSpeaking] = useState(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  useEffect(() => {
    if (!supported) return
    // Voices load asynchronously; ask early so a natural voice is ready by the first tap.
    const synth = window.speechSynthesis
    const load = () => synth.getVoices()
    load()
    synth.addEventListener('voiceschanged', load)
    return () => { synth.removeEventListener('voiceschanged', load); synth.cancel() }
  }, [supported])
  if (!supported) return null
  const toggle = () => {
    const synth = window.speechSynthesis
    synth.cancel()
    if (speaking) { setSpeaking(false); return }
    const say = () => {
      const utterance = new SpeechSynthesisUtterance(lang === 'en' ? spellNumbers(text) : text)
      utterance.lang = lang === 'en' ? 'en-US' : 'zh-TW'
      const voice = pickVoice(synth.getVoices(), lang)
      if (voice) utterance.voice = voice
      utterance.rate = 0.95
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      synth.speak(utterance)
    }
    setSpeaking(true)
    // Without a loaded voice list the system default voice (maybe Chinese) would read English
    // text and say the numbers in Chinese, so wait briefly for the list first.
    if (synth.getVoices().length) { say(); return }
    let done = false
    const go = () => { if (!done) { done = true; synth.removeEventListener('voiceschanged', go); say() } }
    synth.addEventListener('voiceschanged', go)
    setTimeout(go, 1000)
  }
  return <button type="button" className={'vital-speak' + (speaking ? ' speaking' : '')} onClick={toggle} data-testid="speak-vitals"
    aria-label={speaking ? tx(lang, 'Stop reading', '停止朗讀') : tx(lang, 'Read my vitals aloud', '唸出我的數值')}>
    {speaking ? <Square size={16} aria-hidden="true"/> : <Volume2 size={18} aria-hidden="true"/>}
  </button>
}

export function MobileVitals({ crew, lang, revision, deny, openTraining }: {
  crew: CrewSummary; lang: Lang; revision?: string; deny: () => void; openTraining: () => void
}) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const trends = useTrends(crew.crewId, revision, deny)
  const muscleFalling = useMuscleTrend(revision, deny)
  const warnings: Warning[] = [
    ...(muscleFalling ? [{ key: 'muscle', arrow: '↘', action: { label: t('Training', '去訓練'), run: openTraining },
      text: t('Muscle fell in 3 scans: do leg resistance work.', '肌肉量連續 3 次下降，記得做腿部阻力訓練') }] : []),
    ...trendCodes.filter(code => trends[code]).map(code => ({
      key: code + ':' + trends[code], arrow: trends[code] === 'rising' ? '↗' : '↘',
      text: tx(lang, ...advice[code][trends[code]!]) })),
  ]
  const pills: Record<State, string> = {
    inside: t('Normal', '正常'), outside: t('Check', '超出範圍'), unusable: t('Unusable', '品質不足'), stale: t('Stale', '已過期'), none: t('No data', '尚無資料'),
  }
  const statusWords: Record<State, string> = {
    inside: t('normal', '正常'), outside: t('out of range', '超出範圍'), unusable: t('reading unusable', '量測品質不足'), stale: t('reading is out of date', '數值已過期'), none: t('no data', '尚無資料'),
  }
  const spoken = [
    ...metrics.map(metric => {
      const records = selectReadings(crew.metricCards, metric, 'latest')
      const state = stateOf(records.find(r => r !== null) ?? null, crew.metricCards)
      const [first, second] = records.map(r => prettyValue(r, false, lang))
      const value = metric.code === 'blood_pressure'
        ? t(`${first} over ${second}`, `收縮壓 ${first}，舒張壓 ${second}`) : first
      const unit = metric.code === 'temperature' ? t(' degrees', ' 度') : metric.code === 'spo2' ? t(' percent', ' %') : ''
      return (metric.code === 'blood_pressure' && lang !== 'en' ? '血壓，' : t(metric.en, metric.zh) + ' ')
        + (state === 'none' ? '' : value + unit + t(', ', '，')) + statusWords[state]
    }),
    ...warnings.map(w => t('Note: ', '提醒：') + w.text),
  ].map(sentence => sentence.replace(/[.。]+$/, '')).join(t('. ', '。'))
  return <>
  <TrendBanner warnings={warnings} lang={lang}/>
  <div className="vital-tiles" data-testid={'vitals-' + crew.crewId}>
    <SpeakButton text={spoken} lang={lang}/>
    {metrics.map(metric => {
      const records = selectReadings(crew.metricCards, metric, 'latest')
      const main = records[0]
      const state = metric.code === 'blood_pressure' && records[0]
        ? stateOf(records[0], crew.metricCards) : stateOf(records.find(r => r !== null) ?? null, crew.metricCards)
      const value = records.some(r => r) ? records.map(r => prettyValue(r, false, lang)).join('/') : '—'
      const Icon = metricIcons[metric.code]
      const unit = metric.code === 'temperature' ? '°C' : metric.unit
      return <article key={metric.code} className={'vital-tile ' + state} data-testid={'metric-' + metric.code}>
        {metric.code === 'spo2' ? <svg className="vital-ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="27" className="track"/>
          <circle cx="32" cy="32" r="27" className="fill" pathLength="100"
            strokeDasharray={`${state === 'none' || state === 'unusable' ? 0 : Math.max(0, Math.min(100, Number(main?.value ?? 0)))} 100`}/>
          <text x="32" y="39" textAnchor="middle">{value === '—' ? '—' : value + '%'}</text>
        </svg> : <>
          <Icon size={22} aria-hidden="true" className="vital-icon"/>
          <strong className="vital-value">{value}</strong>
          {metric.code === 'heart_rate' && <svg className="vital-pulse" viewBox="0 0 120 20" aria-hidden="true">
            <polyline points="0,12 22,12 28,3 35,18 41,12 62,12 68,3 75,18 81,12 102,12 108,3 115,18 120,12"/></svg>}
        </>}
        <span className="vital-label">{t(metric.en, metric.zh)}{metric.code !== 'spo2' && <small> · {unit}</small>}</span>
        <span className="vital-pill">{pills[state]}</span>
        {(() => {
          const trend = trends[metric.code === 'blood_pressure' ? 'blood_pressure_systolic' : metric.code]
          return trend && <span className="vital-trend" data-testid={'trend-' + metric.code}>
            {trend === 'rising' ? t('↗ Rising 3 times in a row', '↗ 連續 3 次上升') : t('↘ Falling 3 times in a row', '↘ 連續 3 次下降')}</span>
        })()}
      </article>
    })}
  </div>
  </>
}
