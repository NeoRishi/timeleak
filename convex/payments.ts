import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'

declare const process: { env: Record<string, string | undefined> }

const DAY_MS = 24 * 60 * 60 * 1000
const modeValidator = v.union(v.literal('demo'), v.literal('test'), v.literal('live'))

function assertServerSecret(serverSecret: string) {
  const expected = process.env.PAYMENT_INTERNAL_SECRET
  if (!expected || serverSecret !== expected) throw new ConvexError('PAYMENT_WEBHOOK_UNAUTHORIZED')
}

export const createPendingPayment = mutation({
  args: {
    userId: v.id('users'),
    providerPaymentId: v.string(),
    checkoutSessionId: v.string(),
    customerEmail: v.string(),
    amountUsdCents: v.number(),
    mode: modeValidator,
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) throw new ConvexError('USER_NOT_FOUND')
    if (user.email !== args.customerEmail.trim().toLowerCase()) throw new ConvexError('PAYMENT_EMAIL_MISMATCH')
    if (args.amountUsdCents !== 999) throw new ConvexError('INVALID_PAYMENT_AMOUNT')
    const existing = await ctx.db.query('payments').withIndex('by_provider_payment', (q) => q.eq('providerPaymentId', args.providerPaymentId)).unique()
    if (existing) return existing._id
    return ctx.db.insert('payments', {
      ...args,
      customerEmail: args.customerEmail.trim().toLowerCase(),
      provider: 'dodo',
      status: 'pending',
      createdAt: Date.now(),
    })
  },
})

async function alreadyProcessed(ctx: MutationCtx, webhookId: string) {
  return ctx.db.query('paymentWebhookEvents').withIndex('by_webhook_id', (q) => q.eq('webhookId', webhookId)).unique()
}

export const processPaymentSucceeded = mutation({
  args: { providerPaymentId: v.string(), webhookId: v.string(), paidAt: v.number(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret)
    if (await alreadyProcessed(ctx, args.webhookId)) return { processed: false as const, duplicate: true as const }
    const payment = await ctx.db.query('payments').withIndex('by_provider_payment', (q) => q.eq('providerPaymentId', args.providerPaymentId)).unique()
    if (!payment) throw new ConvexError('PAYMENT_NOT_FOUND')
    if (payment.status === 'paid' || payment.status === 'refunded') {
      await ctx.db.insert('paymentWebhookEvents', {
        webhookId: args.webhookId,
        eventType: 'payment.succeeded',
        providerPaymentId: args.providerPaymentId,
        processedAt: Date.now(),
      })
      return { processed: false as const, duplicate: true as const }
    }
    const accessUntil = args.paidAt + 30 * DAY_MS
    const refundDeadline = args.paidAt + 7 * DAY_MS
    await ctx.db.patch(payment._id, { status: 'paid', paidAt: args.paidAt, refundDeadline })
    await ctx.db.patch(payment.userId, { accessStatus: 'paid', accessUntil })
    await ctx.db.insert('paymentWebhookEvents', {
      webhookId: args.webhookId,
      eventType: 'payment.succeeded',
      providerPaymentId: args.providerPaymentId,
      processedAt: Date.now(),
    })
    return { processed: true as const, accessUntil, refundDeadline }
  },
})

export const processPaymentFailed = mutation({
  args: { providerPaymentId: v.string(), webhookId: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret)
    if (await alreadyProcessed(ctx, args.webhookId)) return { processed: false as const, duplicate: true as const }
    const payment = await ctx.db.query('payments').withIndex('by_provider_payment', (q) => q.eq('providerPaymentId', args.providerPaymentId)).unique()
    if (!payment) throw new ConvexError('PAYMENT_NOT_FOUND')
    if (payment.status === 'pending') await ctx.db.patch(payment._id, { status: 'failed' })
    await ctx.db.insert('paymentWebhookEvents', {
      webhookId: args.webhookId,
      eventType: 'payment.failed',
      providerPaymentId: args.providerPaymentId,
      processedAt: Date.now(),
    })
    return { processed: true as const }
  },
})

export const requestRefund = mutation({
  args: { userId: v.id('users'), paymentId: v.id('payments'), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId)
    if (!payment || payment.userId !== args.userId) throw new ConvexError('PAYMENT_NOT_FOUND')
    if (payment.status !== 'paid') throw new ConvexError('PAYMENT_NOT_REFUNDABLE')
    if (!payment.refundDeadline || Date.now() > payment.refundDeadline) throw new ConvexError('REFUND_WINDOW_CLOSED')
    const existing = await ctx.db.query('refundRequests').withIndex('by_payment', (q) => q.eq('paymentId', args.paymentId)).unique()
    if (existing) return existing._id
    return ctx.db.insert('refundRequests', {
      userId: args.userId,
      paymentId: args.paymentId,
      reason: args.reason?.trim() || undefined,
      status: 'requested',
      requestedAt: Date.now(),
    })
  },
})

export const processRefundSucceeded = mutation({
  args: { providerPaymentId: v.string(), webhookId: v.string(), refundedAt: v.number(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret)
    if (await alreadyProcessed(ctx, args.webhookId)) return { processed: false as const, duplicate: true as const }
    const payment = await ctx.db.query('payments').withIndex('by_provider_payment', (q) => q.eq('providerPaymentId', args.providerPaymentId)).unique()
    if (!payment) throw new ConvexError('PAYMENT_NOT_FOUND')
    await ctx.db.patch(payment._id, { status: 'refunded' })
    await ctx.db.patch(payment.userId, { accessStatus: 'refunded', accessUntil: undefined })
    const request = await ctx.db.query('refundRequests').withIndex('by_payment', (q) => q.eq('paymentId', payment._id)).unique()
    if (request) await ctx.db.patch(request._id, { status: 'completed', resolvedAt: args.refundedAt })
    await ctx.db.insert('paymentWebhookEvents', {
      webhookId: args.webhookId,
      eventType: 'refund.succeeded',
      providerPaymentId: args.providerPaymentId,
      processedAt: Date.now(),
    })
    return { processed: true as const }
  },
})

export const getPaymentState = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return null
    const payments = await ctx.db.query('payments').withIndex('by_user', (q) => q.eq('userId', args.userId)).order('desc').collect()
    const payment = payments[0]
    if (!payment) return { accessStatus: user.accessStatus, payment: null, refundRequest: null }
    const refundRequest = await ctx.db.query('refundRequests').withIndex('by_payment', (q) => q.eq('paymentId', payment._id)).unique()
    return {
      accessStatus: user.accessStatus,
      accessUntil: user.accessUntil,
      payment: {
        id: payment._id,
        status: payment.status,
        amountUsdCents: payment.amountUsdCents,
        mode: payment.mode,
        paidAt: payment.paidAt,
        refundDeadline: payment.refundDeadline,
      },
      refundRequest: refundRequest ? { status: refundRequest.status, requestedAt: refundRequest.requestedAt } : null,
    }
  },
})
