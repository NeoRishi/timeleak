import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api.js'
import type { Id } from '../convex/_generated/dataModel.js'
import { runTimeLeakPipeline, type PipelineInput } from '../src/timeleakPipeline.js'
import { createCheckout, type PaymentEnvironment } from './payments.js'

function isPipelineInput(value: unknown): value is PipelineInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const sleep = input.sleepInterval
  if (!sleep || typeof sleep !== 'object' || Array.isArray(sleep)) return false
  const sleepInterval = sleep as Record<string, unknown>
  return typeof input.timezone === 'string'
    && typeof input.localDate === 'string'
    && typeof sleepInterval.start === 'string'
    && typeof sleepInterval.end === 'string'
    && Array.isArray(input.scheduleBlocks)
    && Array.isArray(input.intentionalRestBlocks)
    && typeof input.priority === 'string'
    && typeof input.minimumUsefulMinutes === 'number'
    && typeof input.plannedDays === 'number'
}

type WorkerEnvironment = Env & PaymentEnvironment

function convexClient(env: WorkerEnvironment) {
  const url = env.CONVEX_URL || import.meta.env.VITE_CONVEX_URL
  if (!url) throw new Error('CONVEX_URL_MISSING')
  return new ConvexHttpClient(url)
}

function headersRecord(headers: Headers) {
  return Object.fromEntries(headers.entries())
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      let input: unknown
      try {
        input = await request.json()
      } catch {
        return Response.json({ error: 'INVALID_PIPELINE_INPUT' }, { status: 400 })
      }
      if (!isPipelineInput(input)) {
        return Response.json({ error: 'INVALID_PIPELINE_INPUT' }, { status: 400 })
      }
      const execution = await runTimeLeakPipeline(input)
      return Response.json(execution, { status: execution.result.status === 'pass' ? 200 : 422 })
    }

    if (url.pathname === '/api/checkout' && request.method === 'POST') {
      let input: { userId?: string; email?: string }
      try {
        input = await request.json()
      } catch {
        return Response.json({ error: 'INVALID_CHECKOUT_INPUT' }, { status: 400 })
      }
      if (!input.userId || !input.email) return Response.json({ error: 'INVALID_CHECKOUT_INPUT' }, { status: 400 })
      try {
        const convex = convexClient(env)
        const checkout = await createCheckout(env, {
          userId: input.userId,
          email: input.email,
          returnUrl: `${url.origin}/?checkout=return`,
        }, {
          persist: (payment) => convex.mutation(api.payments.createPendingPayment, {
            ...payment,
            userId: payment.userId as Id<'users'>,
          }),
        })
        return Response.json(checkout)
      } catch (error) {
        console.error('Checkout creation failed', error)
        return Response.json({ error: 'CHECKOUT_UNAVAILABLE' }, { status: 503 })
      }
    }

    if (url.pathname === '/api/payment-state' && request.method === 'GET') {
      const userId = url.searchParams.get('userId')
      if (!userId) return Response.json({ error: 'USER_ID_REQUIRED' }, { status: 400 })
      try {
        const state = await convexClient(env).query(api.payments.getPaymentState, { userId: userId as Id<'users'> })
        return Response.json(state)
      } catch {
        return Response.json({ error: 'PAYMENT_STATE_UNAVAILABLE' }, { status: 503 })
      }
    }

    if (url.pathname === '/api/refund-request' && request.method === 'POST') {
      let input: { userId?: string; paymentId?: string }
      try {
        input = await request.json()
      } catch {
        return Response.json({ error: 'INVALID_REFUND_REQUEST' }, { status: 400 })
      }
      if (!input.userId || !input.paymentId) return Response.json({ error: 'INVALID_REFUND_REQUEST' }, { status: 400 })
      try {
        const refundRequestId = await convexClient(env).mutation(api.payments.requestRefund, {
          userId: input.userId as Id<'users'>,
          paymentId: input.paymentId as Id<'payments'>,
        })
        return Response.json({ refundRequestId, status: 'requested', processing: 'manual_or_api' })
      } catch {
        return Response.json({ error: 'REFUND_REQUEST_UNAVAILABLE' }, { status: 422 })
      }
    }

    if (url.pathname === '/api/webhooks/dodo' && request.method === 'POST') {
      if (!env.DODO_PAYMENTS_WEBHOOK_KEY || !env.PAYMENT_INTERNAL_SECRET) {
        return Response.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 503 })
      }
      const body = await request.text()
      try {
        const { default: DodoPayments } = await import('dodopayments')
        const client = new DodoPayments({ bearerToken: env.DODO_PAYMENTS_API_KEY || 'webhook-verification-only' })
        const event = client.webhooks.unwrap(body, {
          headers: headersRecord(request.headers),
          key: env.DODO_PAYMENTS_WEBHOOK_KEY,
        })
        const webhookId = request.headers.get('webhook-id')
        if (!webhookId) return Response.json({ error: 'WEBHOOK_ID_REQUIRED' }, { status: 400 })
        const convex = convexClient(env)
        if (event.type === 'payment.succeeded') {
          await convex.mutation(api.payments.processPaymentSucceeded, {
            providerPaymentId: event.data.payment_id,
            userId: typeof event.data.metadata?.convex_user_id === 'string'
              ? event.data.metadata.convex_user_id as Id<'users'>
              : undefined,
            webhookId,
            serverSecret: env.PAYMENT_INTERNAL_SECRET,
            paidAt: Date.parse(event.timestamp),
          })
        } else if (event.type === 'payment.failed') {
          await convex.mutation(api.payments.processPaymentFailed, {
            providerPaymentId: event.data.payment_id,
            userId: typeof event.data.metadata?.convex_user_id === 'string'
              ? event.data.metadata.convex_user_id as Id<'users'>
              : undefined,
            webhookId,
            serverSecret: env.PAYMENT_INTERNAL_SECRET,
          })
        } else if (event.type === 'refund.succeeded') {
          await convex.mutation(api.payments.processRefundSucceeded, {
            providerPaymentId: event.data.payment_id,
            webhookId,
            serverSecret: env.PAYMENT_INTERNAL_SECRET,
            refundedAt: Date.parse(event.timestamp),
          })
        }
        return Response.json({ received: true })
      } catch (error) {
        console.error('Dodo webhook rejected', error)
        return Response.json({ error: 'INVALID_WEBHOOK_SIGNATURE' }, { status: 400 })
      }
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<WorkerEnvironment>
