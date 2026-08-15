import { useEffect, useState } from 'react'
import {
  carryOverOptionals,
  isControllableMode,
  VALID_VANE_HORIZ,
  VALID_VANE_VERT,
  type AcConfig,
  type CommandSource,
  type ConfigInput,
  type Device,
  type DeviceStatus,
  type LastCommand,
  type Mode,
  type Power,
  type VanePosition,
} from '../api/bridge'
import { ThumbSlider } from './ThumbSlider'
import './AcCard2.css'

const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: 'Online',
  stale: 'Stale',
  offline: 'Offline',
}

// Human labels for what initiated the last command, shown in the info pane.
const COMMAND_SOURCE_LABEL: Record<CommandSource, string> = {
  manual: 'Manual',
  manual_immediate: 'Manual (send now)',
  scheduled: 'Scheduled',
}

function lastCommandType(last: LastCommand | null): string {
  if (!last) return '—'
  return COMMAND_SOURCE_LABEL[last.source] ?? last.source
}

function lastCommandTime(last: LastCommand | null): string {
  if (!last) return '—'
  const d = new Date(last.at)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

// The subset of modes surfaced as buttons, in display order. `fan` exists in
// the bridge contract but isn't part of this card's controls.
const MODES: { value: Mode; label: string }[] = [
  { value: 'cool', label: 'Cool' },
  { value: 'heat', label: 'Heat' },
  { value: 'auto', label: 'Auto' },
  { value: 'dry', label: 'Dry' },
]

const DEFAULT_VANE = 'auto'

// The vertical vane (up/down flap) can hold a fixed position instead of
// sweeping, which matters on units whose stepper motor clicks audibly while
// swinging. Wire values are still the firmware's "1".."5" (per
// IRremoteESP8266's ir_Mitsubishi.h: 1=Highest .. 5=Lowest); the labels just
// give that scale a human-readable name.
const VANE_VERT_OPTIONS: { value: VanePosition; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '1', label: 'Highest' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Middle' },
  { value: '4', label: 'Low' },
  { value: '5', label: 'Lowest' },
  { value: 'swing', label: 'Swing' },
]

// The horizontal wide vane (left/right louvers) has no firmware "swing"
// option — only fixed positions plus auto.
const VANE_HORIZ_OPTIONS: { value: VanePosition; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'left', label: 'Left' },
  { value: 'mleft', label: 'Mid-left' },
  { value: 'middle', label: 'Middle' },
  { value: 'mright', label: 'Mid-right' },
  { value: 'right', label: 'Right' },
  { value: 'wide', label: 'Wide' },
]

// The slider works in °F for the UI, but the bridge/firmware speaks Celsius, so
// we convert at the API boundary (and when seeding from device state). Values
// round to whole °C to match what the firmware accepts.
const TEMP_MIN = 61
const TEMP_MAX = 88
const DEFAULT_TEMP = 72 // °F, used only when the device has no known temp

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const cToF = (c: number) => Math.round((c * 9) / 5 + 32)
const fToC = (f: number) => Math.round(((f - 32) * 5) / 9)

/**
 * The AC's best-known *actual* state, which the card should display.
 *
 * When the unit is in sync, desired and reported agree, and right after a UI
 * push `desiredConfig` is the freshest truth (the unit's own report lags by up
 * to one reconcile poll). But when the unit has drifted — e.g. someone used the
 * physical remote — `reportedConfig` is the ground truth of what the machine is
 * actually doing, so we prefer it. Either field may be null early on, so we fall
 * back to whichever exists.
 */
function effectiveConfig(device: Device): AcConfig | null {
  return device.inSync
    ? device.desiredConfig ?? device.reportedConfig
    : device.reportedConfig ?? device.desiredConfig
}

type SignalQuality = 'excellent' | 'good' | 'fair' | 'weak' | 'unknown'

/**
 * Map a WiFi RSSI (dBm) to a display string + quality bucket for the info panel.
 * Thresholds match the firmware debugging we did: below ~-78 dBm the ESP32's link
 * gets unreliable, so "weak" is the band worth chasing down.
 */
function rssiInfo(rssi: number | null): { text: string; quality: SignalQuality } {
  if (rssi == null) return { text: '—', quality: 'unknown' }
  let quality: SignalQuality
  if (rssi >= -60) quality = 'excellent'
  else if (rssi >= -70) quality = 'good'
  else if (rssi >= -78) quality = 'fair'
  else quality = 'weak'
  const label = quality[0].toUpperCase() + quality.slice(1)
  return { text: `${rssi} dBm · ${label}`, quality }
}

/** Format the unit's uptime (seconds) compactly, e.g. "3d 4h", "2h 15m", "45s". */
function formatUptime(sec: number | null): string {
  if (sec == null) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * A single AC controller rendered as a flippable control card.
 *
 * The card holds a local *draft* of the desired config (power / mode / temp),
 * seeded from the device on mount. Each control edits the draft and hands the
 * resulting config to `onConfigChange`; the info button flips the card to reveal
 * its address details.
 *
 * The card owns no network knowledge — it never talks to the bridge directly.
 * The write path is entirely the caller's: `onConfigChange` decides what a config
 * change *means*. In the live fleet that's a push to the bridge; a schedule
 * editor could instead capture the config into a draft state to preview it. The
 * card only orchestrates the surrounding UI (pending/error) around whatever the
 * callback does, awaiting it and surfacing any thrown error inline.
 */
export function AcCard2({
  device,
  onConfigChange,
  dummy = false,
}: {
  device: Device
  /**
   * Invoked with the full config the user built whenever a control changes.
   * May be async; if it rejects, the card shows the error inline. This is the
   * card's only write path — swap it to repurpose the card (live control vs.
   * preview) without touching the component.
   */
  onConfigChange: (config: ConfigInput) => Promise<void> | void
  /**
   * A "dummy" card drives a synthetic device (e.g. a schedule step's draft
   * config), not a real unit. It hides the live status badge and disables the
   * info flip, whose device details would be meaningless here — the button stays
   * in place (just inert) so the control row keeps its layout.
   */
  dummy?: boolean
}) {
  // The AC's actual current state — what the controls should mirror. Also the
  // source we preserve fan/vane from when building a push.
  const base = effectiveConfig(device)

  const [power, setPower] = useState<Power>(base?.power ?? 'off')
  const [mode, setMode] = useState<Mode>(base?.mode ?? 'cool')
  // Held in °F for the slider/readout; device state arrives in °C.
  const [temp, setTemp] = useState<number>(
    clamp(base?.temp != null ? cToF(base.temp) : DEFAULT_TEMP, TEMP_MIN, TEMP_MAX),
  )
  const [vaneVert, setVaneVert] = useState<VanePosition>(
    base?.vaneVert != null && VALID_VANE_VERT.has(base.vaneVert) ? base.vaneVert : DEFAULT_VANE,
  )
  const [vaneHoriz, setVaneHoriz] = useState<VanePosition>(
    base?.vaneHoriz != null && VALID_VANE_HORIZ.has(base.vaneHoriz) ? base.vaneHoriz : DEFAULT_VANE,
  )
  const [flipped, setFlipped] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync the draft controls when the device's actual state changes under us
  // (e.g. a reconcile poll learns the physical remote was used). The card
  // instance persists across polls — it's keyed by device id — so without this
  // the controls would stay frozen at their mount-time seed. We skip syncing
  // while a push is in flight so a background poll can't clobber the optimistic
  // state the user just set. Keyed on the concrete values (not object identity),
  // which are primitives, so it only fires on a real change.
  //
  // A field the device doesn't know yet syncs as null, and null means "no news",
  // not "reset to default": the draft keeps its current value. That matters
  // while a unit is off, where the bridge or the unit's own report may carry
  // nulls for everything but power — folding those in as defaults would silently
  // rewrite the user's settings to cool/72°F/auto, which is then what the next
  // power-on would push.
  const syncPower = base?.power ?? 'off'
  const syncMode = base?.mode ?? null
  const syncTempF = base?.temp != null ? clamp(cToF(base.temp), TEMP_MIN, TEMP_MAX) : null
  const syncVaneVert =
    base?.vaneVert != null && VALID_VANE_VERT.has(base.vaneVert) ? base.vaneVert : null
  const syncVaneHoriz =
    base?.vaneHoriz != null && VALID_VANE_HORIZ.has(base.vaneHoriz) ? base.vaneHoriz : null
  useEffect(() => {
    if (pending) return
    setPower(syncPower)
    // reportedConfig may carry 'fan' (fan-only), which isn't a button here —
    // leave the current mode selection as-is rather than forcing an invalid one.
    if (isControllableMode(syncMode)) setMode(syncMode)
    if (syncTempF != null) setTemp(syncTempF)
    if (syncVaneVert != null) setVaneVert(syncVaneVert)
    if (syncVaneHoriz != null) setVaneHoriz(syncVaneHoriz)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncPower, syncMode, syncTempF, syncVaneVert, syncVaneHoriz])

  const statusLabel = STATUS_LABEL[device.status] ?? device.status
  // When the unit is off, the only meaningful controls are power + info; mode,
  // the temp slider, and resend are disabled and the readout shows "—".
  const off = power === 'off'

  /**
   * Build a full config body from the current draft plus any overrides,
   * preserving fan/vane settings the bridge already knows about.
   *
   * Powering off sends the same full body as powering on, differing only in
   * `power` — mode/temp/fan/vane are optional to the bridge validator when
   * power is `'off'`, and sending them keeps the unit's stored config intact.
   * A bare `{ power: 'off' }` would null out every other field, so the next
   * power-on would have nothing to restore and would come back at defaults
   * rather than the state the user left the unit in.
   */
  function buildConfig(
    overrides: Partial<Pick<ConfigInput, 'power' | 'mode' | 'temp' | 'vaneVert' | 'vaneHoriz'>>,
  ): ConfigInput {
    // The draft mode is normally a button mode, but it can be seeded from a
    // reported fan-only ('fan') state; fall back to a valid mode so the push
    // isn't rejected.
    const nextMode = overrides.mode ?? mode
    const cfg: ConfigInput = {
      schema: 1,
      power: overrides.power ?? power,
      mode: isControllableMode(nextMode) ? nextMode : 'cool',
      // Overrides and draft state are °F; the bridge expects °C.
      temp: fToC(overrides.temp ?? temp),
    }
    // Seed fan (not user-editable here) and vane from the actual state, then
    // let the vane draft — which the user edits directly — win over it.
    carryOverOptionals(cfg, base)
    cfg.vaneVert = overrides.vaneVert ?? vaneVert
    cfg.vaneHoriz = overrides.vaneHoriz ?? vaneHoriz
    return cfg
  }

  /** Hand a config to the caller's write path, surfacing any failure inline. */
  async function apply(config: ConfigInput) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onConfigChange(config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the unit.')
    } finally {
      setPending(false)
    }
  }

  function togglePower() {
    const next: Power = power === 'on' ? 'off' : 'on'
    setPower(next)
    void apply(buildConfig({ power: next }))
  }

  function selectMode(next: Mode) {
    setMode(next)
    setPower('on') // choosing a mode implies the unit should be running
    void apply(buildConfig({ power: 'on', mode: next }))
  }

  function commitTemp(next: number) {
    setTemp(next)
    if (power === 'on') void apply(buildConfig({ temp: next }))
  }

  function selectVaneVert(next: VanePosition) {
    setVaneVert(next)
    if (power === 'on') void apply(buildConfig({ vaneVert: next }))
  }

  function selectVaneHoriz(next: VanePosition) {
    setVaneHoriz(next)
    if (power === 'on') void apply(buildConfig({ vaneHoriz: next }))
  }

  return (
    <article className="ac2">
      <div className={`ac2__inner${flipped ? ' is-flipped' : ''}`}>
        {/* --- Front: controls --- */}
        <div className="ac2__face ac2__front">
          <header className="ac2__head">
            <h3 className="ac2__name">{device.location || 'Unknown location'}</h3>
            {!dummy && (
              <span
                className={`ac-status ac-status--${device.status}`}
                title={`Status: ${statusLabel}`}
              >
                <span className="ac-status__dot" aria-hidden="true" />
                {statusLabel}
              </span>
            )}
          </header>

          <div className="ac2__temp">
            <span className={`ac2__temp-readout${off ? ' ac2__temp-readout--off' : ''}`}>
              {off ? '—' : temp}
            </span>
            <div className="ac2__temp-slider">
              <ThumbSlider
                value={temp}
                min={TEMP_MIN}
                max={TEMP_MAX}
                onChange={setTemp}
                onCommit={commitTemp}
                disabled={pending || off}
              />
            </div>
          </div>

          <div className="ac2__modes" role="group" aria-label="Mode">
            {MODES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`ac2__btn ac2__mode${mode === value ? ' is-active' : ''}`}
                aria-pressed={mode === value}
                onClick={() => selectMode(value)}
                disabled={pending || off}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ac2__vanes">
            <label className="ac2__vane-field">
              <span className="ac2__vane-label">Vertical</span>
              <select
                className="ac2__select"
                aria-label="Vertical fin position"
                value={vaneVert}
                onChange={(e) => selectVaneVert(e.target.value)}
                disabled={pending || off}
              >
                {VANE_VERT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ac2__vane-field">
              <span className="ac2__vane-label">Horizontal</span>
              <select
                className="ac2__select"
                aria-label="Horizontal fin position"
                value={vaneHoriz}
                onChange={(e) => selectVaneHoriz(e.target.value)}
                disabled={pending || off}
              >
                {VANE_HORIZ_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="ac2__actions">
            <button
              type="button"
              className={`ac2__btn ac2__power${power === 'on' ? ' is-on' : ''}`}
              aria-pressed={power === 'on'}
              onClick={togglePower}
              disabled={pending}
            >
              {power === 'on' ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              className="ac2__btn ac2__icon-btn"
              title="Resend current config"
              aria-label="Resend current config"
              onClick={() => void apply(buildConfig({}))}
              disabled={pending || off}
            >
              <ResendIcon />
            </button>
            <button
              type="button"
              className="ac2__btn ac2__icon-btn"
              title={dummy ? 'Device info unavailable' : 'Device info'}
              aria-label="Device info"
              onClick={() => setFlipped(true)}
              disabled={dummy}
            >
              <InfoIcon />
            </button>
          </div>

          {error && (
            <p className="ac2__error" role="alert">
              {error}
            </p>
          )}

          {off && (
            <button
              type="button"
              className="ac2__off-overlay"
              onClick={togglePower}
              disabled={pending}
              aria-label={`Turn on ${device.location || 'unit'}`}
            >
              <span className="ac2__off-overlay-icon">
                <PowerIcon />
              </span>
            </button>
          )}
        </div>

        {/* --- Back: address details. Title + table scroll; Back button is
            pinned so it's always reachable regardless of list length. --- */}
        <div className="ac2__face ac2__back" aria-hidden={!flipped}>
          <div className="ac2__back-scroll">
            <h3 className="ac2__back-title">{device.location || 'Unknown location'}</h3>
            <dl className="ac2__details">
            <div className="ac2__detail-row">
              <dt>Last command type</dt>
              <dd>{lastCommandType(device.lastCommand)}</dd>
            </div>
            <div className="ac2__detail-row">
              <dt>Last command time</dt>
              <dd>{lastCommandTime(device.lastCommand)}</dd>
            </div>
            <div className="ac2__detail-row">
              <dt>Location</dt>
              <dd>{device.location || '—'}</dd>
            </div>
            <div className="ac2__detail-row">
              <dt>Device ID</dt>
              <dd>{device.id}</dd>
            </div>
            <div className="ac2__detail-row">
              <dt>Firmware</dt>
              <dd>{device.firmware || '—'}</dd>
            </div>
            <div className="ac2__detail-row">
              <dt>IP address</dt>
              <dd>{device.ip ? `${device.ip}:${device.port}` : '—'}</dd>
            </div>
            <div className="ac2__detail-row">
              <dt>Signal</dt>
              <dd className={`ac2__rssi ac2__rssi--${rssiInfo(device.rssi).quality}`}>
                {rssiInfo(device.rssi).text}
              </dd>
            </div>
            <div className="ac2__detail-row">
              <dt>Uptime</dt>
              <dd>{formatUptime(device.uptimeSec)}</dd>
            </div>
            </dl>
          </div>
          <button
            type="button"
            className="ac2__btn ac2__back-close"
            onClick={() => setFlipped(false)}
          >
            Back
          </button>
        </div>
      </div>
    </article>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12" y2="8" strokeLinecap="round" />
    </svg>
  )
}

function ResendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  )
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="12" y1="2" x2="12" y2="12" strokeLinecap="round" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" strokeLinecap="round" />
    </svg>
  )
}

export default AcCard2
