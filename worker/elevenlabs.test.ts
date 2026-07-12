import { describe, expect, it, vi } from 'vitest'
import { buildBriefingScript, createBriefingAudio, transcribeScheduleAudio } from './elevenlabs.js'
import { MONDAY_PIPELINE_INPUT, runTimeLeakPipeline } from '../src/timeleakPipeline.js'

async function approvedResult(priority = MONDAY_PIPELINE_INPUT.priority) {
  return (await runTimeLeakPipeline({ ...MONDAY_PIPELINE_INPUT, priority })).result
}

describe('Phase 7 ElevenLabs voice features', () => {
  it('builds a 60–90 word briefing from only the judge-approved result', async () => {
    const script = buildBriefingScript(await approvedResult('Complete one AI course module'))
    const words = script.trim().split(/\s+/)
    expect(words.length).toBeGreaterThanOrEqual(60)
    expect(words.length).toBeLessThanOrEqual(90)
    expect(script).toContain('Fragmented Evening Drift')
    expect(script).toContain('8:30–9:30 PM')
    expect(script).toContain('Complete one AI course module')
    expect(script).toContain('sleep')
    expect(script).toContain('essential responsibilities')
    expect(script).not.toContain('Commute')
    expect(script).not.toContain('Team meeting')
  })

  it('changes the generated audio request when the approved priority changes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    }))
    await createBriefingAudio(await approvedResult('Study Sanskrit'), {
      apiKey: 'test-key', voiceId: 'voice-1', fetcher,
    })
    await createBriefingAudio(await approvedResult('Call my parents'), {
      apiKey: 'test-key', voiceId: 'voice-1', fetcher,
    })
    const firstBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { text: string }
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { text: string }
    expect(firstBody.text).toContain('Study Sanskrit')
    expect(secondBody.text).toContain('Call my parents')
    expect(firstBody.text).not.toBe(secondBody.text)
  })

  it('sends private audio directly to Scribe v2 and returns transcript text', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      text: '9:00 AM - 10:00 AM: Team meeting',
      language_code: 'eng',
    }))
    const audio = new File([new Uint8Array([1, 2, 3])], 'schedule.webm', { type: 'audio/webm' })
    const result = await transcribeScheduleAudio(audio, { apiKey: 'test-key', fetcher })
    expect(result).toEqual({ text: '9:00 AM - 10:00 AM: Team meeting', languageCode: 'eng' })
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect(options.headers['xi-api-key']).toBe('test-key')
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('model_id')).toBe('scribe_v2')
  })

  it('rejects empty or oversized recordings before external transmission', async () => {
    const fetcher = vi.fn()
    await expect(transcribeScheduleAudio(new File([], 'empty.webm'), { apiKey: 'test-key', fetcher })).rejects.toThrow('EMPTY_AUDIO')
    const oversized = new File([new Uint8Array(10_000_001)], 'large.webm', { type: 'audio/webm' })
    await expect(transcribeScheduleAudio(oversized, { apiKey: 'test-key', fetcher })).rejects.toThrow('AUDIO_TOO_LARGE')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
