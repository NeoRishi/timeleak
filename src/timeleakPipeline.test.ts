import { describe, expect, it } from 'vitest'
import {
  MONDAY_PIPELINE_INPUT,
  runTimeLeakPipeline,
  validateAnalysisResult,
  type PipelineModel,
  type TimeLeakAnalysis,
} from './timeleakPipeline'

function minutes(value: string) {
  const [, time] = value.split('T')
  const [hour, minute] = time.slice(0, 5).split(':').map(Number)
  return hour * 60 + minute
}

function expectNoOverlap(blocks: Array<{ start: string; end: string }>) {
  const ordered = [...blocks].sort((a, b) => a.start.localeCompare(b.start))
  for (let index = 1; index < ordered.length; index += 1) {
    expect(minutes(ordered[index].start)).toBeGreaterThanOrEqual(minutes(ordered[index - 1].end))
  }
}

describe('Phase 4 TimeLeak pipeline', () => {
  it('passes every Monday demo exit gate through the sequential fallback', async () => {
    const execution = await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT)

    expect(execution.result.status).toBe('pass')
    expect(execution.result.daySummary.totalMinutes).toBe(1440)
    expect(execution.result.leak.type).toBe('fragmented_evening')
    expect(execution.result.repair.headline).toBeTruthy()
    expect(execution.result.metrics.beforeProtectedMinutes).toBe(0)
    expect(execution.result.metrics.afterProtectedMinutes).toBe(60)
    expect(execution.result.metrics.monthlyReclaimMinutes).toBe(60 * 22)
    expect(execution.result.calendarEvent).toMatchObject({
      start: '2026-07-13T20:30:00',
      end: '2026-07-13T21:30:00',
    })
    expect(execution.repairedBlocks).toHaveLength(11)
    expectNoOverlap(execution.repairedBlocks)

    const sleep = execution.repairedBlocks.filter((block) => block.category === 'protected')
    expect(sleep).toEqual(expect.arrayContaining([
      expect.objectContaining({ start: '2026-07-13T00:00:00', end: '2026-07-13T07:00:00' }),
      expect.objectContaining({ start: '2026-07-13T23:00:00', end: '2026-07-14T00:00:00' }),
    ]))
    expect(execution.repairedBlocks).toContainEqual(expect.objectContaining({
      title: 'Intentional leisure',
      start: '2026-07-13T21:30:00',
      end: '2026-07-13T22:30:00',
      category: 'intentional_rest',
    }))
    expect(execution.stages.map((stage) => stage.stage)).toEqual([
      'normalize_day',
      'detect_leak',
      'produce_repair',
      'judge',
    ])
    expect(execution.followUps).toHaveLength(0)
    expect(validateAnalysisResult(execution.result)).toEqual({ valid: true, errors: [] })
  })

  it('sends structured required fields to the model adapter', async () => {
    let received: unknown
    const model: PipelineModel = {
      async generate(input) {
        received = input
        return (await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT)).result
      },
    }

    await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT, { model })

    expect(received).toMatchObject({
      timezone: 'Asia/Kolkata',
      localDate: '2026-07-13',
      sleepInterval: { start: '23:00', end: '07:00' },
      scheduleBlocks: expect.any(Array),
      intentionalRestBlocks: expect.any(Array),
      priority: expect.any(String),
      minimumUsefulMinutes: 60,
      plannedDays: 22,
    })
    expect(JSON.stringify(received)).not.toContain('prompt')
  })

  it('retries one malformed model response and accepts the valid second response', async () => {
    const fallback = await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT)
    let attempts = 0
    const model: PipelineModel = {
      async generate() {
        attempts += 1
        if (attempts === 1) return { status: 'pass' }
        return fallback.result
      },
    }

    const execution = await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT, { model })

    expect(attempts).toBe(2)
    expect(execution.result.status).toBe('pass')
    expect(execution.attempts).toBe(2)
  })

  it('fails safely after a malformed response and one retry', async () => {
    let attempts = 0
    const model: PipelineModel = {
      async generate() {
        attempts += 1
        return { status: 'pass', leak: [] }
      },
    }

    const execution = await runTimeLeakPipeline(MONDAY_PIPELINE_INPUT, { model })

    expect(attempts).toBe(2)
    expect(execution.attempts).toBe(2)
    expect(execution.result.status).toBe('limited_result')
    expect(execution.errorCode).toBe('INVALID_AGENT_RESPONSE')
    expect(execution.result.calendarEvent).toBeNull()
    expect(validateAnalysisResult(execution.result as TimeLeakAnalysis).valid).toBe(true)
  })

  it('returns a limited result rather than applying the demo repair to another schedule', async () => {
    const execution = await runTimeLeakPipeline({
      ...MONDAY_PIPELINE_INPUT,
      scheduleBlocks: MONDAY_PIPELINE_INPUT.scheduleBlocks.map((block) =>
        block.title === 'Scrolling and undecided transition'
          ? { ...block, title: 'Flexible reading' }
          : block,
      ),
    })

    expect(execution.result.status).toBe('limited_result')
    expect(execution.errorCode).toBe('RUNTIME_MODEL_REQUIRED')
    expect(execution.result.calendarEvent).toBeNull()
  })

  it('asks no more than two follow-ups for gaps or contradictions', async () => {
    const execution = await runTimeLeakPipeline({
      ...MONDAY_PIPELINE_INPUT,
      scheduleBlocks: [
        { start: '09:00', end: '18:00', title: 'Work', category: 'fixed', flexible: false, source: 'user' },
        { start: '17:00', end: '19:00', title: 'Appointment', category: 'fixed', flexible: false, source: 'user' },
      ],
      intentionalRestBlocks: [],
    })

    expect(execution.followUps.length).toBeGreaterThan(0)
    expect(execution.followUps.length).toBeLessThanOrEqual(2)
    expect(execution.result.status).toBe('limited_result')
  })
})
