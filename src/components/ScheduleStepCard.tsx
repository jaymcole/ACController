import { type ConfigInput, type Device } from '../api/bridge'
import { configToAcConfig, type ScheduleStep } from '../api/schedule'
import { AcCard2 } from './AcCard2'
import './ScheduleStepCard.css'

/**
 * Present a step's config *through* an AcCard by handing the card a synthetic
 * device seeded from the step. The card only reads a device's effective config
 * (and, when `inSync`, prefers `desiredConfig`), so a minimal in-memory device
 * is enough to drive its controls — no network fields are meaningful here. The
 * id is stable per step so React keeps the same card instance across edits and
 * the card's own re-sync effect stays well-behaved.
 */
function stepDevice(step: ScheduleStep): Device {
  const cfg = configToAcConfig(step.config)
  return {
    id: `step-${step.id}`,
    location: 'Target state',
    firmware: '',
    schema: cfg.schema,
    ip: '',
    port: 0,
    status: 'online',
    lastSeen: '',
    rssi: null,
    uptimeSec: null,
    unitConfigId: 0,
    desiredConfigId: 0,
    inSync: true,
    applied: true,
    desiredConfig: cfg,
    reportedConfig: cfg,
  }
}

/**
 * One step in the schedule workflow: a wrapper card carrying the execution time
 * and a delete control, around an {@link AcCard2} that edits the state to send.
 *
 * The wrapper owns the step's *scheduling* metadata (when); the embedded card
 * owns the *payload* (what). Edits in the card flow up through `onChange` as a
 * new {@link ConfigInput}, which the parent folds back into the step.
 */
export function ScheduleStepCard({
  step,
  index,
  onChange,
  onDelete,
}: {
  step: ScheduleStep
  /** 1-based position, shown as the step's label. */
  index: number
  /** Called with the updated step whenever its time or config changes. */
  onChange: (next: ScheduleStep) => void
  onDelete: () => void
}) {
  return (
    <article className="step-card">
      <header className="step-card__head">
        <span className="step-card__index">Step {index}</span>
        <button
          type="button"
          className="step-card__delete"
          title="Delete step"
          aria-label={`Delete step ${index}`}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      </header>

      <label className="step-card__time">
        <span className="step-card__time-label">Run at</span>
        <input
          type="time"
          className="step-card__time-input"
          value={step.time}
          onChange={(e) => onChange({ ...step, time: e.target.value })}
        />
      </label>

      <AcCard2
        device={stepDevice(step)}
        // Schedule write path: instead of pushing to the bridge, capture the
        // config the user built into this step's draft.
        onConfigChange={(config: ConfigInput) => onChange({ ...step, config })}
      />
    </article>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

export default ScheduleStepCard
