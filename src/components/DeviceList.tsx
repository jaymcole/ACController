import { useState } from 'react'
import { setDeviceConfig, type ConfigInput } from '../api/bridge'
import { useDevices } from '../hooks/useDevices'
import { AcCard2 } from './AcCard2'
import './DeviceList.css'

/**
 * Copy text to the clipboard across browsers and deployment contexts. The
 * async Clipboard API requires a secure context (HTTPS or localhost), but
 * this app is served plain-HTTP on the LAN — where it's simply absent on
 * Windows Chrome/Edge and blocked on iOS Safari. The legacy execCommand path
 * has no such restriction, so it's the one that actually works here; a
 * prompt() is the last resort so there's always a way to grab the text.
 */
async function copyToClipboard(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to the legacy path below.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)

  if (!ok) window.prompt('Copy the device details below:', text)
}

/** Fetches and displays the fleet of discovered AC controllers. */
export function DeviceList() {
  const { devices, count, loading, error, refresh } = useDevices()
  const [copied, setCopied] = useState(false)

  // Dumps the exact bridge Device objects (id, ip, location, etc.) as JSON so
  // they can be pasted elsewhere — e.g. for spotting duplicate/stale entries.
  async function copyDetails() {
    await copyToClipboard(JSON.stringify(devices, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="device-list">
      <header className="device-list__head">
        <h2>AC Controllers</h2>
        <div className="device-list__actions">
          <button
            type="button"
            className="device-list__refresh"
            onClick={() => void copyDetails()}
            disabled={devices.length === 0}
          >
            {copied ? 'Copied!' : 'Copy details'}
          </button>
          <button type="button" className="device-list__refresh" onClick={refresh}>
            Refresh
          </button>
        </div>
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
