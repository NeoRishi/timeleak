// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { type OnboardingBackend } from './App'

function createBackend() {
  return {
    createUser: vi.fn().mockResolvedValue({ userId: 'user-1', created: true }),
    trackEvent: vi.fn().mockResolvedValue(undefined),
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
    await userEvent.click(screen.getByRole('button', { name: 'Finish onboarding' }))

    expect(await screen.findByText('Ready to find your TimeLeak.')).toBeInTheDocument()
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
})
