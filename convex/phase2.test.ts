// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const dayInput = {
  localDate: '2026-07-13',
  timezone: 'Asia/Kolkata',
  sleepStart: '23:00',
  wakeTime: '07:00',
  blocks: [
    {
      start: '09:00',
      end: '18:00',
      title: 'Work',
      category: 'fixed',
      movable: false,
      source: 'user',
    },
  ],
  priorityText: 'Complete one AI course module',
  priorityMinimumMinutes: 60,
}

async function createUser(t: ReturnType<typeof convexTest>) {
  return t.mutation(api.users.createOrFindUser, {
    email: ' Tester@Example.com ',
    sessionIdHash: 'session-hash-1234567890',
    timezone: 'Asia/Kolkata',
  })
}

describe('Phase 2 Convex proof system', () => {
  it('normalizes email and returns the existing user instead of duplicating it', async () => {
    const t = convexTest(schema, modules)

    const first = await createUser(t)
    const second = await t.mutation(api.users.createOrFindUser, {
      email: 'tester@example.com',
      sessionIdHash: 'another-session-hash-12345',
      timezone: 'Asia/Kolkata',
    })

    expect(second.userId).toEqual(first.userId)
    expect(second.created).toBe(false)

    const users = await t.run(async (ctx) => ctx.db.query('users').collect())
    expect(users).toHaveLength(1)
    expect(users[0].email).toBe('tester@example.com')
  })

  it('stores a first-use chain and reports activation without exposing schedules', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await createUser(t)

    const dayProfileId = await t.mutation(api.dayProfiles.saveDayProfile, {
      userId,
      ...dayInput,
    })
    const analysisId = await t.mutation(api.analyses.startAnalysis, {
      userId,
      dayProfileId,
    })

    await t.mutation(api.events.trackEvent, {
      userId,
      sessionId: 'browser-session-1',
      name: 'analysis_started',
      properties: { method: 'demo' },
    })
    await t.mutation(api.analyses.completeAnalysis, {
      analysisId,
      leakType: 'fragmented_evening',
      beforeMinutes: 0,
      afterMinutes: 60,
      resultJson: JSON.stringify({ privateSchedule: dayInput.blocks }),
      publicShareId: 'public-share-1',
      publicShareJson: JSON.stringify({
        beforeMinutes: 0,
        afterMinutes: 60,
        monthlyHours: 22,
        leakLabel: 'Fragmented Evening Drift',
      }),
    })
    await t.mutation(api.events.trackEvent, {
      userId,
      sessionId: 'browser-session-1',
      name: 'analysis_completed',
      properties: { analysisId },
    })

    const proof = await t.query(api.proof.getProofSummary)
    expect(proof.users).toBe(1)
    expect(proof.completedAnalyses).toBe(1)
    expect(proof.activationRate).toBe(1)

    const publicResult = await t.query(api.shares.getPublicShare, {
      publicShareId: 'public-share-1',
    })
    expect(publicResult).toEqual({
      beforeMinutes: 0,
      afterMinutes: 60,
      monthlyHours: 22,
      leakLabel: 'Fragmented Evening Drift',
    })
    expect(JSON.stringify(publicResult)).not.toContain('privateSchedule')
    expect(JSON.stringify(publicResult)).not.toContain('Complete one AI course module')
  })

  it('rejects a day profile for a user that does not exist', async () => {
    const t = convexTest(schema, modules)
    const missingUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        email: 'deleted@example.com',
        timezone: 'Asia/Kolkata',
        sessionIdHash: 'deleted-session-hash-12345',
        accessStatus: 'free',
        createdAt: Date.now(),
        referralCode: 'deleted-user',
      })
      await ctx.db.delete(userId)
      return userId
    })

    await expect(
      t.mutation(api.dayProfiles.saveDayProfile, {
        userId: missingUserId,
        ...dayInput,
      }),
    ).rejects.toThrow('USER_NOT_FOUND')
  })
})
