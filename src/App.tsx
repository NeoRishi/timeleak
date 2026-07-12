import { useEffect, useMemo, useState } from 'react'
import {
  formatClock,
  hashSessionId,
  initialOnboardingState,
  loadOnboardingState,
  MONDAY_DEMO_EVENTS,
  parseSchedule,
  saveOnboardingState,
  sleepDurationMinutes,
  type OnboardingState,
  type PriorityCategory,
  type ScheduleMethod,
} from './onboarding'
import './App.css'

export type InstrumentationEvent =
  | 'onboarding_started'
  | 'email_submitted'
  | 'user_created'
  | 'sleep_entered'
  | 'schedule_method_selected'
  | 'schedule_parsed'
  | 'priority_submitted'

export type OnboardingBackend = {
  createUser: (input: {
    email: string
    sessionIdHash: string
    timezone: string
  }) => Promise<{ userId: string; created: boolean }>
  trackEvent: (
    name: InstrumentationEvent,
    properties?: Record<string, unknown>,
    userId?: string,
    sessionId?: string,
  ) => Promise<unknown>
}

const offlineBackend: OnboardingBackend = {
  createUser: async () => ({ userId: 'local-preview', created: true }),
  trackEvent: async () => undefined,
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PRIORITIES: PriorityCategory[] = [
  'Health',
  'Family',
  'Learning',
  'Personal project',
  'Creative work',
  'Other',
]

function App({ backend = offlineBackend }: { backend?: OnboardingBackend }) {
  const [state, setState] = useState<OnboardingState>(() => loadOnboardingState())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const parsedSchedule = useMemo(
    () => parseSchedule(state.pastedSchedule),
    [state.pastedSchedule],
  )

  useEffect(() => saveOnboardingState(state), [state])

  function update(patch: Partial<OnboardingState>) {
    setState((current) => ({ ...current, ...patch }))
    setError('')
  }

  async function record(
    name: InstrumentationEvent,
    properties?: Record<string, unknown>,
    userId = state.userId,
  ) {
    try {
      await backend.trackEvent(
        name,
        properties,
        userId || undefined,
        await hashSessionId(state.sessionId),
      )
    } catch {
      // Instrumentation must never block first value.
    }
  }

  async function begin() {
    update({ started: true, step: 1 })
    await record('onboarding_started')
  }

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault()
    const email = state.email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address.')
      return
    }

    setBusy(true)
    try {
      await record('email_submitted', { emailDomain: email.split('@')[1] })
      const result = await backend.createUser({
        email,
        sessionIdHash: await hashSessionId(state.sessionId),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      })
      update({ email, userId: result.userId, step: 2 })
      await record('user_created', { created: result.created }, result.userId)
    } catch {
      setError('We could not save your email. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitSleep(event: React.FormEvent) {
    event.preventDefault()
    const duration = sleepDurationMinutes(state.sleepStart, state.wakeTime)
    if (duration === 0) {
      setError('Sleep and wake time cannot be the same.')
      return
    }
    if (duration < 240 || duration > 720) {
      setError('Enter a sleep window between 4 and 12 hours.')
      return
    }
    update({ step: 3 })
    await record('sleep_entered', { durationMinutes: duration })
  }

  async function chooseMethod(method: ScheduleMethod) {
    const patch: Partial<OnboardingState> = { scheduleMethod: method }
    if (method === 'demo') {
      patch.scheduleEvents = MONDAY_DEMO_EVENTS
      patch.pastedSchedule = ''
    } else if (method !== 'paste') {
      patch.scheduleEvents = []
    }
    update(patch)
    await record('schedule_method_selected', { method })
  }

  async function submitSchedule() {
    if (state.scheduleMethod === 'screenshot') {
      setError('Screenshot reading is not active yet. Use the Monday demo or paste events.')
      return
    }
    const events = state.scheduleMethod === 'demo' ? MONDAY_DEMO_EVENTS : parsedSchedule.events
    if (!state.scheduleMethod || events.length === 0) {
      setError('Choose the Monday demo or paste at least one schedule line.')
      return
    }
    if (parsedSchedule.errors.length || parsedSchedule.overlaps.length) return

    update({ scheduleEvents: events, step: 4 })
    await record('schedule_parsed', {
      method: state.scheduleMethod,
      eventCount: events.length,
    })
  }

  async function submitPriority(event: React.FormEvent) {
    event.preventDefault()
    if (!state.priorityCategory) {
      setError('Choose the part of life you want to protect.')
      return
    }
    if (!state.priorityText.trim()) {
      setError('Describe one outcome for tomorrow.')
      return
    }
    update({ priorityText: state.priorityText.trim(), step: 5 })
    await record('priority_submitted', {
      category: state.priorityCategory,
      minimumMinutes: state.priorityMinimumMinutes,
    })
  }

  function goBack() {
    if (state.step > 1) update({ step: (state.step - 1) as OnboardingState['step'] })
    else update({ started: false })
  }

  function restart() {
    const fresh = initialOnboardingState()
    setState(fresh)
    setError('')
  }

  return (
    <main className={state.started ? 'flow-shell' : 'landing-shell'}>
      <header className="site-header">
        <button className="wordmark wordmark-button" type="button" onClick={restart} aria-label="TimeLeak home">
          <span className="wordmark-mark" aria-hidden="true" />
          TimeLeak
        </button>
        {state.started && state.step <= 4 ? (
          <div className="progress-wrap" aria-label={`Step ${state.step} of 4`}>
            <span>Step {state.step} of 4</span>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${state.step * 25}%` }} />
            </div>
          </div>
        ) : (
          <span className="mvp-status">
            <span className="status-dot" aria-hidden="true" />
            Buildathon MVP
          </span>
        )}
      </header>

      {!state.started ? (
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">One day. One leak. One repair.</p>
          <h1 id="hero-title">Make room for what matters beyond work.</h1>
          <p className="promise">
            Show us your 24 hours. We find the time you can honestly reclaim and
            protect it for what matters beyond work.
          </p>
          <button className="primary-cta" type="button" onClick={begin}>
            Find My TimeLeak <span aria-hidden="true">→</span>
          </button>
          <p className="scope-note">
            We protect sleep, essential responsibilities, and intentional rest.
          </p>
        </section>
      ) : (
        <section className="flow-content" aria-live="polite">
          {state.step === 1 && (
            <form className="question-panel" onSubmit={submitEmail} noValidate>
              <p className="question-kicker">Save your repair</p>
              <h1>Where should we save tomorrow’s repair?</h1>
              <label className="field-label" htmlFor="email">Email address</label>
              <input
                id="email"
                className="text-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={state.email}
                onChange={(event) => update({ email: event.target.value })}
                placeholder="you@example.com"
                autoFocus
              />
              <p className="field-help">No password needed for this Buildathon MVP.</p>
              <ErrorMessage message={error} />
              <FlowActions onBack={goBack} busy={busy} />
            </form>
          )}

          {state.step === 2 && (
            <form className="question-panel" onSubmit={submitSleep}>
              <p className="question-kicker">Protected first</p>
              <h1>Protect your sleep.</h1>
              <p className="question-copy">We will not reclaim time from this window.</p>
              <div className="time-grid">
                <label className="time-card">
                  <span>Sleep time</span>
                  <input type="time" value={state.sleepStart} onChange={(event) => update({ sleepStart: event.target.value })} />
                </label>
                <label className="time-card">
                  <span>Wake time</span>
                  <input type="time" value={state.wakeTime} onChange={(event) => update({ wakeTime: event.target.value })} />
                </label>
              </div>
              <p className="field-help">Overnight sleep is expected—for example, 11:00 PM to 7:00 AM.</p>
              <ErrorMessage message={error} />
              <FlowActions onBack={goBack} />
            </form>
          )}

          {state.step === 3 && (
            <div className="question-panel">
              <p className="question-kicker">Tomorrow’s full day</p>
              <h1>Show us tomorrow.</h1>
              <p className="question-copy">Choose the fastest honest way to map your waking day.</p>
              <div className="method-grid">
                <MethodCard title="Use the Monday demo" description="Fastest path · ready in one tap" badge="Recommended" selected={state.scheduleMethod === 'demo'} onClick={() => chooseMethod('demo')} />
                <MethodCard title="Paste tomorrow’s events" description="One time range and event per line" selected={state.scheduleMethod === 'paste'} onClick={() => chooseMethod('paste')} />
                <MethodCard title="Upload a screenshot" description="Preview only · OCR is not active yet" badge="Coming later" selected={state.scheduleMethod === 'screenshot'} onClick={() => chooseMethod('screenshot')} />
              </div>

              {state.scheduleMethod === 'demo' && <SchedulePreview events={MONDAY_DEMO_EVENTS} label="Monday, 13 July · 9 events loaded" />}
              {state.scheduleMethod === 'paste' && (
                <div className="paste-panel">
                  <label className="field-label" htmlFor="schedule-lines">Schedule lines</label>
                  <textarea
                    id="schedule-lines"
                    value={state.pastedSchedule}
                    onChange={(event) => update({ pastedSchedule: event.target.value })}
                    placeholder={'9:00 AM - 10:00 AM: Team meeting\n10:30 AM - 12:00 PM: Focus work'}
                  />
                  <p className="field-help">Use explicit start and end times. Parsed events appear below.</p>
                  {parsedSchedule.events.length > 0 && <SchedulePreview events={parsedSchedule.events} label={`${parsedSchedule.events.length} events parsed`} />}
                  {[...parsedSchedule.errors, ...parsedSchedule.overlaps].map((message) => <p className="inline-error" role="alert" key={message}>{message}</p>)}
                </div>
              )}
              {state.scheduleMethod === 'screenshot' && <p className="truth-note">Screenshot OCR is not enabled. We will never pretend an image was read when it was not.</p>}
              <ErrorMessage message={error} />
              <div className="flow-actions">
                <button className="back-button" type="button" onClick={goBack}>Back</button>
                <button
                  className="continue-button"
                  type="button"
                  onClick={submitSchedule}
                  disabled={state.scheduleMethod === 'screenshot' || (state.scheduleMethod === 'paste' && (parsedSchedule.events.length === 0 || parsedSchedule.errors.length > 0 || parsedSchedule.overlaps.length > 0))}
                >Continue</button>
              </div>
            </div>
          )}

          {state.step === 4 && (
            <form className="question-panel" onSubmit={submitPriority}>
              <p className="question-kicker">One thing that matters</p>
              <h1>Name one neglected priority.</h1>
              <div className="priority-grid">
                {PRIORITIES.map((priority) => (
                  <button key={priority} className={`choice-button ${state.priorityCategory === priority ? 'selected' : ''}`} type="button" onClick={() => update({ priorityCategory: priority })}>{priority}</button>
                ))}
              </div>
              <label className="field-label" htmlFor="priority-outcome">What would make tomorrow meaningful?</label>
              <input id="priority-outcome" className="text-input" value={state.priorityText} onChange={(event) => update({ priorityText: event.target.value })} placeholder="Complete one module of my AI course" maxLength={140} />
              <fieldset className="duration-fieldset">
                <legend>Minimum useful block</legend>
                <div className="duration-grid">
                  {([45, 60, 90] as const).map((minutes) => <button key={minutes} className={`choice-button ${state.priorityMinimumMinutes === minutes ? 'selected' : ''}`} type="button" onClick={() => update({ priorityMinimumMinutes: minutes })}>{minutes} minutes</button>)}
                </div>
              </fieldset>
              <ErrorMessage message={error} />
              <FlowActions onBack={goBack} submitLabel="Finish onboarding" />
            </form>
          )}

          {state.step === 5 && (
            <div className="question-panel completion-panel">
              <span className="completion-check" aria-hidden="true">✓</span>
              <p className="question-kicker">Inputs complete</p>
              <h1>Ready to find your TimeLeak.</h1>
              <p className="question-copy">Your day is mapped, your sleep is protected, and one priority is ready for analysis.</p>
              <dl className="summary-list">
                <div><dt>Schedule</dt><dd>{state.scheduleMethod === 'demo' ? 'Monday demo' : `${state.scheduleEvents.length} pasted events`}</dd></div>
                <div><dt>Sleep</dt><dd>{formatClock(state.sleepStart)}–{formatClock(state.wakeTime)}</dd></div>
                <div><dt>Priority</dt><dd>{state.priorityCategory} · {state.priorityMinimumMinutes} minutes</dd></div>
              </dl>
              <button className="back-button" type="button" onClick={() => update({ step: 4 })}>Edit answers</button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return <p className="form-error" role={message ? 'alert' : undefined}>{message}</p>
}

function FlowActions({ onBack, busy = false, submitLabel = 'Continue' }: { onBack: () => void; busy?: boolean; submitLabel?: string }) {
  return (
    <div className="flow-actions">
      <button className="back-button" type="button" onClick={onBack}>Back</button>
      <button className="continue-button" type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </div>
  )
}

function MethodCard({ title, description, badge, selected, onClick }: { title: string; description: string; badge?: string; selected: boolean; onClick: () => void }) {
  return (
    <button className={`method-card ${selected ? 'selected' : ''}`} type="button" aria-label={title} aria-pressed={selected} onClick={onClick}>
      {badge && <span className="method-badge">{badge}</span>}
      <strong>{title}</strong>
      <span>{description}</span>
    </button>
  )
}

function SchedulePreview({ events, label }: { events: OnboardingState['scheduleEvents']; label: string }) {
  return (
    <div className="schedule-preview">
      <p className="preview-label">{label}</p>
      <div className="event-list">
        {events.map((event) => (
          <div className="event-row" key={`${event.start}-${event.end}-${event.title}`}>
            <time>{formatClock(event.start)}–{formatClock(event.end)}</time>
            <span>{event.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
