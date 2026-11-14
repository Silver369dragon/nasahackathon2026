export type RadiationPerson = {
  crewId: string; experienceYears: number; historyDays: number; historyMsv: number | null
  knownHistoryMsv: number | null; currentMsv: number | null; comparableTotalMsv: number | null
  historyStatus: string; comparabilityKey: string
}
export type RadiationSnapshot = {
  schemaVersion: 'radiation/1'; missionId: string; version: number; controlVersion: number
  startedAt: string; elapsedMs: number; checkpointAt: string; serverTime: string
  isSimulated: true; sourceMode: 'simulation' | 'json'
  environment: { rateUsvH: number | null; radiationEvent: string; sourceStatus: string
    lastObservedAt: string | null; lastReceivedAt: string | null; modelVersion: string }
  sharedExposure: { currentMsv: number | null; lastValidCurrentMsv: number | null
    lastValidAt: string | null; coverage: string; cumulativeAuthority: string }
  crewExposure: RadiationPerson[]
  activeEvent: { id: string; type: string; startedMs: number; eventAddedMsv: number | null } | null
  recentRatePoints: { elapsedMs: number; rateUsvH: number | null }[]
}
export type RadiationHistory = { id: string; missionLabel: string; startAt: string; endAt: string
  exposureDays: number; doseEquivalentMsv: number; method: string; isSimulated: boolean }

export function acceptRadiation(current: RadiationSnapshot | null, next: RadiationSnapshot) {
  return current?.missionId === next.missionId && current.version >= next.version ? current : next
}
export function radiationNumber(value: number | null | undefined, digits: number) {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}
export function radiationFresh(data: RadiationSnapshot | null, connected: boolean, now = Date.now()) {
  return !!data && connected && data.environment.sourceStatus === 'fresh' &&
    now - Date.parse(data.checkpointAt) <= 5000
}
