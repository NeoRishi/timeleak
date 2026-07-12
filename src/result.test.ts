// @vitest-environment jsdom
import ICAL from 'ical.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { MONDAY_PIPELINE_INPUT, runTimeLeakPipeline } from './timeleakPipeline'
import {
  createCalendarFile,
  createPublicSharePayload,
  loadSavedResult,
  saveResult,
} from './result'

describe('Phase 5 result exports', () => {
  beforeEach(() => localStorage.clear())

  it('creates a valid timezone-aware ICS event for the private priority', async () => {
    const { result } = await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT)
    const calendar = createCalendarFile(result)

    expect(calendar.filename).toBe('timeleak-2026-07-13.ics')
    expect(calendar.mimeType).toBe('text/calendar;charset=utf-8')
    expect(calendar.content).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0')
    expect(calendar.content).toContain('DTSTART;TZID=Asia/Kolkata:20260713T203000')
    expect(calendar.content).toContain('DTEND;TZID=Asia/Kolkata:20260713T213000')
    expect(calendar.content).toContain('SUMMARY:Complete one module of a personal AI course')
    expect(calendar.content).toContain('END:VCALENDAR\r\n')

    const parsed = new ICAL.Component(ICAL.parse(calendar.content))
    const eventComponent = parsed.getFirstSubcomponent('vevent')
    expect(eventComponent).not.toBeNull()
    const event = new ICAL.Event(eventComponent ?? undefined)
    expect(event.summary).toBe('Complete one module of a personal AI course')
    expect(event.startDate.toString()).toBe('2026-07-13T20:30:00')
    expect(event.endDate.toString()).toBe('2026-07-13T21:30:00')
  })

  it('creates a public payload containing only four allowlisted fields', async () => {
    const { result } = await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT)
    const share = createPublicSharePayload(result)

    expect(share).toEqual({
      beforeMinutes: 0,
      afterMinutes: 60,
      monthlyHours: 22,
      leakLabel: 'Fragmented Evening Drift',
    })
    expect(Object.keys(share)).toEqual(['beforeMinutes', 'afterMinutes', 'monthlyHours', 'leakLabel'])
    const serialized = JSON.stringify(share)
    expect(serialized).not.toContain('AI course')
    expect(serialized).not.toContain('Intentional leisure')
    expect(serialized).not.toContain('20:30')
  })

  it('persists the validated private result for refresh recovery', async () => {
    const { result, repairedBlocks } = await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT)
    saveResult({ result, repairedBlocks })

    expect(loadSavedResult()).toEqual({ result, repairedBlocks })
  })
})
