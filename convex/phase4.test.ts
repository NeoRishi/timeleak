// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

async function runningAnalysis(t: ReturnType<typeof convexTest>) {
  const { userId } = await t.mutation(api.users.createOrFindUser, {
    email: 'pipeline@example.com',
    sessionIdHash: 'pipeline-session-hash',
    timezone: 'Asia/Kolkata',
  })
  const dayProfileId = await t.mutation(api.dayProfiles.saveDayProfile, {
    userId,
    localDate: '2026-07-13',
    timezone: 'Asia/Kolkata',
    sleepStart: '23:00',
    wakeTime: '07:00',
    blocks: [],
    priorityText: 'Complete an AI course module',
    priorityMinimumMinutes: 60,
  })
  const analysisId = await t.mutation(api.analyses.startAnalysis, { userId, dayProfileId })
  return { analysisId }
}

describe('Phase 4 Convex pipeline receipts', () => {
  it('logs sequential stage receipts with latency and errors', async () => {
    const t = convexTest(schema, modules)
    const { analysisId } = await runningAnalysis(t)

    await t.mutation(api.analyses.logAgentRun, {
      analysisId,
      stage: 'normalize_day',
      status: 'passed',
      latencyMs: 12,
    })
    await t.mutation(api.analyses.logAgentRun, {
      analysisId,
      stage: 'judge',
      status: 'failed',
      latencyMs: 8,
      errorCode: 'INVALID_AGENT_RESPONSE',
    })

    const receipts = await t.run((ctx) => ctx.db.query('agentRuns').withIndex('by_analysis', (q) => q.eq('analysisId', analysisId)).collect())
    expect(receipts.map(({ stage, status, latencyMs, errorCode }) => ({ stage, status, latencyMs, errorCode }))).toEqual([
      { stage: 'normalize_day', status: 'passed', latencyMs: 12, errorCode: undefined },
      { stage: 'judge', status: 'failed', latencyMs: 8, errorCode: 'INVALID_AGENT_RESPONSE' },
    ])
  })

  it('stores a safe limited result after the retry is exhausted', async () => {
    const t = convexTest(schema, modules)
    const { analysisId } = await runningAnalysis(t)

    await t.mutation(api.analyses.limitAnalysis, {
      analysisId,
      resultJson: JSON.stringify({ status: 'limited_result' }),
      errorCode: 'INVALID_AGENT_RESPONSE',
    })

    const analysis = await t.run((ctx) => ctx.db.get(analysisId))
    expect(analysis).toMatchObject({ status: 'limited', resultJson: JSON.stringify({ status: 'limited_result' }) })
    const runs = await t.run((ctx) => ctx.db.query('agentRuns').withIndex('by_analysis', (q) => q.eq('analysisId', analysisId)).collect())
    expect(runs).toContainEqual(expect.objectContaining({ stage: 'pipeline', status: 'failed', errorCode: 'INVALID_AGENT_RESPONSE' }))
  })
})
