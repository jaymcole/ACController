// Client-side layer for automated AC control *schedules*.
//
// A schedule is an ordered list of steps; each step is a full AC config to
// transmit to a set of devices at a given time of day. The state each step
// carries is exactly the {@link ConfigInput} the bridge already accepts, so a
// step reuses the same control surface as the live fleet (the AcCard).
//
// The schedule backend does not exist yet, so the network methods below are
// STUBS: they log, simulate latency, and resolve against an in-memory store.
// The signatures mirror the bridge's `{ ok, error }` conventions so swapping in
// real `fetch` calls later is a drop-in — callers here are already written to
// await promises that may reject.

import type { AcConfig, ConfigInput } from './bridge'

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

/** Build a blank schedule with a single starter step. */
export function makeSchedule(): Schedule {
  return { id: newId(), name: '', deviceIds: [], steps: [makeStep()] }
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

// --- Stubbed network layer -------------------------------------------------
//
// Everything below stands in for a schedule API the bridge doesn't expose yet.
// It keeps a module-level store so a save/reload round-trips within a session,
// and fakes latency so the UI's pending/optimistic paths are exercised. Replace
// each body with a real `fetch` to the bridge when the endpoints land; the
// return contracts should stay the same.

const SIMULATED_LATENCY_MS = 400

let store: Schedule[] = []

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

/** STUB — `GET /schedules`. Returns the schedules saved this session. */
export async function getSchedules(): Promise<Schedule[]> {
  console.info('[schedule:stub] getSchedules')
  // Deep-ish clone so callers can't mutate the store by reference.
  return delay(store.map((s) => ({ ...s, deviceIds: [...s.deviceIds], steps: s.steps.map((st) => ({ ...st })) })))
}

/** STUB — `GET /schedules/:id`. */
export async function getSchedule(id: string): Promise<Schedule | null> {
  console.info('[schedule:stub] getSchedule', id)
  const found = store.find((s) => s.id === id) ?? null
  return delay(found ? { ...found, deviceIds: [...found.deviceIds], steps: found.steps.map((st) => ({ ...st })) } : null)
}

/** STUB — `PUT /schedules/:id` (upsert). Returns the persisted schedule. */
export async function saveSchedule(schedule: Schedule): Promise<Schedule> {
  console.info('[schedule:stub] saveSchedule', schedule)
  const idx = store.findIndex((s) => s.id === schedule.id)
  const saved: Schedule = { ...schedule, deviceIds: [...schedule.deviceIds], steps: schedule.steps.map((st) => ({ ...st })) }
  if (idx >= 0) store[idx] = saved
  else store.push(saved)
  return delay({ ...saved })
}

/** STUB — `DELETE /schedules/:id`. */
export async function deleteSchedule(id: string): Promise<void> {
  console.info('[schedule:stub] deleteSchedule', id)
  store = store.filter((s) => s.id !== id)
  return delay(undefined)
}
