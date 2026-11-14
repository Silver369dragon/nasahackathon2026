import { useCallback, useEffect, useMemo } from 'react'
import { metrics, monitoringMetrics, prettyValue, selectReadings } from './domain'
import { useFeed } from './useFeed'

const ignoreNotice = () => {}

// This view runs only in the cabin's display station. The normal board and the
// wall thus share authorization, snapshot/replay, quality rules and reconnects.
export function WallFeed() {
  const deny = useCallback(() => {
    window.parent.postMessage({ type: 'ship-wall-auth-required' }, window.location.origin)
  }, [])
  const feed = useFeed('system_display', deny, ignoreNotice)
  const packet = useMemo(() => ({
    type: 'ship-wall-feed', status: feed.status, syncedAt: feed.syncedAt,
    radiation: feed.radiation,
    rows: feed.rows.map(crew => ({
      name: crew.name, crewId: crew.crewId,
      readings: monitoringMetrics.map(metric => {
        const records = selectReadings(crew.metricCards, metric, 'latest')
        const record = records.find(r => r !== null)
        const issue = records.find(r => r && r.quality !== 'good')
        return {
          code: metric.code, name: metric.en, label: metric.zh, unit: metric.unit,
          value: records.map(r => prettyValue(r)).join(' / '),
          observedAt: record?.observedAt ?? null,
          status: issue?.quality ?? crew.metricCards.find(c => c.metricCode === record?.metricCode)?.freshness ?? 'no_data',
          synthetic: record?.provenance.isSynthetic ?? false,
        }
      }),
      values: metrics.map(metric => {
        const readings = selectReadings(crew.metricCards, metric, 'latest')
        const value = readings.map(r => prettyValue(r)).join('/')
        const stale = readings.some(r => r?.quality === 'good' &&
          crew.metricCards.some(card => card.metricCode === r.metricCode && card.freshness === 'stale'))
        return stale ? value + '*' : value
      }),
    })),
    emergency: feed.emergencies[0] ?? null,
  }), [feed.status, feed.rows, feed.syncedAt, feed.emergencies, feed.radiation])
  useEffect(() => {
    const publish = () => window.parent.postMessage(packet, window.location.origin)
    publish()
    // Also lets the parent detect a lost embedded document after a service restart.
    const heartbeat = window.setInterval(publish, 10000)
    return () => window.clearInterval(heartbeat)
  }, [packet])
  return null
}
