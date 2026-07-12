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
