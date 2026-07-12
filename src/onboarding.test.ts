// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hashSessionId, parseSchedule, sleepDurationMinutes } from './onboarding'

describe('Phase 3 onboarding rules', () => {
  it('hashes the browser session before backend storage', async () => {
    const hash = await hashSessionId('browser-session-token')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain('browser-session-token')
  })

  it('calculates sleep across midnight', () => {
    expect(sleepDurationMinutes('23:00', '07:00')).toBe(480)
  })

  it('parses visible schedule lines and identifies overlaps', () => {
    const result = parseSchedule(
      '9:00 AM - 10:00 AM: Work\n9:30 AM - 11:00 AM: Meeting',
    )
    expect(result.events).toHaveLength(2)
    expect(result.events[0].title).toBe('Work')
    expect(result.overlaps).toHaveLength(1)
  })

  it('does not pretend a screenshot was extracted', () => {
    const result = parseSchedule('')
    expect(result.events).toEqual([])
    expect(result.errors).toEqual([])
  })
})
