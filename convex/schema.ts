import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({
    email: v.string(),
    displayName: v.optional(v.string()),
    timezone: v.string(),
    sessionIdHash: v.string(),
    accessStatus: v.union(
      v.literal('free'),
      v.literal('paid'),
      v.literal('expired'),
      v.literal('refunded'),
    ),
    accessUntil: v.optional(v.number()),
    createdAt: v.number(),
    source: v.optional(v.string()),
    referralCode: v.string(),
  })
    .index('by_email', ['email'])
    .index('by_referral_code', ['referralCode']),

  dayProfiles: defineTable({
    userId: v.id('users'),
    localDate: v.string(),
    timezone: v.string(),
    sleepStart: v.string(),
    wakeTime: v.string(),
    blocks: v.array(
      v.object({
        start: v.string(),
        end: v.string(),
        title: v.string(),
        category: v.string(),
        movable: v.boolean(),
        source: v.string(),
      }),
    ),
    priorityText: v.string(),
    priorityMinimumMinutes: v.number(),
    createdAt: v.number(),
  }).index('by_user_date', ['userId', 'localDate']),

  analyses: defineTable({
    userId: v.id('users'),
    dayProfileId: v.id('dayProfiles'),
    status: v.union(
      v.literal('running'),
      v.literal('completed'),
      v.literal('limited'),
      v.literal('failed'),
    ),
    leakType: v.optional(v.string()),
    beforeMinutes: v.optional(v.number()),
    afterMinutes: v.optional(v.number()),
    resultJson: v.optional(v.string()),
    publicShareId: v.optional(v.string()),
    publicShareJson: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_share_id', ['publicShareId']),

  agentRuns: defineTable({
    analysisId: v.id('analyses'),
    stage: v.string(),
    status: v.union(
      v.literal('started'),
      v.literal('passed'),
      v.literal('failed'),
      v.literal('revised'),
    ),
    latencyMs: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_analysis', ['analysisId']),

  payments: defineTable({
    userId: v.id('users'),
    provider: v.literal('dodo'),
    providerPaymentId: v.string(),
    amountUsdCents: v.number(),
    status: v.union(
      v.literal('pending'),
      v.literal('paid'),
      v.literal('refunded'),
      v.literal('failed'),
    ),
    paidAt: v.optional(v.number()),
    refundDeadline: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_provider_payment', ['providerPaymentId'])
    .index('by_user', ['userId']),

  refundRequests: defineTable({
    userId: v.id('users'),
    paymentId: v.id('payments'),
    reason: v.optional(v.string()),
    status: v.union(
      v.literal('requested'),
      v.literal('approved'),
      v.literal('completed'),
      v.literal('rejected'),
    ),
    requestedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index('by_payment', ['paymentId']),

  productEvents: defineTable({
    userId: v.optional(v.id('users')),
    name: v.string(),
    propertiesJson: v.optional(v.string()),
    sessionId: v.string(),
    createdAt: v.number(),
  })
    .index('by_name_time', ['name', 'createdAt'])
    .index('by_user', ['userId']),
})
