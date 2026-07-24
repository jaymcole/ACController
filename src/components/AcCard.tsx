import type { Device, DeviceStatus } from '../api/bridge'

const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: 'Online',
  stale: 'Stale',
  offline: 'Offline',
}

/** A single discovered AC controller, rendered as a card. */
export function AcCard({ device }: { device: Device }) {
  const status = device.status
  const statusLabel = STATUS_LABEL[status] ?? status

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
    </article>
  )
}

export default AcCard
