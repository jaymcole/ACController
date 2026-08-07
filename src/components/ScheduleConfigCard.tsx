import { type Device } from '../api/bridge'
import './ScheduleConfigCard.css'

/**
 * The leading card of a schedule: its identity (name), enablement, the devices
 * it drives, and the per-schedule actions (Save / Delete). Sized and styled to
 * sit inline with the step cards in the horizontal scroller, but it carries no
 * AC state of its own.
 */
export function ScheduleConfigCard({
  name,
  enabled,
  deviceIds,
  devices,
  devicesLoading,
  devicesError,
  saving,
  savedAt,
  saveError,
  dirty,
  deleting,
  onNameChange,
  onToggleEnabled,
  onToggleDevice,
  onSave,
  onDelete,
}: {
  name: string
  enabled: boolean
  deviceIds: string[]
  /** The discoverable fleet to pick from. */
  devices: Device[]
  devicesLoading: boolean
  devicesError: string | null
  saving: boolean
  savedAt: string | null
  saveError: string | null
  /** Unsaved edits pending — drives the Save label + a reminder for the toggle. */
  dirty: boolean
  deleting: boolean
  onNameChange: (name: string) => void
  onToggleEnabled: (enabled: boolean) => void
  onToggleDevice: (id: string, selected: boolean) => void
  onSave: () => void
  onDelete: () => void
}) {
  const selected = new Set(deviceIds)

  return (
    <article className={`config-card${enabled ? '' : ' config-card--disabled'}`}>
      <header className="config-card__head">
        <h3 className="config-card__title">Schedule</h3>
        <label className="switch" title={enabled ? 'Enabled' : 'Disabled'}>
          <input
            type="checkbox"
            className="switch__input"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
          />
          <span className="switch__track" aria-hidden="true">
            <span className="switch__thumb" />
          </span>
          <span className="switch__text">{enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
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
        <span className="config-card__label">
          Applies to
          <span className="config-card__count">
            {deviceIds.length} device{deviceIds.length === 1 ? '' : 's'}
          </span>
        </span>

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

      <footer className="config-card__actions">
        <div className="config-card__action-row">
          <button
            type="button"
            className="config-card__save"
            onClick={onSave}
            disabled={saving || deleting}
          >
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
          <button
            type="button"
            className="config-card__delete"
            onClick={onDelete}
            disabled={saving || deleting}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
        <div className="config-card__status" aria-live="polite">
          {saveError ? (
            <span className="config-card__status-error" role="alert">
              {saveError}
            </span>
          ) : dirty ? (
            <span className="config-card__status-note">Unsaved changes</span>
          ) : savedAt ? (
            <span className="config-card__status-note">Saved {savedAt}</span>
          ) : null}
        </div>
      </footer>
    </article>
  )
}

export default ScheduleConfigCard
