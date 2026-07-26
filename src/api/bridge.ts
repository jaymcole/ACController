// Client-side layer for talking to the Node bridge server, which discovers
// ESP32-based AC controllers on the local network and exposes them over HTTP.
//
// The base URL is never hardcoded in components — it comes from the
// VITE_BRIDGE_URL env var, falling back to the conventional bridge address.

// Same-origin path by default: HouseGraph (prod) and vite.config.ts (dev) both
// reverse-proxy `/bridge/*` to the bridge, so no CORS or bridge.local needed.
export const BRIDGE_URL: string =
  import.meta.env.VITE_BRIDGE_URL ?? '/bridge'

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
/** Abort a request that neither resolves nor rejects (e.g. a name that never
 *  resolves via mDNS on some devices), so the UI can't hang forever. */
const REQUEST_TIMEOUT_MS = 8_000

export async function getDevices(signal?: AbortSignal): Promise<DevicesResponse> {
  // Fail the fetch if either the caller cancels (unmount/refresh) or we hit the
  // timeout. A single controller drives both so we only pass one signal to fetch.
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${BRIDGE_URL}/devices`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (err) {
    // Caller-initiated cancel: propagate AbortError so the hook ignores it.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // Our timeout fired: the request hung (commonly a bridge host that won't
    // resolve on this device, e.g. iOS mDNS not answering `bridge.local`).
    if (controller.signal.aborted) {
      throw new BridgeError(
        "The bridge server didn't respond in time. Is it reachable from this device?",
        'timeout',
        err,
      )
    }

    // Network-level failure: DNS, connection refused, CORS, offline, etc. A
    // CORS-blocked response is indistinguishable from a true network failure
    // here — both reject as `TypeError: Failed to fetch` — but they need
    // different fixes, so log the real cause. A "blocked by CORS policy" line
    // just above this means the bridge responded but didn't allow this origin.
    console.error(
      `[bridge] fetch to ${BRIDGE_URL}/devices failed. If the Network tab shows ` +
        `a 200 for this request, it's almost certainly CORS (missing/mismatched ` +
        `Access-Control-Allow-Origin for ${window.location.origin}), not an ` +
        `unreachable server.`,
      err,
    )
    throw new BridgeError(
      "Can't reach the bridge server. Is it running, and does it allow this origin (CORS)?",
      'network_error',
      err,
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
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

/**
 * Body accepted by `POST /devices/:id/config`, mirroring the bridge's
 * schema-v1 validator: `schema` and `power` are always required, and `mode`
 * plus `temp` are required whenever `power` is `'on'`. The remaining fields are
 * optional. Unknown keys are rejected by the bridge, so this is a closed shape.
 */
export interface ConfigInput {
  schema: 1
  power: Power
  mode?: Mode
  temp?: number
  fan?: FanSpeed
  vaneVert?: VanePosition
  vaneHoriz?: VanePosition
}

// Fallbacks used only when turning a unit on with no prior config to reuse —
// the bridge requires a mode + temp when power is 'on'.
const DEFAULT_ON_MODE: Mode = 'cool'
const DEFAULT_ON_TEMP = 16

/**
 * Build the config body for flipping a unit's power. Turning off needs nothing
 * but `power: 'off'`. Turning on requires a mode + temp, so we reuse the
 * device's last-known desired (or reported) config and preserve fan/vane where
 * present, falling back to sensible defaults only when nothing is known.
 */
export function powerConfig(device: Device, power: Power): ConfigInput {
  if (power === 'off') return { schema: 1, power: 'off' }

  const base = device.desiredConfig ?? device.reportedConfig
  const cfg: ConfigInput = {
    schema: 1,
    power: 'on',
    mode: base?.mode ?? DEFAULT_ON_MODE,
    temp: base?.temp ?? DEFAULT_ON_TEMP,
  }
  if (base?.fan != null) cfg.fan = base.fan
  if (base?.vaneVert != null) cfg.vaneVert = base.vaneVert
  if (base?.vaneHoriz != null) cfg.vaneHoriz = base.vaneHoriz
  return cfg
}

/**
 * Push a desired config to a unit via `POST /devices/:id/config`. The bridge
 * validates the body, proxies it to the unit, and returns the updated
 * {@link Device}. Throws a {@link BridgeError} on validation, network, timeout,
 * or unit-unreachable failures — same error contract as {@link getDevices}.
 */
export async function setDeviceConfig(
  id: string,
  config: ConfigInput,
  signal?: AbortSignal,
): Promise<Device> {
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${BRIDGE_URL}/devices/${encodeURIComponent(id)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(config),
      signal: controller.signal,
    })
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (controller.signal.aborted) {
      throw new BridgeError(
        "The bridge server didn't respond in time. Is it reachable from this device?",
        'timeout',
        err,
      )
    }
    throw new BridgeError(
      "Can't reach the bridge server. Is it running, and does it allow this origin (CORS)?",
      'network_error',
      err,
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
  }

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

  const device = (body as { device?: Device } | null)?.device
  if (!device) {
    throw new BridgeError('Bridge returned an unexpected response.', 'bad_response')
  }
  return device
}
