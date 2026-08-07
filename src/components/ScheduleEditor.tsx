import { Fragment, useState } from 'react'
import { type Device } from '../api/bridge'
import {
  deleteSchedule,
  makeStep,
  saveSchedule,
  sendConfigNow,
  type Schedule,
  type ScheduleStep,
} from '../api/schedule'
import { ScheduleConfigCard } from './ScheduleConfigCard'
import { ScheduleStepCard } from './ScheduleStepCard'
import './ScheduleEditor.css'

/**
 * One schedule, edited in place: a horizontally-scrolling track whose leading
 * config card carries the schedule's name, enablement, device set, and the
 * Save / Delete actions, followed by the ordered step cards.
 *
 * Self-contained state: it seeds a working copy from `initial` (once — the
 * parent keys editors by id, so this instance owns one schedule for its life),
 * edits it locally, and only reaches the parent when a save or delete lands so
 * the page's list can stay in sync.
 */
export function ScheduleEditor({
  initial,
  devices,
  devicesLoading,
  devicesError,
  onSaved,
  onDeleted,
}: {
  initial: Schedule
  devices: Device[]
  devicesLoading: boolean
  devicesError: string | null
  onSaved: (saved: Schedule) => void
  onDeleted: (id: string) => void
}) {
  // Normalize enabled defensively in case the bridge predates the field.
  const [schedule, setSchedule] = useState<Schedule>(() => ({
    ...initial,
    enabled: initial.enabled !== false,
  }))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function markDirty() {
    setSavedAt(null)
    setDirty(true)
  }

  function patch(next: Partial<Schedule>) {
    setSchedule((prev) => ({ ...prev, ...next }))
    markDirty()
  }

  /** Insert a new step at `at` (0 = before the first step). */
  function insertStep(at: number) {
    setSchedule((prev) => {
      const steps = [...prev.steps]
      steps.splice(at, 0, makeStep())
      return { ...prev, steps }
    })
    markDirty()
  }

  function updateStep(next: ScheduleStep) {
    setSchedule((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === next.id ? next : s)),
    }))
    markDirty()
  }

  function deleteStep(id: string) {
    setSchedule((prev) => ({ ...prev, steps: prev.steps.filter((s) => s.id !== id) }))
    markDirty()
  }

  function toggleDevice(id: string, selected: boolean) {
    setSchedule((prev) => {
      const set = new Set(prev.deviceIds)
      if (selected) set.add(id)
      else set.delete(id)
      return { ...prev, deviceIds: [...set] }
    })
    markDirty()
  }

  async function onSave() {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await saveSchedule(schedule)
      setSchedule({ ...saved, enabled: saved.enabled !== false })
      setSavedAt(new Date().toLocaleTimeString())
      setDirty(false)
      onSaved(saved)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the schedule.')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (deleting) return
    const label = schedule.name || 'this schedule'
    if (!window.confirm(`Delete "${label}"? This can't be undone.`)) return
    setDeleting(true)
    setSaveError(null)
    try {
      // Backend delete is idempotent, so this is safe even for a never-saved
      // schedule (created via "New schedule" but not yet persisted).
      await deleteSchedule(schedule.id)
      onDeleted(schedule.id)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to delete the schedule.')
      setDeleting(false)
    }
  }

  /** A round "+" that inserts a step; used between and after cards. */
  const inserter = (at: number) => (
    <div className="editor__insert" key={`insert-${at}`}>
      <button
        type="button"
        className="editor__plus"
        title="Add a step here"
        aria-label="Add a step here"
        onClick={() => insertStep(at)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )

  return (
    <div className="editor__track">
      <ScheduleConfigCard
        name={schedule.name}
        enabled={schedule.enabled}
        deviceIds={schedule.deviceIds}
        devices={devices}
        devicesLoading={devicesLoading}
        devicesError={devicesError}
        saving={saving}
        savedAt={savedAt}
        saveError={saveError}
        dirty={dirty}
        deleting={deleting}
        onNameChange={(name) => patch({ name })}
        onToggleEnabled={(enabled) => patch({ enabled })}
        onToggleDevice={toggleDevice}
        onSave={() => void onSave()}
        onDelete={() => void onDelete()}
      />

      {inserter(0)}

      {schedule.steps.map((step, i) => (
        <Fragment key={step.id}>
          <ScheduleStepCard
            step={step}
            index={i + 1}
            canSend={schedule.deviceIds.length > 0}
            // Send the CURRENT (possibly unsaved) card config to the schedule's
            // current devices — a live push, independent of Save.
            onSendNow={() => sendConfigNow(schedule.deviceIds, step.config)}
            onChange={updateStep}
            onDelete={() => deleteStep(step.id)}
          />
          {inserter(i + 1)}
        </Fragment>
      ))}
    </div>
  )
}

export default ScheduleEditor
