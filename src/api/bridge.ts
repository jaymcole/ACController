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

/** What initiated a command sent to a unit. */
export type CommandSource = 'manual' | 'manual_immediate' | 'scheduled'

/** The most recent command initiated against a unit (from the bridge's log). */
export interface LastCommand {
  source: CommandSource
  /** ISO-8601 timestamp of when the command was initiated. */
  at: string
}

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
  /** Most recent command initiated against this unit, or null if none yet. */
  lastCommand: LastCommand | null
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

export function isBridgeErrorBody(value: unknown): value is BridgeErrorBody {
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
 *  resolves via mDNS on some devices), so the UI can't hang forever. Exported so
 *  sibling clients (e.g. the schedule API) share the same timeout budget. */
export const REQUEST_TIMEOUT_MS = 8_000

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

// The value vocabularies the bridge's schema-v1 validator accepts. A config
// *reported* by a unit can legitimately carry firmware-only values that these
// don't include — notably fan 'silent' and mode 'fan' (fan-only), which the AC's
// physical remote can set — so anything reused from a reported config must be
// filtered against these or the bridge will reject the push with a 400.
const CONTROLLABLE_MODES: readonly Mode[] = ['auto', 'cool', 'heat', 'dry']
const VALID_FAN = new Set(['auto', '1', '2', '3', '4'])
// Exported so callers (e.g. the vane controls on AcCard2) can validate/enumerate
// the same vocabulary the bridge's schema-v1 validator accepts, instead of
// duplicating it.
export const VALID_VANE_VERT = new Set(['auto', '1', '2', '3', '4', '5', 'swing'])
export const VALID_VANE_HORIZ = new Set(['left', 'mleft', 'middle', 'mright', 'right', 'wide', 'auto'])

/** True if `m` is a mode the bridge accepts on a push (excludes fan-only). */
export function isControllableMode(m: Mode | null | undefined): m is Mode {
  return m != null && CONTROLLABLE_MODES.includes(m)
}

/**
 * Copy fan/vane settings from a prior config onto a push body, but only values
 * the bridge validator accepts — dropping firmware-only ones (e.g. fan
 * 'silent') so reusing an observed remote state can't produce a rejected push.
 */
export function carryOverOptionals(cfg: ConfigInput, base: AcConfig | null | undefined): void {
  if (base?.fan != null && VALID_FAN.has(base.fan)) cfg.fan = base.fan
  if (base?.vaneVert != null && VALID_VANE_VERT.has(base.vaneVert)) cfg.vaneVert = base.vaneVert
  if (base?.vaneHoriz != null && VALID_VANE_HORIZ.has(base.vaneHoriz)) cfg.vaneHoriz = base.vaneHoriz
}

/**
 * Build the config body for flipping a unit's power: the device's last-known
 * state with only `power` changed.
 *
 * Powering off deliberately still sends mode/temp/fan/vane (all optional to the
 * validator when power is `'off'`). A bare `{ power: 'off' }` would overwrite
 * the bridge's desired config with nulls for every other field, so turning the
 * unit back on later would have nothing to restore and would fall back to the
 * defaults below — the unit would come back at 16°C cool instead of where the
 * user left it. Defaults apply only when nothing is known about the device.
 */
export function powerConfig(device: Device, power: Power): ConfigInput {
  const base = device.desiredConfig ?? device.reportedConfig
  const cfg: ConfigInput = {
    schema: 1,
    power,
    mode: isControllableMode(base?.mode) ? base!.mode : DEFAULT_ON_MODE,
    temp: base?.temp ?? DEFAULT_ON_TEMP,
  }
  carryOverOptionals(cfg, base)
  return cfg
}

/**
 * Push a desired config to a unit via `POST /devices/:id/config`. The bridge
 * validates the body, proxies it to the unit, and returns the updated
 * {@link Device}. Throws a {@link BridgeError} on validation, network, timeout,
 * or unit-unreachable failures — same error contract as {@link getDevices}.
 *
 * `source` tags what initiated the command for the bridge's audit log; it
 * defaults to `'manual'` (a direct control on the Controllers page).
 */
export async function setDeviceConfig(
  id: string,
  config: ConfigInput,
  signal?: AbortSignal,
  source: CommandSource = 'manual',
): Promise<Device> {
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(
      `${BRIDGE_URL}/devices/${encodeURIComponent(id)}/config?source=${encodeURIComponent(source)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(config),
        signal: controller.signal,
      },
    )
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
