import { Fragment, useState } from 'react'
import { useDevices } from '../hooks/useDevices'
import {
  makeSchedule,
  makeStep,
  saveSchedule,
  type Schedule,
  type ScheduleStep,
} from '../api/schedule'
import { ScheduleConfigCard } from './ScheduleConfigCard'
import { ScheduleStepCard } from './ScheduleStepCard'
import './ScheduleWorkflow.css'

/**
 * The schedule builder: a horizontally-scrolling track of cards.
 *
 * Layout, left to right: a config card (name + device selection), then the
 * ordered step cards. A "+" sits between every pair of neighbours (and after
 * the last card); clicking one inserts a fresh step at that position, so the
 * user grows the schedule in place rather than only appending.
 */
export function ScheduleWorkflow() {
  const { devices, loading: devicesLoading, error: devicesError } = useDevices()
  const [schedule, setSchedule] = useState<Schedule>(() => makeSchedule())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  function patch(next: Partial<Schedule>) {
    setSchedule((prev) => ({ ...prev, ...next }))
    setSavedAt(null)
  }

  /** Insert a new step at `at` (0 = before the first step). */
  function insertStep(at: number) {
    setSchedule((prev) => {
      const steps = [...prev.steps]
      steps.splice(at, 0, makeStep())
      return { ...prev, steps }
    })
    setSavedAt(null)
  }

  function updateStep(next: ScheduleStep) {
    setSchedule((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === next.id ? next : s)),
    }))
    setSavedAt(null)
  }

  function deleteStep(id: string) {
    setSchedule((prev) => ({ ...prev, steps: prev.steps.filter((s) => s.id !== id) }))
    setSavedAt(null)
  }

  function toggleDevice(id: string, selected: boolean) {
    setSchedule((prev) => {
      const set = new Set(prev.deviceIds)
      if (selected) set.add(id)
      else set.delete(id)
      return { ...prev, deviceIds: [...set] }
    })
    setSavedAt(null)
  }

  async function onSave() {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      // Stubbed until the schedule backend lands (see api/schedule.ts).
      const saved = await saveSchedule(schedule)
      setSchedule(saved)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the schedule.')
    } finally {
      setSaving(false)
    }
  }

  /** A round "+" that inserts a step; used between and after cards. */
  const inserter = (at: number) => (
    <div className="workflow__insert" key={`insert-${at}`}>
      <button
        type="button"
        className="workflow__plus"
        title="Add a step here"
        aria-label="Add a step here"
        onClick={() => insertStep(at)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )

  return (
    <section className="workflow">
      <header className="workflow__head">
        <h2>Schedule</h2>
        <div className="workflow__actions">
          {savedAt && <span className="workflow__saved">Saved {savedAt}</span>}
          {saveError && (
            <span className="workflow__save-error" role="alert">
              {saveError}
            </span>
          )}
          <button
            type="button"
            className="workflow__save"
            onClick={() => void onSave()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </header>

      <p className="workflow__hint">
        Build the sequence left to right. Each step sends its state to the selected
        devices at the given time. Scroll sideways to see the whole schedule.
      </p>

      {/* Horizontal track. The config card leads; a "+" precedes the first step,
          sits between steps, and trails the last one. */}
      <div className="workflow__track">
        <ScheduleConfigCard
          name={schedule.name}
          deviceIds={schedule.deviceIds}
          devices={devices}
          devicesLoading={devicesLoading}
          devicesError={devicesError}
          onNameChange={(name) => patch({ name })}
          onToggleDevice={toggleDevice}
        />

        {inserter(0)}

        {schedule.steps.map((step, i) => (
          <Fragment key={step.id}>
            <ScheduleStepCard
              step={step}
              index={i + 1}
              onChange={updateStep}
              onDelete={() => deleteStep(step.id)}
            />
            {inserter(i + 1)}
          </Fragment>
        ))}
      </div>
    </section>
  )
}

export default ScheduleWorkflow
