// Client-side layer for automated AC control *schedules*.
//
// A schedule is an ordered list of steps; each step is a full AC config to
// transmit to a set of devices at a given time of day. The state each step
// carries is exactly the {@link ConfigInput} the bridge already accepts, so a
// step reuses the same control surface as the live fleet (the AcCard).
//
// These call the bridge's `/schedules` endpoints, mirroring the error contract
// and fetch conventions of `./bridge` (shared timeout, caller-cancellable
// AbortController, single JSON parse, uniform `{ ok:false, error }` envelope
// surfaced as a thrown BridgeError).

import {
  BRIDGE_URL,
  BridgeError,
  REQUEST_TIMEOUT_MS,
  isBridgeErrorBody,
  setDeviceConfig,
  type AcConfig,
  type ConfigInput,
} from './bridge'

/** One transmission in a schedule: send `config` to the schedule's devices at `time`. */
export interface ScheduleStep {
  /** Stable client-side id; also seeds the AcCard's React key. */
  id: string
  /** Time of day to execute, 24h "HH:MM" (local). Empty until the user sets it. */
  time: string
  /** The AC state to push when this step fires — the same body the bridge takes. */
  config: ConfigInput
}

/** A named, automated sequence applied to a chosen set of devices. */
export interface Schedule {
  id: string
  name: string
  /** When false, the bridge persists the schedule but arms no triggers — it
   *  won't run until re-enabled. Defaults to true for new/legacy schedules. */
  enabled: boolean
  /** Device ids (from the fleet) this schedule drives. */
  deviceIds: string[]
  /** Ordered steps, left-to-right in the editor. */
  steps: ScheduleStep[]
}

/** A stable id for new steps/schedules. `randomUUID` is fine for our targets. */
export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

// A new step defaults to a live, illustrative state (cool at 72°F) rather than
// "off", so the card renders with its controls populated and the user can see
// what they're editing. Temp is Celsius at the bridge boundary; 22°C ≈ 72°F.
const DEFAULT_STEP_CONFIG: ConfigInput = { schema: 1, power: 'on', mode: 'cool', temp: 22 }

/** Build a blank step with a fresh id and the default target state. */
export function makeStep(): ScheduleStep {
  return { id: newId(), time: '', config: { ...DEFAULT_STEP_CONFIG } }
}

/** Build a blank schedule with a single starter step. Enabled by default. */
export function makeSchedule(): Schedule {
  return { id: newId(), name: '', enabled: true, deviceIds: [], steps: [makeStep()] }
}

/**
 * Adapt a step's {@link ConfigInput} into the {@link AcConfig} shape the AcCard
 * reads from a device. `ConfigInput` omits fields it doesn't set; `AcConfig`
 * requires every key with `null` for the unknown ones, so we widen here.
 */
export function configToAcConfig(cfg: ConfigInput): AcConfig {
  return {
    schema: cfg.schema,
    power: cfg.power,
    mode: cfg.mode ?? null,
    temp: cfg.temp ?? null,
    fan: cfg.fan ?? null,
    vaneVert: cfg.vaneVert ?? null,
    vaneHoriz: cfg.vaneHoriz ?? null,
  }
}

// --- Network layer ---------------------------------------------------------
//
// Real `fetch` calls to the bridge's `/schedules` routes. These mirror
// `getDevices`/`setDeviceConfig` in ./bridge: a single AbortController drives
// both the caller's `signal` and a REQUEST_TIMEOUT_MS timeout, the JSON body is
// parsed once, and a `{ ok:false, error }` envelope (or a bare non-2xx) is
// surfaced as a thrown BridgeError carrying the machine-readable `code`.

/**
 * Shared request helper for the schedule endpoints. Resolves to the parsed JSON
 * body (or `null` for an empty body). Throws {@link BridgeError} on timeout,
 * network failure, or any non-2xx — except that `allow404` lets a 404 resolve to
 * `null` instead of throwing (used by getSchedule).
 */
async function scheduleFetch(
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  allow404 = false,
): Promise<unknown> {
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${BRIDGE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
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

  // Parse the body once; the bridge sends JSON for both success and error.
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (res.status === 404 && allow404) return null

  if (!res.ok) {
    if (isBridgeErrorBody(body)) {
      throw new BridgeError(body.error.message, body.error.code, body.error.details)
    }
    throw new BridgeError(`Bridge returned ${res.status} ${res.statusText}`, 'http_error')
  }

  return body
}

/** `GET /schedules` → all saved schedules. */
export async function getSchedules(signal?: AbortSignal): Promise<Schedule[]> {
  const body = await scheduleFetch('/schedules', { method: 'GET' }, signal)
  const data = body as { schedules?: Schedule[] } | null
  return Array.isArray(data?.schedules) ? data!.schedules : []
}

/** `GET /schedules/:id` → one schedule, or `null` if it doesn't exist (404). */
export async function getSchedule(id: string, signal?: AbortSignal): Promise<Schedule | null> {
  const body = await scheduleFetch(
    `/schedules/${encodeURIComponent(id)}`,
    { method: 'GET' },
    signal,
    true, // a 404 means "no such schedule" → resolve null, don't throw
  )
  if (body === null) return null
  const data = body as { schedule?: Schedule }
  return data.schedule ?? null
}

/** `PUT /schedules/:id` (upsert) → the persisted schedule. */
export async function saveSchedule(schedule: Schedule, signal?: AbortSignal): Promise<Schedule> {
  const body = await scheduleFetch(
    `/schedules/${encodeURIComponent(schedule.id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedule),
    },
    signal,
  )
  const saved = (body as { schedule?: Schedule } | null)?.schedule
  if (!saved) {
    throw new BridgeError('Bridge returned an unexpected response.', 'bad_response')
  }
  return saved
}

/** `DELETE /schedules/:id`. Idempotent server-side (deleting a missing id is ok). */
export async function deleteSchedule(id: string, signal?: AbortSignal): Promise<void> {
  await scheduleFetch(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }, signal)
}

/**
 * Immediately push `config` to every device id — the "send now" path for a
 * schedule step. Takes the same route as manual control ({@link setDeviceConfig},
 * i.e. POST /devices/:id/config) and isolates per-device failures so one offline
 * unit doesn't block the rest. Resolves when all succeed (or there are no
 * devices); throws a {@link BridgeError} summarizing the failures otherwise.
 *
 * `push` is injectable so the fan-out/summary logic is unit-testable without the
 * network.
 */
export async function sendConfigNow(
  deviceIds: string[],
  config: ConfigInput,
  push: (id: string, config: ConfigInput) => Promise<unknown> = (id, cfg) =>
    setDeviceConfig(id, cfg, undefined, 'manual_immediate'),
): Promise<void> {
  if (deviceIds.length === 0) return

  const results = await Promise.allSettled(deviceIds.map((id) => push(id, config)))
  const failures = results
    .map((r, i) => ({ r, id: deviceIds[i] }))
    .filter((x): x is { r: PromiseRejectedResult; id: string } => x.r.status === 'rejected')
  if (failures.length === 0) return

  const reasonOf = (r: PromiseRejectedResult) =>
    r.reason instanceof Error ? r.reason.message : String(r.reason)
  const first = failures[0]
  if (failures.length === deviceIds.length) {
    throw new BridgeError(
      deviceIds.length === 1
        ? reasonOf(first.r)
        : `All ${deviceIds.length} devices failed (e.g. ${first.id}: ${reasonOf(first.r)})`,
      'send_failed',
    )
  }
  throw new BridgeError(
    `${failures.length} of ${deviceIds.length} devices failed (e.g. ${first.id}: ${reasonOf(first.r)})`,
    'send_partial_failure',
  )
}
