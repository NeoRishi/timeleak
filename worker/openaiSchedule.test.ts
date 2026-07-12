import { describe, expect, it, vi } from 'vitest'
import { interpretScheduleTranscript } from './openaiSchedule.js'

const transcript = 'I commute from eight to nine, work from nine to six, and eat dinner from seven to eight.'

function responseFor(events: unknown[]) {
  return Response.json({
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ events }) }] }],
  })
}

describe('spoken schedule interpretation', () => {
  it('uses GPT-5.6 Luna structured output and returns only explicit schedule facts', async () => {
    const fetcher = vi.fn().mockResolvedValue(responseFor([
      { start: '08:00', end: '09:00', title: 'Commute', category: 'fixed', movable: false },
      { start: '09:00', end: '18:00', title: 'Work', category: 'fixed', movable: false },
      { start: '19:00', end: '20:00', title: 'Dinner', category: 'maintenance', movable: false },
    ]))
    const result = await interpretScheduleTranscript(transcript, { apiKey: 'test-key', fetcher })
    expect(result.events).toHaveLength(3)
    expect(result.scheduleText).toContain('8:00 AM - 9:00 AM: Commute')
    const [, options] = fetcher.mock.calls[0]
    const request = JSON.parse(String(options.body))
    expect(request.model).toBe('gpt-5.6-luna')
    expect(request.text.format.type).toBe('json_schema')
    expect(request.input[1].content).toBe(transcript)
  })

  it('rejects malformed, overlapping, or invented model output', async () => {
    const overlapping = vi.fn().mockResolvedValue(responseFor([
      { start: '09:00', end: '11:00', title: 'Work', category: 'fixed', movable: false },
      { start: '10:00', end: '12:00', title: 'Meeting', category: 'fixed', movable: false },
    ]))
    await expect(interpretScheduleTranscript(transcript, { apiKey: 'test-key', fetcher: overlapping })).rejects.toThrow('OVERLAPPING_SCHEDULE')

    const empty = vi.fn().mockResolvedValue(responseFor([]))
    await expect(interpretScheduleTranscript('I am busy tomorrow', { apiKey: 'test-key', fetcher: empty })).rejects.toThrow('NO_EXPLICIT_SCHEDULE_BLOCKS')
  })

  it('rejects oversized transcript before sending private text', async () => {
    const fetcher = vi.fn()
    await expect(interpretScheduleTranscript('x'.repeat(5001), { apiKey: 'test-key', fetcher })).rejects.toThrow('TRANSCRIPT_TOO_LARGE')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
