import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const createOrFindUser = mutation({
  args: {
    email: v.string(),
    sessionIdHash: v.string(),
    timezone: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase()
    const timezone = args.timezone.trim()

    if (!EMAIL_PATTERN.test(email)) throw new ConvexError('INVALID_EMAIL')
    if (!timezone) throw new ConvexError('INVALID_TIMEZONE')
    if (args.sessionIdHash.trim().length < 16) {
      throw new ConvexError('INVALID_SESSION_HASH')
    }

    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionIdHash: args.sessionIdHash.trim(),
        timezone,
      })
      return { userId: existing._id, created: false }
    }

    const userId = await ctx.db.insert('users', {
      email,
      timezone,
      sessionIdHash: args.sessionIdHash.trim(),
      accessStatus: 'free',
      createdAt: Date.now(),
      source: args.source?.trim() || undefined,
      referralCode: 'pending',
    })
    await ctx.db.patch(userId, { referralCode: `u-${userId}` })

    return { userId, created: true }
  },
})
