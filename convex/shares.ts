import { v } from 'convex/values'
import { query } from './_generated/server'

export const getPublicShare = query({
  args: { publicShareId: v.string() },
  handler: async (ctx, args) => {
    const analysis = await ctx.db
      .query('analyses')
      .withIndex('by_share_id', (q) => q.eq('publicShareId', args.publicShareId))
      .unique()

    if (!analysis?.publicShareJson) return null
    const parsed = JSON.parse(analysis.publicShareJson) as Record<string, unknown>

    return {
      beforeMinutes: Number(parsed.beforeMinutes),
      afterMinutes: Number(parsed.afterMinutes),
      monthlyHours: Number(parsed.monthlyHours),
      leakLabel: String(parsed.leakLabel),
    }
  },
})
