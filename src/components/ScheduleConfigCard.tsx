import { type Device } from '../api/bridge'
import './ScheduleConfigCard.css'

/**
 * The leading card of the workflow: the schedule's identity (name) and the set
 * of devices it drives. Sized and styled to sit inline with the step cards in
 * the horizontal scroller, but it carries no AC state of its own.
 */
export function ScheduleConfigCard({
  name,
  deviceIds,
  devices,
  devicesLoading,
  devicesError,
  onNameChange,
  onToggleDevice,
}: {
  name: string
  deviceIds: string[]
  /** The discoverable fleet to pick from. */
  devices: Device[]
  devicesLoading: boolean
  devicesError: string | null
  onNameChange: (name: string) => void
  onToggleDevice: (id: string, selected: boolean) => void
}) {
  const selected = new Set(deviceIds)

  return (
    <article className="config-card">
      <header className="config-card__head">
        <h3 className="config-card__title">Schedule</h3>
        <span className="config-card__badge">
          {deviceIds.length} device{deviceIds.length === 1 ? '' : 's'}
        </span>
      </header>

      <label className="config-card__field">
        <span className="config-card__label">Name</span>
        <input
          type="text"
          className="config-card__name"
          placeholder="e.g. Weekday cooling"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </label>

      <div className="config-card__field config-card__devices-field">
        <span className="config-card__label">Applies to</span>

        {devicesLoading && devices.length === 0 && !devicesError && (
          <p className="config-card__hint">Discovering controllers…</p>
        )}
        {devicesError && devices.length === 0 && (
          <p className="config-card__hint config-card__hint--error">{devicesError}</p>
        )}
        {!devicesLoading && !devicesError && devices.length === 0 && (
          <p className="config-card__hint">No controllers discovered yet.</p>
        )}

        <ul className="config-card__devices">
          {devices.map((device) => {
            const isSelected = selected.has(device.id)
            return (
              <li key={device.id}>
                <label className="config-card__device">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => onToggleDevice(device.id, e.target.checked)}
                  />
                  <span className="config-card__device-name">
                    {device.location || 'Unknown location'}
                  </span>
                  <span
                    className={`ac-status ac-status--${device.status}`}
                    title={`Status: ${device.status}`}
                  >
                    <span className="ac-status__dot" aria-hidden="true" />
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>
    </article>
  )
}

export default ScheduleConfigCard
