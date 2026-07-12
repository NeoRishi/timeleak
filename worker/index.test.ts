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

    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], {} as Parameters<typeof worker.fetch>[1])
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

    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], {} as Parameters<typeof worker.fetch>[1])
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_PIPELINE_INPUT' })
  })

  it('rejects malformed checkout input and unsigned Dodo webhooks', async () => {
    const checkout = await worker.fetch(new Request('https://timeleak.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'buyer@example.com' }),
    }) as Parameters<typeof worker.fetch>[0], {} as Parameters<typeof worker.fetch>[1])
    expect(checkout.status).toBe(400)

    const webhook = await worker.fetch(new Request('https://timeleak.example/api/webhooks/dodo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': 'wh_invalid',
        'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'webhook-signature': 'v1,invalid',
      },
      body: JSON.stringify({ type: 'payment.succeeded', data: {} }),
    }) as Parameters<typeof worker.fetch>[0], {
      DODO_PAYMENTS_WEBHOOK_KEY: 'whsec_invalid',
      PAYMENT_INTERNAL_SECRET: 'internal-test',
    } as Parameters<typeof worker.fetch>[1])
    expect(webhook.status).toBe(400)
    expect(await webhook.json()).toEqual({ error: 'INVALID_WEBHOOK_SIGNATURE' })
  })
})
