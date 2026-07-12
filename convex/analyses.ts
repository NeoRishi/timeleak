import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'

export const startAnalysis = mutation({
  args: {
    userId: v.id('users'),
    dayProfileId: v.id('dayProfiles'),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.dayProfileId)
    if (!profile || profile.userId !== args.userId) {
      throw new ConvexError('DAY_PROFILE_NOT_FOUND')
    }

    return ctx.db.insert('analyses', {
      userId: args.userId,
      dayProfileId: args.dayProfileId,
      status: 'running',
      startedAt: Date.now(),
    })
  },
})

export const logAgentRun = mutation({
  args: {
    analysisId: v.id('analyses'),
    stage: v.string(),
    status: v.union(v.literal('started'), v.literal('passed'), v.literal('failed'), v.literal('revised')),
    latencyMs: v.optional(v.number()),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.analysisId))) throw new ConvexError('ANALYSIS_NOT_FOUND')
    return ctx.db.insert('agentRuns', { ...args, createdAt: Date.now() })
  },
})

export const limitAnalysis = mutation({
  args: {
    analysisId: v.id('analyses'),
    resultJson: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const analysis = await ctx.db.get(args.analysisId)
    if (!analysis) throw new ConvexError('ANALYSIS_NOT_FOUND')
    if (analysis.status !== 'running') throw new ConvexError('ANALYSIS_NOT_RUNNING')
    const completedAt = Date.now()
    await ctx.db.patch(args.analysisId, { status: 'limited', resultJson: args.resultJson, completedAt })
    await ctx.db.insert('agentRuns', {
      analysisId: args.analysisId,
      stage: 'pipeline',
      status: 'failed',
      errorCode: args.errorCode,
      createdAt: completedAt,
    })
    return args.analysisId
  },
})

export const completeAnalysis = mutation({
  args: {
    analysisId: v.id('analyses'),
    leakType: v.string(),
    beforeMinutes: v.number(),
    afterMinutes: v.number(),
    resultJson: v.string(),
    publicShareId: v.optional(v.string()),
    publicShareJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const analysis = await ctx.db.get(args.analysisId)
    if (!analysis) throw new ConvexError('ANALYSIS_NOT_FOUND')
    if (analysis.status !== 'running') throw new ConvexError('ANALYSIS_NOT_RUNNING')
    if (args.beforeMinutes < 0 || args.afterMinutes < 0) {
      throw new ConvexError('INVALID_PROTECTED_MINUTES')
    }
    if (Boolean(args.publicShareId) !== Boolean(args.publicShareJson)) {
      throw new ConvexError('INCOMPLETE_PUBLIC_SHARE')
    }

    await ctx.db.patch(args.analysisId, {
      status: 'completed',
      leakType: args.leakType,
      beforeMinutes: args.beforeMinutes,
      afterMinutes: args.afterMinutes,
      resultJson: args.resultJson,
      publicShareId: args.publicShareId,
      publicShareJson: args.publicShareJson,
      completedAt: Date.now(),
    })

    return args.analysisId
  },
})
