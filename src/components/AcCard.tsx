import { useState } from 'react'
import {
  powerConfig,
  setDeviceConfig,
  type Device,
  type DeviceStatus,
  type Power,
} from '../api/bridge'

const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: 'Online',
  stale: 'Stale',
  offline: 'Offline',
}

/** A single discovered AC controller, rendered as a card. */
export function AcCard({
  device,
  onChanged,
}: {
  device: Device
  /** Called after a successful power change so the list can refresh. */
  onChanged?: () => void
}) {
  const status = device.status
  const statusLabel = STATUS_LABEL[status] ?? status

  // Which power action is in flight, if any — drives the disabled/busy state.
  const [pending, setPending] = useState<Power | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function setPower(power: Power) {
    if (pending) return
    setPending(power)
    setActionError(null)
    try {
      await setDeviceConfig(device.id, powerConfig(device, power))
      onChanged?.()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to change power.')
    } finally {
      setPending(null)
    }
  }

  return (
    <article className="ac-card">
      <header className="ac-card__head">
        <div className="ac-card__titles">
          <h3 className="ac-card__location">{device.location || 'Unknown location'}</h3>
          <span className="ac-card__id">{device.id}</span>
        </div>
        <span
          className={`ac-status ac-status--${status}`}
          title={`Status: ${statusLabel}`}
        >
          <span className="ac-status__dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </header>

      <dl className="ac-card__meta">
        <div>
          <dt>Firmware</dt>
          <dd>{device.firmware ?? '—'}</dd>
        </div>
        <div>
          <dt>IP</dt>
          <dd>{device.ip ?? '—'}</dd>
        </div>
      </dl>

      {!device.inSync && (
        <p className="ac-badge ac-badge--warn" title="Unit has drifted from its desired state">
          Out of sync
        </p>
      )}

      <div className="ac-card__actions">
        <button
          type="button"
          className="ac-btn ac-btn--on"
          onClick={() => void setPower('on')}
          disabled={pending !== null}
        >
          {pending === 'on' ? 'Turning on…' : 'On'}
        </button>
        <button
          type="button"
          className="ac-btn ac-btn--off"
          onClick={() => void setPower('off')}
          disabled={pending !== null}
        >
          {pending === 'off' ? 'Turning off…' : 'Off'}
        </button>
      </div>

      {actionError && (
        <p className="ac-card__action-error" role="alert">
          {actionError}
        </p>
      )}
    </article>
  )
}

export default AcCard
