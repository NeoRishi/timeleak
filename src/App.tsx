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
import {
  createCalendarFile,
  createPublicSharePayload,
  downloadTextFile,
  loadSavedResult,
  saveResult,
} from './result'
import {
  runTimeLeakPipeline,
  type PipelineExecution,
  type PipelineInput,
} from './timeleakPipeline'
import './App.css'

export type InstrumentationEvent =
  | 'onboarding_started'
  | 'email_submitted'
  | 'user_created'
  | 'sleep_entered'
  | 'schedule_method_selected'
  | 'schedule_parsed'
  | 'priority_submitted'

export type CheckoutResult = {
  mode: 'demo' | 'test' | 'live'
  amountUsdCents: 999
  customerEmail: string
  checkoutUrl: string
}

export type PaymentState = {
  accessStatus: 'free' | 'paid' | 'refunded'
  accessUntil?: number
  payment: null | {
    id: string
    status: 'pending' | 'paid' | 'failed' | 'refunded'
    amountUsdCents: number
    mode: 'demo' | 'test' | 'live'
    paidAt?: number
    refundDeadline?: number
  }
  refundRequest: null | { status: 'requested' | 'processing' | 'completed' | 'rejected'; requestedAt: number }
}

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
  analyze: (input: PipelineInput) => Promise<PipelineExecution>
  startCheckout: (input: { userId: string; email: string }) => Promise<CheckoutResult>
  getPaymentState: (userId: string) => Promise<PaymentState>
  requestRefund: (input: { userId: string; paymentId: string }) => Promise<unknown>
}

const offlineBackend: OnboardingBackend = {
  createUser: async () => ({ userId: 'local-preview', created: true }),
  trackEvent: async () => undefined,
  analyze: (input) => runTimeLeakPipeline(input),
  startCheckout: async ({ email }) => ({
    mode: 'demo',
    amountUsdCents: 999,
    customerEmail: email,
    checkoutUrl: `${window.location.origin}/checkout/demo?amount=999`,
  }),
  getPaymentState: async () => ({ accessStatus: 'free', payment: null, refundRequest: null }),
  requestRefund: async () => undefined,
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
  const [analysis, setAnalysis] = useState<Pick<PipelineExecution, 'result' | 'repairedBlocks'> | null>(() => loadSavedResult())
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

    setBusy(true)
    try {
      const priorityText = state.priorityText.trim()
      await record('priority_submitted', {
        category: state.priorityCategory,
        minimumMinutes: state.priorityMinimumMinutes,
      })
      const localDate = state.scheduleMethod === 'demo'
        ? '2026-07-13'
        : new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      const scheduleBlocks = state.scheduleEvents.map((block) => ({
        start: block.start,
        end: block.end,
        title: block.title,
        category: block.category as PipelineInput['scheduleBlocks'][number]['category'],
        flexible: block.movable,
        source: block.source,
      }))
      const execution = await backend.analyze({
        timezone: state.scheduleMethod === 'demo' ? 'Asia/Kolkata' : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
        localDate,
        sleepInterval: { start: state.sleepStart, end: state.wakeTime },
        scheduleBlocks,
        intentionalRestBlocks: scheduleBlocks.filter((block) => block.category === 'intentional_rest'),
        priority: priorityText,
        minimumUsefulMinutes: state.priorityMinimumMinutes,
        plannedDays: 22,
      })
      const saved = { result: execution.result, repairedBlocks: execution.repairedBlocks }
      saveResult(saved)
      setAnalysis(saved)
      update({ priorityText, step: 5 })
    } catch {
      setError('We could not analyze your day. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function goBack() {
    if (state.step > 1) update({ step: (state.step - 1) as OnboardingState['step'] })
    else update({ started: false })
  }

  function restart() {
    const fresh = initialOnboardingState()
    setState(fresh)
    setAnalysis(null)
    localStorage.removeItem('timeleak.result.v1')
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
              <FlowActions onBack={goBack} busy={busy} submitLabel="Find my TimeLeak" />
            </form>
          )}

          {state.step === 5 && analysis && (
            <ResultView analysis={analysis} backend={backend} userId={state.userId} email={state.email} />
          )}
        </section>
      )}
    </main>
  )
}

export function ResultView({ analysis, backend, userId, email }: {
  analysis: Pick<PipelineExecution, 'result' | 'repairedBlocks'>
  backend: OnboardingBackend
  userId: string
  email: string
}) {
  const { result, repairedBlocks } = analysis
  const [copyStatus, setCopyStatus] = useState('')
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null)
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [paymentState, setPaymentState] = useState<PaymentState | null>(null)
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundMessage, setRefundMessage] = useState('')

  useEffect(() => {
    let active = true
    backend.getPaymentState(userId).then((next) => {
      if (active) setPaymentState(next)
    }).catch(() => undefined)
    return () => { active = false }
  }, [backend, userId])

  async function requestRefund() {
    if (!paymentState?.payment) return
    setRefundBusy(true)
    try {
      await backend.requestRefund({ userId, paymentId: paymentState.payment.id })
      setPaymentState({
        ...paymentState,
        refundRequest: { status: 'requested', requestedAt: Date.now() },
      })
      setRefundMessage('Refund requested. It may be processed manually; access remains active until Dodo confirms the refund.')
    } catch {
      setRefundMessage('We could not submit the refund request. Please try again.')
    } finally {
      setRefundBusy(false)
    }
  }

  async function beginCheckout() {
    setCheckoutBusy(true)
    setCheckoutError('')
    try {
      const created = await backend.startCheckout({ userId, email })
      if (created.mode === 'demo') setCheckout(created)
      else window.location.assign(created.checkoutUrl)
    } catch {
      setCheckoutError('Checkout is temporarily unavailable. Your result is still saved.')
    } finally {
      setCheckoutBusy(false)
    }
  }
  const summary = result.daySummary
  const allocation = [
    ['Sleep', summary.sleepMinutes, 'sleep'],
    ['Fixed', summary.fixedMinutes, 'fixed'],
    ['Maintenance', summary.maintenanceMinutes, 'maintenance'],
    ['Intentional rest', summary.intentionalRestMinutes, 'rest'],
    ['Unowned', summary.unownedMinutes, 'unowned'],
  ] as const
  const calendar = result.calendarEvent

  function downloadCalendar() {
    const file = createCalendarFile(result)
    downloadTextFile(file.filename, file.mimeType, file.content)
  }

  async function copyShare() {
    const share = createPublicSharePayload(result)
    const text = `My ${share.leakLabel} became ${share.afterMinutes} protected minutes tomorrow — ${share.monthlyHours} hours across the next month. Find your TimeLeak.`
    await navigator.clipboard.writeText(text)
    setCopyStatus('Copied — private schedule details were excluded.')
  }

  return (
    <article className="result-page">
      <header className="result-hero">
        <p className="result-overline">Your tomorrow repair is ready</p>
        <h1>We found your TimeLeak.</h1>
        <p>{result.leak.explanation}</p>
      </header>

      <section className="result-section allocation-section" aria-labelledby="allocation-title">
        <div className="section-heading"><span>01</span><h2 id="allocation-title">24-hour allocation</h2></div>
        <div className="allocation-bar" aria-label="24-hour allocation bar">
          {allocation.map(([label, value, className]) => value > 0 && (
            <span key={label} className={className} style={{ width: `${(value / 1440) * 100}%` }} title={`${label}: ${value} minutes`} />
          ))}
        </div>
        <div className="allocation-legend">
          {allocation.map(([label, value, className]) => <span key={label}><i className={className} />{label} <strong>{Math.round(value / 60 * 10) / 10}h</strong></span>)}
        </div>
      </section>

      <section className="result-section insight-grid">
        <div className="insight-card leak-card">
          <p className="card-label">Biggest leak</p>
          <h2>{result.leak.label}</h2>
          <p>{result.leak.explanation}</p>
          <span className="confidence">{Math.round(result.leak.confidence * 100)}% confidence</span>
        </div>
        <div className="insight-card repair-card">
          <p className="card-label">One repair</p>
          <h2>{result.repair.headline}</h2>
          <p>{result.repair.instruction}</p>
          <span className="preserved">Sleep and intentional rest preserved</span>
        </div>
      </section>

      <section className="result-section metric-strip">
        <div>
          <p>Protected Priority Time</p>
          <div className="before-after"><strong>{result.metrics.beforeProtectedMinutes}</strong><span>→</span><strong>{result.metrics.afterProtectedMinutes}</strong><small>minutes tomorrow</small></div>
        </div>
        <div>
          <p>Monthly Reclaim Potential</p>
          <strong className="monthly-number">{result.shareResult.monthlyHours}</strong><span className="monthly-unit"> protected hours</span>
          <small>{result.metrics.plannedDays} planned days × {result.metrics.afterProtectedMinutes - result.metrics.beforeProtectedMinutes} minutes</small>
        </div>
      </section>

      <section className="result-section comparison-section">
        <div className="section-heading"><span>02</span><h2>Current versus repaired tomorrow</h2></div>
        <div className="comparison-grid">
          <div className="day-card current-day"><p>Current</p><strong>8:10–9:30 PM</strong><span>Drift and scattered chores</span></div>
          <div className="repair-arrow" aria-hidden="true">→</div>
          <div className="day-card repaired-day"><p>Repaired</p><strong>{calendar ? `${calendar.start.slice(11, 16)}–${calendar.end.slice(11, 16)}` : 'Protected block'}</strong><span>{result.repair.headline}</span></div>
        </div>
        <p className="smallest-change">{result.repair.whySmallestChange}</p>
      </section>

      <section className="result-section action-list">
        <div className="action-row">
          <div><p className="card-label">Download calendar block</p><h2>{calendar?.title}</h2><span>Ready to add to your calendar.</span></div>
          <button type="button" className="result-button" onClick={downloadCalendar}>Download .ics file</button>
        </div>
        <div className="action-row disabled-action">
          <div><p className="card-label">Tomorrow Briefing</p><h2>Hear your repair in 30 seconds</h2><span>Available when dynamic audio is connected.</span></div>
          <button type="button" className="result-button secondary" disabled>Play briefing</button>
        </div>
        <div className="action-row share-row">
          <div><p className="card-label">Privacy-safe share card</p><h2>{result.shareResult.afterMinutes} minutes tomorrow · {result.shareResult.monthlyHours} hours next month</h2><span>Only reclaimed metrics and the public leak label are shared.</span>{copyStatus && <em role="status">{copyStatus}</em>}</div>
          <button type="button" className="result-button secondary" onClick={copyShare}>Copy share text</button>
        </div>
      </section>

      {paymentState?.accessStatus === 'paid' && paymentState.payment && (
        <section className="paid-account" aria-labelledby="paid-account-title">
          <p className="offer-kicker">Paid account</p>
          <h2 id="paid-account-title">30-day access active</h2>
          <p>Access ends: <strong>{new Date(paymentState.accessUntil || 0).toISOString().replace('.000Z', ' UTC')}</strong></p>
          <p>Refund deadline: <strong>{new Date(paymentState.payment.refundDeadline || 0).toISOString().replace('.000Z', ' UTC')}</strong></p>
          {paymentState.refundRequest
            ? <p role="status">Refund request status: {paymentState.refundRequest.status}. Access changes only after Dodo confirms the refund.</p>
            : <button type="button" onClick={requestRefund} disabled={refundBusy}>{refundBusy ? 'Submitting request…' : 'Request Refund'}</button>}
          {refundMessage && <p role="status">{refundMessage}</p>}
        </section>
      )}

      {paymentState?.accessStatus !== 'paid' && <section className="offer-card">
        <div>
          <p className="offer-kicker">30-Day Time Reclaim Pass</p>
          <h2>One repaired day shows the opportunity. Protect the next 30 days.</h2>
          <p>Daily change-only check-ins, one calendar-ready repair, and weekly reclaimed-hours evidence.</p>
          <small>Immediate access. Cancel within seven days for a full refund.</small>
        </div>
        <div className="offer-action">
          <strong>$9.99</strong><span>one-time payment</span>
          <button type="button" onClick={beginCheckout} disabled={checkoutBusy}>
            {checkoutBusy ? 'Opening secure checkout…' : 'Start 30-Day Time Reclaim — $9.99'}
          </button>
          {checkoutError && <em role="alert">{checkoutError}</em>}
        </div>
      </section>}

      {checkout?.mode === 'demo' && (
        <section className="demo-checkout" aria-labelledby="demo-checkout-title">
          <p className="offer-kicker">Dodo Payments integration preview</p>
          <h2 id="demo-checkout-title">Dodo demo checkout</h2>
          <strong>$9.99 one-time payment</strong>
          <p>{checkout.customerEmail}</p>
          <p>No payment will be collected and access will not be granted.</p>
          <p>This screen will redirect to Dodo test or live checkout as soon as your product ID and API key are configured.</p>
          <button type="button" onClick={() => setCheckout(null)}>Return without payment</button>
        </section>
      )}

      {repairedBlocks.length > 0 && <p className="result-footnote">Repair checked against {repairedBlocks.length} non-overlapping blocks.</p>}
    </article>
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
