// @vitest-environment edge-runtime
import { describe, expect, it } from 'vitest'
import worker from './index.js'
import { MONDAY_PIPELINE_INPUT } from '../src/timeleakPipeline.js'

describe('TimeLeak analysis Worker route', () => {
  it('accepts structured input and returns a schema-valid Monday repair', async () => {
    const request = new Request('https://timeleak.example/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(MONDAY_PIPELINE_INPUT),
    })

    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0])
    const body = await response.json() as { result: { status: string; daySummary: { totalMinutes: number } }; stages: unknown[] }

    expect(response.status).toBe(200)
    expect(body.result.status).toBe('pass')
    expect(body.result.daySummary.totalMinutes).toBe(1440)
    expect(body.stages).toHaveLength(4)
  })

  it('rejects open-ended or incomplete input instead of inventing fields', async () => {
    const request = new Request('https://timeleak.example/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Fix my day' }),
    })

    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0])
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_PIPELINE_INPUT' })
  })
})
