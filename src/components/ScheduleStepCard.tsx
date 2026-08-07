import { useEffect, useState } from 'react'
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
  canSend,
  onSendNow,
  onChange,
  onDelete,
}: {
  step: ScheduleStep
  /** 1-based position, shown as the step's label. */
  index: number
  /** Whether the schedule has any devices to send to (else the button is off). */
  canSend: boolean
  /** Push this step's config to the schedule's devices right now. Rejects on failure. */
  onSendNow: () => Promise<void>
  /** Called with the updated step whenever its time or config changes. */
  onChange: (next: ScheduleStep) => void
  onDelete: () => void
}) {
  const [sending, setSending] = useState(false)
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; message: string } | null>(null)

  // Clear a success note after a moment so the header doesn't keep a stale badge.
  useEffect(() => {
    if (!sendStatus?.ok) return
    const t = setTimeout(() => setSendStatus(null), 3000)
    return () => clearTimeout(t)
  }, [sendStatus])

  async function handleSend() {
    if (sending) return
    setSending(true)
    setSendStatus(null)
    try {
      await onSendNow()
      setSendStatus({ ok: true, message: 'Sent' })
    } catch (err) {
      setSendStatus({ ok: false, message: err instanceof Error ? err.message : 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  return (
    <article className="step-card">
      <header className="step-card__head">
        <span className="step-card__index">Step {index}</span>
        <div className="step-card__actions">
          <button
            type="button"
            className="step-card__send"
            title={
              canSend
                ? "Send this step's config to the schedule's devices now"
                : 'Select devices on the schedule card to enable sending'
            }
            aria-label={`Send step ${index} now`}
            disabled={!canSend || sending}
            onClick={() => void handleSend()}
          >
            <SendIcon />
          </button>
          <button
            type="button"
            className="step-card__delete"
            title="Delete step"
            aria-label={`Delete step ${index}`}
            onClick={onDelete}
          >
            <TrashIcon />
          </button>
        </div>
      </header>

      {sendStatus && (
        <p
          className={`step-card__send-status${sendStatus.ok ? '' : ' step-card__send-status--error'}`}
          role="status"
        >
          {sendStatus.message}
        </p>
      )}

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
        // Synthetic device: no live status, and the info panel would be empty.
        dummy
      />
    </article>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
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
