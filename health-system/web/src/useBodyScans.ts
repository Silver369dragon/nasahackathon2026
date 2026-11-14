import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, newId, restricted } from './api'
import type { Session } from './domain'
import type { BodyScan, LatestScan, ScanList, ScanPreset } from './body-map'

type Pending = { requestId: string; preset: ScanPreset }
function savedRequest(key: string): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    return value && typeof value.requestId === 'string' && ['baseline','training_strain','recovery','partial'].includes(value.preset) ? value : null
  } catch { return null }
}
function mergeScans(a: BodyScan[], b: BodyScan[]) {
  return [...new Map([...a,...b].map(scan => [scan.id,scan])).values()]
    .sort((x,y) => y.observedAt.localeCompare(x.observedAt) || y.id.localeCompare(x.id))
}
function keepLatest(previous: BodyScan | null, candidate: BodyScan | null) {
  if (!candidate) return previous
  if (!previous) return candidate
  const order = candidate.observedAt.localeCompare(previous.observedAt) || candidate.id.localeCompare(previous.id)
  return order >= 0 ? candidate : previous
}

export function useBodyScans(session: Session, deny: () => void) {
  const [latest, setLatest] = useState<BodyScan | null>(null)
  const [items, setItems] = useState<BodyScan[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [demoEnabled, setDemoEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestKey = 'orbital-body-request:' + session.username
  const [pending, setPending] = useState<Pending | null>(() => savedRequest(requestKey))
  const lifecycle = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const paging = useRef(false)
  const refreshing = useRef<AbortController | null>(null)
  const historyPending = useRef(true)

  const denied = useCallback((err: unknown) => {
    if (!restricted(err) || (err instanceof ApiError && err.code === 'BODY_DEMO_DISABLED')) return false
    setLatest(null); setItems([]); deny(); return true
  }, [deny])

  const refresh = useCallback(async (first = false) => {
    const controller = lifecycle.current
    if (!controller || controller.signal.aborted || refreshing.current === controller) return
    refreshing.current = controller
    if (first) historyPending.current = true
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
      const data = await api<LatestScan>('/body-scans/latest', { signal })
      if (controller.signal.aborted) return
      setLatest(previous => keepLatest(previous,data.scan)); setDemoEnabled(data.demoEnabled); setLoaded(true)
      if (data.scan) setItems(previous => mergeScans(previous,[data.scan!]))
      if (historyPending.current) {
        const history = await api<ScanList>('/body-scans?limit=20', { signal })
        if (controller.signal.aborted) return
        setItems(previous => mergeScans(previous, history.items)); setNextCursor(history.nextCursor)
        historyPending.current = false
      }
      setOffline(false)
    } catch (err) {
      if (!controller.signal.aborted && !denied(err)) { setOffline(true); setLoaded(true) }
    } finally { if (refreshing.current === controller) refreshing.current = null }
  }, [denied])

  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    void refresh(true)
    const visible = () => { if (!document.hidden) void refresh(true) }
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 10000)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', visible)
    return () => {
      controller.abort(); clearInterval(timer)
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible)
    }
  }, [refresh])

  const scan = async (preset: ScanPreset): Promise<BodyScan | null> => {
    const controller = lifecycle.current
    if (busy.current || !controller || controller.signal.aborted) return null
    const command = pending ?? { requestId: newId(), preset }
    busy.current = true; setScanning(true); setError(false); setPending(command)
    try { sessionStorage.setItem(requestKey,JSON.stringify(command)) } catch { /* Retry stays in memory. */ }
    try {
      const [result] = await Promise.all([
        api<{scan: BodyScan}>('/body-scans/demo', { body: command, token: session.csrfToken,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) }),
        new Promise(resolve => setTimeout(resolve, 1200)),
      ])
      if (controller.signal.aborted) return null
      setPending(null)
      try { sessionStorage.removeItem(requestKey) } catch { /* No persistent request was stored. */ }
      setLatest(previous => keepLatest(previous,result.scan))
      setItems(previous => mergeScans(previous,[result.scan])); setOffline(false); setError(false)
      return result.scan
    } catch (err) {
      if (controller.signal.aborted) return null
      if (err instanceof ApiError && err.code === 'BODY_DEMO_DISABLED') setDemoEnabled(false)
      else if (!denied(err)) setError(true)
      return null
    } finally {
      busy.current = false
      if (!controller.signal.aborted) setScanning(false)
    }
  }

  const more = async () => {
    const controller = lifecycle.current
    if (!nextCursor || paging.current || !controller || controller.signal.aborted) return
    paging.current = true; setLoadingMore(true)
    try {
      const result = await api<ScanList>('/body-scans?' + new URLSearchParams({limit:'20',cursor:nextCursor}),
        {signal: AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])})
      if (controller.signal.aborted) return
      setItems(previous => mergeScans(previous,result.items)); setNextCursor(result.nextCursor); setOffline(false)
    } catch (err) { if (!controller.signal.aborted && !denied(err)) setOffline(true) }
    finally { paging.current = false; if (!controller.signal.aborted) setLoadingMore(false) }
  }
  return {latest,items,nextCursor,demoEnabled,loaded,offline,error,scanning,pending,scan,more,loadingMore,refresh}
}
