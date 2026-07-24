// Client-side layer for talking to the Node bridge server, which discovers
// ESP32-based AC controllers on the local network and exposes them over HTTP.
//
// The base URL is never hardcoded in components — it comes from the
// VITE_BRIDGE_URL env var, falling back to the conventional bridge address.

export const BRIDGE_URL: string =
  import.meta.env.VITE_BRIDGE_URL ?? 'http://bridge.local:8080'

export type DeviceStatus = 'online' | 'stale' | 'offline'

export type Power = 'on' | 'off'
export type Mode = 'cool' | 'heat' | 'dry' | 'fan' | 'auto'
export type FanSpeed = string
export type VanePosition = string

/** A desired or reported AC configuration. Any unlearned field may be null. */
export interface AcConfig {
  schema: number
  power: Power | null
  mode: Mode | null
  temp: number | null
  fan: FanSpeed | null
  vaneVert: VanePosition | null
  vaneHoriz: VanePosition | null
}

/**
 * A discovered AC controller. Per the bridge contract, keys are always
 * present but values the bridge hasn't learned yet are `null` (never missing),
 * so callers must code defensively against null values.
 */
export interface Device {
  id: string
  location: string
  firmware: string
  schema: number
  ip: string
  port: number
  status: DeviceStatus
  lastSeen: string
  rssi: number | null
  uptimeSec: number | null
  unitConfigId: number
  desiredConfigId: number
  inSync: boolean
  applied: boolean
  desiredConfig: AcConfig | null
  reportedConfig: AcConfig | null
}

/** Success shape of `GET /devices`. */
export interface DevicesResponse {
  devices: Device[]
  count: number
}

/** Uniform error shape returned by the bridge on any non-2xx response. */
export interface BridgeErrorBody {
  ok: false
  error: {
    code: string
    message: string
    details: unknown | null
  }
}

/**
 * Error thrown by bridge API calls. Carries a machine-readable `code` for
 * branching and a human-readable `message` for display.
 */
export class BridgeError extends Error {
  code: string
  details: unknown

  constructor(message: string, code: string, details: unknown = null) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
    this.details = details
  }
}

function isBridgeErrorBody(value: unknown): value is BridgeErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.ok === false &&
    typeof v.error === 'object' &&
    v.error !== null &&
    typeof (v.error as Record<string, unknown>).message === 'string'
  )
}

/**
 * Fetch the list of discovered AC controllers from the bridge.
 *
 * Throws a {@link BridgeError} on both network failures (bridge unreachable —
 * the fetch rejects before any JSON is available) and on non-2xx responses
 * carrying the uniform `{ ok: false, error }` body.
 */
export async function getDevices(signal?: AbortSignal): Promise<DevicesResponse> {
  let res: Response
  try {
    res = await fetch(`${BRIDGE_URL}/devices`, {
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (err) {
    // Network-level failure: DNS, connection refused, CORS, offline, etc.
    // No JSON ever arrives here, so surface a friendly, generic message.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new BridgeError(
      "Can't reach the bridge server. Is it running?",
      'network_error',
      err,
    )
  }

  // Parse the body once; the bridge sends JSON for both success and error.
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    if (isBridgeErrorBody(body)) {
      throw new BridgeError(body.error.message, body.error.code, body.error.details)
    }
    throw new BridgeError(
      `Bridge returned ${res.status} ${res.statusText}`,
      'http_error',
    )
  }

  const data = body as DevicesResponse
  return {
    devices: Array.isArray(data?.devices) ? data.devices : [],
    count: typeof data?.count === 'number' ? data.count : 0,
  }
}
