import { useEffect, useState } from 'react'
import { api, ApiError, parseSse, restricted, stationBase } from './api'
import { addEmergency, applySummary } from './domain'
import type { CrewSummary, Emergency, Snapshot, SummaryEvent, View } from './domain'
import type { AssessmentSummary } from './news2'
import { acceptRadiation, type RadiationSnapshot } from './radiation'

export type Feed = {
  radiation: RadiationSnapshot | null
  assessments: AssessmentSummary[]
  assessmentRevision: number
  rows: CrewSummary[]
  status: 'syncing' | 'connected' | 'offline'
  syncedAt: string | null
  loaded: boolean
  historyRevision: Record<string, string>
  trainingRevision: number
  emergencies: Emergency[]
}
const empty: Feed = {
  radiation: null,
  assessments: [],
  assessmentRevision: 0,
  rows: [], status: 'syncing', syncedAt: null, loaded: false, historyRevision: {},
  emergencies: [], trainingRevision: 0,
}

export function useFeed(view: View, deny: () => void, onEmergency: (item: Emergency) => void) {
  const [feed, setFeed] = useState<Feed>(empty)
  useEffect(() => {
    let disposed = false
    let controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let watchdog: ReturnType<typeof setTimeout>
    let cursor = ''
    let scope: number | null = null
    let rows: CrewSummary[] = []
    let assessments: AssessmentSummary[] = []
    let radiation: RadiationSnapshot | null = null
    let assessmentRevision = 0
    let historyRevision: Record<string, string> = {}
    let emergencies: Emergency[] = []
    let retries = 0
    let trainingRevision = 0
    const versions = new Map<string, number>()
    const publish = (status: Feed['status'], changed = false) => {
      if (!disposed)
        setFeed((prev) => ({
          rows,
          radiation,
          assessments,
          assessmentRevision,
          historyRevision,
          trainingRevision,
          emergencies,
          status,
          loaded: scope !== null,
          syncedAt: changed ? new Date().toISOString() : prev.syncedAt,
        }))
    }
    const reset = () => {
      cursor = ''
      scope = null
      rows = []
      assessments = []
      radiation = null
      historyRevision = {}
      emergencies = []
      versions.clear()
      if (!disposed) setFeed(empty)
    }
    const armWatchdog = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => controller.abort(), 35000)
    }
    async function connect() {
      if (!navigator.onLine) {
        publish('offline')
        timer = setTimeout(connect, 1000)
        return
      }
      controller = new AbortController()
      const signal = controller.signal
      try {
        armWatchdog()
        if (scope === null) {
          const snap = await api<Snapshot>('/snapshot?view=' + view, { signal })
          if (disposed) return
          scope = snap.scopeVersion
          cursor = snap.cursor
          rows = snap.crewSummaries
          radiation = snap.radiation ?? null
          assessments = snap.news2Assessments ?? []
          assessmentRevision++
          trainingRevision++
          emergencies = snap.emergencies ?? []
          for (const row of rows) versions.set(row.crewId, row.entityVersion ?? row.version ?? 0)
          publish('syncing', true)
        }
        const query = new URLSearchParams({ view, cursor })
        const res = await fetch(stationBase + '/v1/events/stream?' + query, {
          signal,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'text/event-stream', 'Last-Event-ID': cursor },
        })
        if (!res.ok) throw new ApiError(res.status, 'Stream unavailable')
        if (!res.body) throw new Error('Missing stream')
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        let connected = false
        while (!disposed) {
          const { done, value } = await reader.read()
          if (done) throw new Error('Stream ended')
          armWatchdog()
          buffer += value
          let sep = /\r?\n\r?\n/.exec(buffer)
          while (sep) {
            const msg = parseSse(buffer.slice(0, sep.index))
            buffer = buffer.slice(sep.index + sep[0].length)
            if (msg.event === 'stream.reset_required') throw new ApiError(410, 'Refresh snapshot')
            if (msg.event === 'stream.ready') {
              const ready = JSON.parse(msg.data)
              if (ready.scopeVersion !== scope || ready.view !== view) throw new ApiError(409, 'Scope changed')
              connected = true
              trainingRevision++
              retries = 0
              publish('connected', true)
            }
            if (msg.event === 'crew_summary.updated' && (!msg.id || msg.id !== cursor)) {
              const event: SummaryEvent = JSON.parse(msg.data)
              if (scope !== event.scopeVersion) throw new ApiError(409, 'Scope changed')
              rows = applySummary(rows, versions, event)
              publish(connected ? 'connected' : 'syncing', true)
            }
            if (msg.event === 'radiation.updated') {
              const event = JSON.parse(msg.data)
              if (event.scopeVersion !== scope) throw new ApiError(409, 'Scope changed')
              radiation = acceptRadiation(radiation, event.payload)
              publish(connected ? 'connected' : 'syncing', true)
            }
            if (msg.id !== cursor && ['measurement.accepted', 'measurement.corrected'].includes(msg.event)) {
              const event = JSON.parse(msg.data)
              if (event.scopeVersion !== scope) throw new ApiError(409, 'Scope changed')
              const crewId: string = event.payload.subject.id
              historyRevision = { ...historyRevision, [crewId]: msg.id }
              publish(connected ? 'connected' : 'syncing', true)
            }
            if (msg.id !== cursor && msg.event === 'news2.updated') {
              const event = JSON.parse(msg.data)
              if (event.scopeVersion !== scope) throw new ApiError(409, 'Scope changed')
              const item: AssessmentSummary = event.payload
              assessmentRevision++
              assessments = [...assessments.filter(a => a.crewId !== item.crewId), item]
              publish(connected ? 'connected' : 'syncing', true)
            }
            if (msg.id !== cursor && msg.event === 'emergency.created') {
              const event = JSON.parse(msg.data)
              if (event.scopeVersion !== scope) throw new ApiError(409, 'Scope changed')
              const updated = addEmergency(emergencies, event.payload)
              if (updated !== emergencies) {
                emergencies = updated
                publish(connected ? 'connected' : 'syncing', true)
                onEmergency(event.payload)
              }
            }
            if (msg.id && msg.id !== cursor && ['task.updated', 'team_tasks.updated'].includes(msg.event)) {
              if (JSON.parse(msg.data).scopeVersion !== scope) throw new ApiError(409, 'Scope changed')
              trainingRevision++
              publish(connected ? 'connected' : 'syncing', true)
            }
            if (msg.id) cursor = msg.id
            sep = /\r?\n\r?\n/.exec(buffer)
          }
        }
      } catch (error) {
        if (disposed) return
        controller.abort()
        if (restricted(error)) {
          reset()
          deny()
          return
        }
        const rebuild = (error instanceof ApiError && [409, 410].includes(error.status)) ||
          error instanceof SyntaxError || (error instanceof Error && error.message.startsWith('Invalid'))
        if (rebuild) reset()
        else publish('offline')
        const delay = rebuild ? 0 : Math.min(15000, 1000 * 2 ** retries++) + Math.random() * 200
        timer = setTimeout(connect, delay)
      } finally {
        clearTimeout(watchdog)
      }
    }
    reset()
    void connect()
    const offline = () => { controller.abort(); publish('offline') }
    const online = () => { clearTimeout(timer); if (controller.signal.aborted) void connect() }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
      clearTimeout(watchdog)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }, [view, deny, onEmergency])
  return feed
}
