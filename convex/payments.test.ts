// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const DAY = 24 * 60 * 60 * 1000
const INTERNAL_SECRET = 'phase-6-test-internal-secret'
;(globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } }).process.env.PAYMENT_INTERNAL_SECRET = INTERNAL_SECRET

async function createUser(t: ReturnType<typeof convexTest>, email = 'buyer@example.com') {
  return t.mutation(api.users.createOrFindUser, {
    email,
    sessionIdHash: `session-${email}`,
    timezone: 'Asia/Kolkata',
  })
}

describe('Phase 6 Dodo payment lifecycle', () => {
  it('creates a $9.99 pending checkout tied to the Convex user email', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await createUser(t)

    const paymentId = await t.mutation(api.payments.createPendingPayment, {
      userId,
      providerPaymentId: 'pay_pending_1',
      checkoutSessionId: 'cks_1',
      customerEmail: 'buyer@example.com',
      amountUsdCents: 999,
      mode: 'demo',
    })

    const payment = await t.run((ctx) => ctx.db.get(paymentId))
    expect(payment).toMatchObject({
      userId,
      provider: 'dodo',
      providerPaymentId: 'pay_pending_1',
      checkoutSessionId: 'cks_1',
      customerEmail: 'buyer@example.com',
      amountUsdCents: 999,
      status: 'pending',
      mode: 'demo',
    })
  })

  it('grants exactly 30 days only after payment.succeeded and ignores duplicate webhooks', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await createUser(t)
    await t.mutation(api.payments.createPendingPayment, {
      userId,
      providerPaymentId: 'pay_success_1',
      checkoutSessionId: 'cks_success_1',
      customerEmail: 'buyer@example.com',
      amountUsdCents: 999,
      mode: 'test',
    })
    const before = await t.run((ctx) => ctx.db.get(userId))
    expect(before?.accessStatus).toBe('free')

    const paidAt = Date.UTC(2026, 6, 13, 12)
    const first = await t.mutation(api.payments.processPaymentSucceeded, {
      providerPaymentId: 'pay_success_1',
      serverSecret: INTERNAL_SECRET,
      webhookId: 'wh_success_1',
      paidAt,
    })
    const duplicate = await t.mutation(api.payments.processPaymentSucceeded, {
      providerPaymentId: 'pay_success_1',
      serverSecret: INTERNAL_SECRET,
      webhookId: 'wh_success_1',
      paidAt: paidAt + DAY,
    })
    const duplicateEvent = await t.mutation(api.payments.processPaymentSucceeded, {
      providerPaymentId: 'pay_success_1',
      serverSecret: INTERNAL_SECRET,
      webhookId: 'wh_success_2',
      paidAt: paidAt + 2 * DAY,
    })

    expect(first).toMatchObject({ processed: true, accessUntil: paidAt + 30 * DAY, refundDeadline: paidAt + 7 * DAY })
    expect(duplicate).toEqual({ processed: false, duplicate: true })
    expect(duplicateEvent).toEqual({ processed: false, duplicate: true })
    const user = await t.run((ctx) => ctx.db.get(userId))
    expect(user).toMatchObject({ accessStatus: 'paid', accessUntil: paidAt + 30 * DAY })
    const payment = await t.run((ctx) => ctx.db.query('payments').withIndex('by_provider_payment', (q) => q.eq('providerPaymentId', 'pay_success_1')).unique())
    expect(payment).toMatchObject({ status: 'paid', paidAt, refundDeadline: paidAt + 7 * DAY })
  })

  it('rejects direct webhook lifecycle mutations without the server secret', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await createUser(t)
    await t.mutation(api.payments.createPendingPayment, {
      userId,
      providerPaymentId: 'pay_unauthorized_1',
      checkoutSessionId: 'cks_unauthorized_1',
      customerEmail: 'buyer@example.com',
      amountUsdCents: 999,
      mode: 'test',
    })

    await expect(t.mutation(api.payments.processPaymentSucceeded, {
      providerPaymentId: 'pay_unauthorized_1',
      serverSecret: 'wrong-secret',
      webhookId: 'wh_unauthorized_1',
      paidAt: Date.UTC(2026, 6, 13),
    })).rejects.toThrow('PAYMENT_WEBHOOK_UNAUTHORIZED')
    const user = await t.run((ctx) => ctx.db.get(userId))
    expect(user?.accessStatus).toBe('free')
  })

  it('does not grant access after payment.failed', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await createUser(t)
    await t.mutation(api.payments.createPendingPayment, {
      userId,
      providerPaymentId: 'pay_failed_1',
      checkoutSessionId: 'cks_failed_1',
      customerEmail: 'buyer@example.com',
      amountUsdCents: 999,
      mode: 'test',
    })

    await t.mutation(api.payments.processPaymentFailed, {
      providerPaymentId: 'pay_failed_1',
      serverSecret: INTERNAL_SECRET,
      webhookId: 'wh_failed_1',
    })

    const user = await t.run((ctx) => ctx.db.get(userId))
    expect(user?.accessStatus).toBe('free')
    const payment = await t.run((ctx) => ctx.db.query('payments').withIndex('by_provider_payment', (q) => q.eq('providerPaymentId', 'pay_failed_1')).unique())
    expect(payment?.status).toBe('failed')
  })

  it('creates a manual refund request without promising instant completion', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await createUser(t)
    const paymentId = await t.mutation(api.payments.createPendingPayment, {
      userId,
      providerPaymentId: 'pay_refund_request',
      checkoutSessionId: 'cks_refund_request',
      customerEmail: 'buyer@example.com',
      amountUsdCents: 999,
      mode: 'test',
    })
    await t.mutation(api.payments.processPaymentSucceeded, {
      providerPaymentId: 'pay_refund_request',
      serverSecret: INTERNAL_SECRET,
      webhookId: 'wh_paid_refund_request',
      paidAt: Date.UTC(2026, 6, 13),
    })

    const requestId = await t.mutation(api.payments.requestRefund, { userId, paymentId, reason: 'Changed my mind' })
    const request = await t.run((ctx) => ctx.db.get(requestId))
    expect(request).toMatchObject({ status: 'requested', reason: 'Changed my mind' })
    const user = await t.run((ctx) => ctx.db.get(userId))
    expect(user?.accessStatus).toBe('paid')
  })

  it('ends access only after refund.succeeded is confirmed', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await createUser(t)
    await t.mutation(api.payments.createPendingPayment, {
      userId,
      providerPaymentId: 'pay_refunded_1',
      checkoutSessionId: 'cks_refunded_1',
      customerEmail: 'buyer@example.com',
      amountUsdCents: 999,
      mode: 'test',
    })
    await t.mutation(api.payments.processPaymentSucceeded, {
      providerPaymentId: 'pay_refunded_1',
      serverSecret: INTERNAL_SECRET,
      webhookId: 'wh_paid_refunded_1',
      paidAt: Date.UTC(2026, 6, 13),
    })

    await t.mutation(api.payments.processRefundSucceeded, {
      providerPaymentId: 'pay_refunded_1',
      serverSecret: INTERNAL_SECRET,
      webhookId: 'wh_refunded_1',
      refundedAt: Date.UTC(2026, 6, 14),
    })

    const user = await t.run((ctx) => ctx.db.get(userId))
    expect(user?.accessStatus).toBe('refunded')
    expect(user?.accessUntil).toBeUndefined()
    const payment = await t.run((ctx) => ctx.db.query('payments').withIndex('by_provider_payment', (q) => q.eq('providerPaymentId', 'pay_refunded_1')).unique())
    expect(payment?.status).toBe('refunded')
  })
})
