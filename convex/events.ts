import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'

const eventName = v.union(
  v.literal('landing_view'),
  v.literal('hero_cta_clicked'),
  v.literal('onboarding_started'),
  v.literal('email_submitted'),
  v.literal('user_created'),
  v.literal('sleep_entered'),
  v.literal('schedule_method_selected'),
  v.literal('schedule_parsed'),
  v.literal('priority_submitted'),
  v.literal('analysis_started'),
  v.literal('analysis_completed'),
  v.literal('analysis_limited'),
  v.literal('analysis_failed'),
  v.literal('calendar_downloaded'),
  v.literal('audio_played'),
  v.literal('share_card_downloaded'),
  v.literal('share_link_opened'),
  v.literal('checkout_started'),
  v.literal('payment_succeeded'),
  v.literal('payment_failed'),
  v.literal('refund_requested'),
  v.literal('refund_succeeded'),
)

export const trackEvent = mutation({
  args: {
    userId: v.optional(v.id('users')),
    sessionId: v.string(),
    name: eventName,
    properties: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (args.userId && !(await ctx.db.get(args.userId))) {
      throw new ConvexError('USER_NOT_FOUND')
    }
    if (!args.sessionId.trim()) throw new ConvexError('SESSION_REQUIRED')

    return ctx.db.insert('productEvents', {
      userId: args.userId,
      sessionId: args.sessionId.trim(),
      name: args.name,
      propertiesJson:
        args.properties === undefined ? undefined : JSON.stringify(args.properties),
      createdAt: Date.now(),
    })
  },
})
