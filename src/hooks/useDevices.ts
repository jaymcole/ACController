import { useCallback, useEffect, useRef, useState } from 'react'
import { getDevices, type Device } from '../api/bridge'

const POLL_INTERVAL_MS = 10_000

export interface UseDevicesResult {
  devices: Device[]
  count: number
  /** True only for the initial load; polls refresh silently in the background. */
  loading: boolean
  /** Human-readable message when the last fetch failed, else null. */
  error: string | null
  /** Trigger an out-of-band refresh (e.g. a manual "Refresh" button). */
  refresh: () => void
}

/** Sort by location so cards keep a stable order between polls. */
function byLocation(a: Device, b: Device): number {
  return a.location.localeCompare(b.location)
}

/**
 * Fetches the discovered controllers from the bridge and keeps the list fresh
 * by polling every 10 seconds. Cleans up its timer and any in-flight request
 * on unmount.
 */
export function useDevices(): UseDevicesResult {
  const [devices, setDevices] = useState<Device[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Track the active request so a poll can cancel a slow prior one, and so we
  // never call setState after unmount.
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const { devices: fetched, count: total } = await getDevices(controller.signal)
      if (!mountedRef.current || controller.signal.aborted) return
      setDevices([...fetched].sort(byLocation))
      setCount(total)
      setError(null)
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      if (mountedRef.current && !controller.signal.aborted) setLoading(false)
    }
  }, [])

  const refresh = useCallback(() => {
    void load()
  }, [load])

  useEffect(() => {
    mountedRef.current = true
    void load()
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [load])

  return { devices, count, loading, error, refresh }
}
