import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, newId, restricted, sendEmergency } from './api'
import type { Session } from './domain'

const pendingKey = (username: string) => 'orbital.emergency.pending.' + username
export function clearSavedHelp(username: string) {
  sessionStorage.removeItem(pendingKey(username))
}

export function useHelp(session: Session, connected: boolean, deny: () => void) {
  const [status, setStatus] = useState<'idle' | 'queued' | 'sending' | 'sent' | 'unknown' | 'rejected'>(() =>
    sessionStorage.getItem(pendingKey(session.username)) ? 'queued' : 'idle')
  const pending = useRef(sessionStorage.getItem(pendingKey(session.username)))
  const sending = useRef(false)
  const mounted = useRef(true)
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(retry.current) }
  }, [])

  const transmit = useCallback(async function transmit(commandId: string, retryOnce: boolean) {
    if (sending.current || commandId !== pending.current) return
    clearTimeout(retry.current)
    sending.current = true
    setStatus('sending')
    try {
      await sendEmergency(commandId, session.csrfToken)
      if (!mounted.current) return
      pending.current = null
      clearSavedHelp(session.username)
      setStatus('sent')
    } catch (error) {
      if (!mounted.current) return
      if (restricted(error)) { deny(); return }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        pending.current = null
        clearSavedHelp(session.username)
        setStatus('rejected')
        return
      }
      setStatus('unknown')
      if (retryOnce) retry.current = setTimeout(() => void transmit(commandId, false), 1000)
    } finally {
      sending.current = false
    }
  }, [deny, session.csrfToken, session.username])
  useEffect(() => {
    if (connected && pending.current) void transmit(pending.current, true)
    return () => clearTimeout(retry.current)
  }, [connected, transmit])

  function request() {
    if (sending.current || !session.crewId) return
    const commandId = pending.current ?? newId()
    pending.current = commandId
    sessionStorage.setItem(pendingKey(session.username), commandId)
    if (connected) void transmit(commandId, true)
    else setStatus('queued')
  }
  return { status, request, sending: status === 'sending', pending: !!pending.current }
}
