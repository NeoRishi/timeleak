// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MONDAY_PIPELINE_INPUT, runTimeLeakPipeline } from './timeleakPipeline'
import App, { ResultView, type OnboardingBackend, type PaymentState } from './App'

function createBackend() {
  return {
    createUser: vi.fn().mockResolvedValue({ userId: 'user-1', created: true }),
    trackEvent: vi.fn().mockResolvedValue(undefined),
    analyze: vi.fn().mockImplementation(() => runTimeLeakPipeline(MONDAY_PIPELINE_INPUT)),
    startCheckout: vi.fn().mockResolvedValue({
      mode: 'demo',
      amountUsdCents: 999,
      customerEmail: 'tester@example.com',
      checkoutUrl: 'https://timeleak.example/checkout/demo?amount=999',
    }),
    getPaymentState: vi.fn().mockResolvedValue({ accessStatus: 'free', payment: null, refundRequest: null }),
    requestRefund: vi.fn().mockResolvedValue(undefined),
  } satisfies OnboardingBackend
}

async function startOnboarding() {
  await userEvent.click(screen.getByRole('button', { name: 'Find My TimeLeak' }))
}

async function completeEmail() {
  await userEvent.type(screen.getByLabelText('Email address'), 'tester@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Protect your sleep.' })
}

async function completeSleep() {
  await userEvent.clear(screen.getByLabelText('Sleep time'))
  await userEvent.type(screen.getByLabelText('Sleep time'), '23:00')
  await userEvent.clear(screen.getByLabelText('Wake time'))
  await userEvent.type(screen.getByLabelText('Wake time'), '07:00')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Show us tomorrow.' })
}

describe('Phase 3 onboarding', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => cleanup())

  it('rejects an empty email', async () => {
    render(<App backend={createBackend()} />)
    await startOnboarding()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.')
  })

  it('explains an invalid sleep range and accepts sleep across midnight', async () => {
    render(<App backend={createBackend()} />)
    await startOnboarding()
    await completeEmail()

    await userEvent.clear(screen.getByLabelText('Sleep time'))
    await userEvent.type(screen.getByLabelText('Sleep time'), '07:00')
    await userEvent.clear(screen.getByLabelText('Wake time'))
    await userEvent.type(screen.getByLabelText('Wake time'), '07:00')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sleep and wake time cannot be the same.',
    )

    await completeSleep()
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
  })

  it('shows parsed schedule lines and blocks overlapping events', async () => {
    render(<App backend={createBackend()} />)
    await startOnboarding()
    await completeEmail()
    await completeSleep()

    await userEvent.click(screen.getByRole('button', { name: 'Paste tomorrow’s events' }))
    await userEvent.type(
      screen.getByLabelText('Schedule lines'),
      '9:00 AM - 10:00 AM: Work\n9:30 AM - 11:00 AM: Meeting',
    )

    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText('Meeting')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('overlaps')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('restores the current step after refresh and retains answers when going back', async () => {
    const backend = createBackend()
    const first = render(<App backend={backend} />)
    await startOnboarding()
    await completeEmail()
    await completeSleep()
    first.unmount()

    render(<App backend={backend} />)
    expect(await screen.findByRole('heading', { name: 'Show us tomorrow.' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Sleep time')).toHaveValue('23:00')
    expect(screen.getByLabelText('Wake time')).toHaveValue('07:00')
  })

  it('completes the Monday demo path under 45 seconds and records required events', async () => {
    const backend = createBackend()
    const startedAt = performance.now()
    render(<App backend={backend} />)

    await startOnboarding()
    await completeEmail()
    await completeSleep()
    await userEvent.click(screen.getByRole('button', { name: 'Use the Monday demo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Name one neglected priority.' })
    await userEvent.click(screen.getByRole('button', { name: 'Learning' }))
    await userEvent.type(
      screen.getByLabelText('What would make tomorrow meaningful?'),
      'Complete one AI course module',
    )
    await userEvent.click(screen.getByRole('button', { name: '60 minutes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Find my TimeLeak' }))

    expect(await screen.findByText('We found your TimeLeak.')).toBeInTheDocument()
    expect(performance.now() - startedAt).toBeLessThan(45_000)

    await waitFor(() => {
      const names = backend.trackEvent.mock.calls.map(([name]) => name)
      expect(names).toEqual(
        expect.arrayContaining([
          'onboarding_started',
          'email_submitted',
          'user_created',
          'sleep_entered',
          'schedule_method_selected',
          'schedule_parsed',
          'priority_submitted',
        ]),
      )
    })
  })

  it('renders the result in payment-earning order and restores it after refresh', async () => {
    const createObjectUrl = vi.fn().mockReturnValue('blob:calendar')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const backend = createBackend()
    const first = render(<App backend={backend} />)
    await startOnboarding()
    await completeEmail()
    await completeSleep()
    await userEvent.click(screen.getByRole('button', { name: 'Use the Monday demo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Learning' }))
    await userEvent.type(screen.getByLabelText('What would make tomorrow meaningful?'), 'Complete one AI course module')
    await userEvent.click(screen.getByRole('button', { name: '60 minutes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Find my TimeLeak' }))

    expect(await screen.findByRole('heading', { name: 'We found your TimeLeak.' })).toBeInTheDocument()
    const orderedLabels = [
      '24-hour allocation',
      'Biggest leak',
      'One repair',
      'Protected Priority Time',
      'Monthly Reclaim Potential',
      'Current versus repaired tomorrow',
      'Download calendar block',
      'Tomorrow Briefing',
      'Privacy-safe share card',
      '30-Day Time Reclaim Pass',
    ]
    const positions = orderedLabels.map((label) => document.body.textContent?.indexOf(label) ?? -1)
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(screen.getByRole('button', { name: 'Download .ics file' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy share text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start 30-Day Time Reclaim — $9.99' })).toBeInTheDocument()
    expect(screen.getByText('Ready to add to your calendar.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Download .ics file' }))
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    await userEvent.click(screen.getByRole('button', { name: 'Copy share text' }))
    expect(writeText).toHaveBeenCalledOnce()
    const sharedText = String(writeText.mock.calls[0][0])
    expect(sharedText).not.toContain('AI course')
    expect(sharedText).not.toContain('8:30')
    expect(await screen.findByRole('status')).toHaveTextContent('private schedule details were excluded')

    await userEvent.click(screen.getByRole('button', { name: 'Start 30-Day Time Reclaim — $9.99' }))
    expect(await screen.findByRole('heading', { name: 'Dodo demo checkout' })).toBeInTheDocument()
    expect(screen.getByText('$9.99 one-time payment')).toBeInTheDocument()
    expect(screen.getByText('tester@example.com')).toBeInTheDocument()
    expect(screen.getByText('No payment will be collected and access will not be granted.')).toBeInTheDocument()
    expect(backend.startCheckout).toHaveBeenCalledWith({ userId: 'user-1', email: 'tester@example.com' })
    await userEvent.click(screen.getByRole('button', { name: 'Return without payment' }))
    expect(screen.queryByRole('heading', { name: 'Dodo demo checkout' })).not.toBeInTheDocument()
    expect(screen.queryByText('30-day access active')).not.toBeInTheDocument()

    first.unmount()
    render(<App backend={backend} />)
    expect(await screen.findByRole('heading', { name: 'We found your TimeLeak.' })).toBeInTheDocument()
  })

  it('shows the exact refund deadline and keeps access until refund confirmation', async () => {
    const execution = await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT)
    const backend = createBackend()
    const paidAt = Date.UTC(2026, 6, 13, 12)
    const paymentState: PaymentState = {
      accessStatus: 'paid',
      accessUntil: paidAt + 30 * 86_400_000,
      payment: {
        id: 'payment-1',
        status: 'paid',
        amountUsdCents: 999,
        mode: 'test',
        paidAt,
        refundDeadline: paidAt + 7 * 86_400_000,
      },
      refundRequest: null,
    }
    backend.getPaymentState.mockResolvedValue(paymentState)

    render(<ResultView analysis={execution} backend={backend} userId="user-1" email="tester@example.com" />)

    expect(await screen.findByRole('heading', { name: '30-day access active' })).toBeInTheDocument()
    expect(screen.getByText(/2026-07-20T12:00:00 UTC/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start 30-Day Time Reclaim — $9.99' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Request Refund' }))
    expect(backend.requestRefund).toHaveBeenCalledWith({ userId: 'user-1', paymentId: 'payment-1' })
    expect(await screen.findByText(/access remains active until Dodo confirms the refund/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '30-day access active' })).toBeInTheDocument()
  })
})
