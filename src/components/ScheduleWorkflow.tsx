import { useEffect, useState } from 'react'
import { useDevices } from '../hooks/useDevices'
import { getSchedules, makeSchedule, type Schedule } from '../api/schedule'
import { ScheduleEditor } from './ScheduleEditor'
import './ScheduleWorkflow.css'

/**
 * The schedules page: every saved schedule shown at once, stacked vertically,
 * each edited in place by its own {@link ScheduleEditor} (which owns that
 * schedule's Save / Delete / enable). A page-level "New schedule" appends a
 * fresh, unsaved editor. The page just owns the *set* of schedules — load them
 * on mount, add on New, drop on delete, refresh on save — while each editor owns
 * its own working copy and network calls.
 */
export function ScheduleWorkflow() {
  const { devices, loading: devicesLoading, error: devicesError } = useDevices()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Load all saved schedules on mount so a refresh restores them.
  useEffect(() => {
    const controller = new AbortController()
    getSchedules(controller.signal)
      .then((saved) => setSchedules(saved))
      .catch((err) => {
        if (controller.signal.aborted) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load saved schedules.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  function addSchedule() {
    setSchedules((prev) => [...prev, makeSchedule()])
  }

  /** Fold a saved schedule back into the list so the page copy stays current. */
  function syncSchedule(saved: Schedule) {
    setSchedules((prev) => prev.map((s) => (s.id === saved.id ? saved : s)))
  }

  function removeSchedule(id: string) {
    setSchedules((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <section className="schedules">
      <header className="schedules__head">
        <h2>Schedules</h2>
        <button
          type="button"
          className="schedules__new"
          onClick={addSchedule}
          disabled={loading}
        >
          + New schedule
        </button>
      </header>

      <p className="schedules__hint">
        Each schedule runs its steps daily at their set times. Build a schedule
        left to right; scroll a schedule sideways to see all its steps. Disable a
        schedule to pause it without deleting it.
      </p>

      {loading && <p className="schedules__status">Loading…</p>}
      {loadError && (
        <p className="schedules__status schedules__status--error" role="alert">
          {loadError}
        </p>
      )}
      {!loading && !loadError && schedules.length === 0 && (
        <p className="schedules__status">
          No schedules yet. Press “+ New schedule” to create one.
        </p>
      )}

      <div className="schedules__list">
        {schedules.map((s) => (
          <div className="schedules__item" key={s.id}>
            <ScheduleEditor
              initial={s}
              devices={devices}
              devicesLoading={devicesLoading}
              devicesError={devicesError}
              onSaved={syncSchedule}
              onDeleted={removeSchedule}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

export default ScheduleWorkflow
