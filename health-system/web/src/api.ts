import type { Emergency } from './domain'

// The cabin hosts each training device under its own authenticated URL prefix.
export const stationBase = typeof window === 'undefined' ? '' :
  window.location.pathname.match(/^\/stations\/[a-z]+(?=\/)/)?.[0] ?? ''

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
export function restricted(error: unknown) {
  return error instanceof ApiError && [401, 403].includes(error.status)
}

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export async function api<T>(
  path: string,
  opts: { body?: unknown; token?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (opts.body !== undefined) headers.set('Content-Type', 'application/json')
  if (opts.token) headers.set('X-CSRF-Token', opts.token)
  const response = await fetch(stationBase + '/v1' + path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: opts.signal,
    headers,
    method: opts.body === undefined ? 'GET' : 'POST',
    body: JSON.stringify(opts.body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, payload?.error?.message ?? String(response.status), payload?.error?.code)
  if (!payload || !('data' in payload)) throw new Error('Invalid API response')
  return payload.data
}

export async function sendEmergency(commandId: string, token: string) {
  const result = await api<{ emergency: Emergency }>('/emergencies', {
    body: { commandId }, token, signal: AbortSignal.timeout(8000),
  })
  return result.emergency
}

export function parseSse(frame: string) {
  let event = 'message'
  let id = ''
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('id:')) id = line.slice(3).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  return { event, id, data: data.join('\n') }
}
