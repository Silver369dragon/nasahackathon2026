import { useEffect, useState } from 'react'
import { Moon, Sun, SunMoon } from 'lucide-react'
import { tx, type Lang } from './domain'
import './theme.css'

// Crew display themes: light or dark. "Auto" follows the cabin clock (UTC, as on the ISS):
// light during the work day, dark during the crew sleep period (21:30–06:00), so checking the
// app at night is not glaring. Dark can also be chosen by hand, e.g. during a task.
export type ThemeChoice = 'auto' | 'day' | 'dark'
const order: ThemeChoice[] = ['auto', 'day', 'dark']
const KEY = 'orbital.theme'
const sleepPeriod = (date = new Date()) => {
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  return minutes >= 21 * 60 + 30 || minutes < 6 * 60
}

function load(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return order.includes(v as ThemeChoice) ? v as ThemeChoice : 'auto' } catch { return 'auto' }
}

export function useCrewTheme(active: boolean) {
  const [choice, setChoice] = useState<ThemeChoice>(load)
  const [night, setNight] = useState(sleepPeriod)
  useEffect(() => {
    const id = setInterval(() => setNight(sleepPeriod()), 60000)
    return () => clearInterval(id)
  }, [])
  const theme = choice === 'auto' ? (night ? 'dark' : 'day') : choice
  useEffect(() => {
    const root = document.documentElement
    if (active && theme === 'dark') root.dataset.theme = 'dark'
    else delete root.dataset.theme
    return () => { delete root.dataset.theme }
  }, [active, theme])
  const next = () => setChoice(current => {
    const value = order[(order.indexOf(current) + 1) % order.length]
    try { localStorage.setItem(KEY, value) } catch { /* Applies to this page only. */ }
    return value
  })
  return { choice, theme, next }
}

export function ThemeButton({ lang, choice, theme, next }: { lang: Lang; choice: ThemeChoice; theme: string; next: () => void }) {
  const names: Record<string, [string, string]> = { day: ['Light', '白天'], dark: ['Dark', '深色'] }
  const Icon = choice === 'auto' ? SunMoon : choice === 'day' ? Sun : Moon
  const label = choice === 'auto' ? tx(lang, 'Auto', '自動') + '·' + tx(lang, ...names[theme]) : tx(lang, ...names[choice])
  return <button className="language theme-button" onClick={next}
    aria-label={tx(lang, 'Display theme: ', '畫面主題：') + label + tx(lang, '. Tap to change.', '，點一下切換')}>
    <Icon size={15} aria-hidden="true"/>{label}
  </button>
}
