import { setDeviceConfig, type ConfigInput } from '../api/bridge'
import { useDevices } from '../hooks/useDevices'
import { AcCard2 } from './AcCard2'
import './DeviceList.css'

/** Fetches and displays the fleet of discovered AC controllers. */
export function DeviceList() {
  const { devices, count, loading, error, refresh } = useDevices()

  return (
    <section className="device-list">
      <header className="device-list__head">
        <h2>AC Controllers</h2>
        <button type="button" className="device-list__refresh" onClick={refresh}>
          Refresh
        </button>
      </header>

      {/* Loading: only on the very first load, before we have any data. */}
      {loading && devices.length === 0 && !error && (
        <div className="device-list__state" role="status">
          <span className="spinner" aria-hidden="true" />
          <p>Discovering controllers…</p>
        </div>
      )}

      {/* Error: the bridge may be down or unreachable. */}
      {error && devices.length === 0 && (
        <div className="device-list__state device-list__state--error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      {/* Empty: reached the bridge, but nothing has been discovered. */}
      {!loading && !error && count === 0 && (
        <div className="device-list__state">
          <p>No controllers discovered yet.</p>
        </div>
      )}

      {devices.length > 0 && (
        <>
          {/* A stale error while we still have cached cards: show a banner
              rather than blowing away the last-known-good list. */}
          {error && <p className="device-list__banner" role="alert">{error}</p>}
          <div className="device-list__grid">
            {devices.map((device) => (
              <AcCard2
                key={device.id}
                device={device}
                // Live write path: push the config to the bridge, then refresh
                // the fleet so the card reseeds from the unit's new state.
                onConfigChange={async (config: ConfigInput) => {
                  await setDeviceConfig(device.id, config)
                  refresh()
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default DeviceList
