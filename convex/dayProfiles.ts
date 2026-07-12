import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'

const blockValidator = v.object({
  start: v.string(),
  end: v.string(),
  title: v.string(),
  category: v.string(),
  movable: v.boolean(),
  source: v.string(),
})

export const saveDayProfile = mutation({
  args: {
    userId: v.id('users'),
    localDate: v.string(),
    timezone: v.string(),
    sleepStart: v.string(),
    wakeTime: v.string(),
    blocks: v.array(blockValidator),
    priorityText: v.string(),
    priorityMinimumMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.userId))) throw new ConvexError('USER_NOT_FOUND')
    if (![45, 60, 90].includes(args.priorityMinimumMinutes)) {
      throw new ConvexError('INVALID_PRIORITY_MINUTES')
    }
    if (!args.priorityText.trim()) throw new ConvexError('PRIORITY_REQUIRED')

    return ctx.db.insert('dayProfiles', {
      ...args,
      priorityText: args.priorityText.trim(),
      createdAt: Date.now(),
    })
  },
})
