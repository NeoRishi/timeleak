import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api.js'
import type { Id } from '../convex/_generated/dataModel.js'
import { runTimeLeakPipeline, validateAnalysisResult, type PipelineInput, type TimeLeakAnalysis } from '../src/timeleakPipeline.js'
import { createCheckout, type PaymentEnvironment } from './payments.js'
import { createBriefingAudio, transcribeScheduleAudio } from './elevenlabs.js'
import { interpretScheduleTranscript } from './openaiSchedule.js'

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

type WorkerEnvironment = Env & PaymentEnvironment & {
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_VOICE_ID?: string
  OPENAI_API_KEY?: string
}

async function analysisCacheId(result: TimeLeakAnalysis) {
  const bytes = new TextEncoder().encode(JSON.stringify(result))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

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

    if (url.pathname === '/api/transcribe-schedule' && request.method === 'POST') {
      if (!env.ELEVENLABS_API_KEY) return Response.json({ error: 'VOICE_NOT_CONFIGURED' }, { status: 503 })
      try {
        const form = await request.formData()
        const audio = form.get('audio')
        if (!(audio instanceof File)) return Response.json({ error: 'AUDIO_REQUIRED' }, { status: 400 })
        const transcript = await transcribeScheduleAudio(audio, { apiKey: env.ELEVENLABS_API_KEY })
        return Response.json(transcript, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        const code = error instanceof Error ? error.message : 'TRANSCRIPTION_FAILED'
        const status = ['EMPTY_AUDIO', 'AUDIO_TOO_LARGE'].includes(code) ? 400 : 502
        return Response.json({ error: code }, { status, headers: { 'cache-control': 'no-store' } })
      }
    }

    if (url.pathname === '/api/interpret-schedule' && request.method === 'POST') {
      if (!env.OPENAI_API_KEY) return Response.json({ error: 'SCHEDULE_AI_NOT_CONFIGURED' }, { status: 503 })
      let transcript = ''
      try {
        const body = await request.json() as { transcript?: unknown }
        transcript = typeof body.transcript === 'string' ? body.transcript : ''
      } catch {
        return Response.json({ error: 'INVALID_TRANSCRIPT' }, { status: 400 })
      }
      try {
        const schedule = await interpretScheduleTranscript(transcript, { apiKey: env.OPENAI_API_KEY })
        return Response.json(schedule, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        const code = error instanceof Error ? error.message : 'SCHEDULE_INTERPRETATION_FAILED'
        const status = ['EMPTY_TRANSCRIPT', 'TRANSCRIPT_TOO_LARGE', 'NO_EXPLICIT_SCHEDULE_BLOCKS', 'OVERLAPPING_SCHEDULE'].includes(code) ? 422 : 502
        return Response.json({ error: code }, { status, headers: { 'cache-control': 'no-store' } })
      }
    }

    if (url.pathname === '/api/briefing' && request.method === 'POST') {
      if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) {
        return Response.json({ error: 'VOICE_NOT_CONFIGURED' }, { status: 503 })
      }
      let result: unknown
      try {
        result = await request.json()
      } catch {
        return Response.json({ error: 'JUDGE_APPROVED_RESULT_REQUIRED' }, { status: 400 })
      }
      const validation = validateAnalysisResult(result)
      if (!validation.valid || (result as TimeLeakAnalysis).status !== 'pass') {
        return Response.json({ error: 'JUDGE_APPROVED_RESULT_REQUIRED' }, { status: 400 })
      }
      const approved = result as TimeLeakAnalysis
      const analysisId = await analysisCacheId(approved)
      const cacheKey = new Request(`${url.origin}/api/briefing-cache/${analysisId}`)
      const cache = caches.default
      const cached = await cache.match(cacheKey)
      if (cached) {
        const headers = new Headers(cached.headers)
        headers.set('x-analysis-id', analysisId)
        headers.set('x-audio-cache', 'hit')
        return new Response(cached.body, { headers })
      }
      try {
        const generated = await createBriefingAudio(approved, {
          apiKey: env.ELEVENLABS_API_KEY,
          voiceId: env.ELEVENLABS_VOICE_ID,
        })
        const audio = new Response(generated.body, {
          headers: {
            'content-type': generated.headers.get('content-type') || 'audio/mpeg',
            'cache-control': 'private, max-age=31536000',
            'x-analysis-id': analysisId,
            'x-audio-cache': 'miss',
          },
        })
        await cache.put(cacheKey, audio.clone())
        return audio
      } catch (error) {
        console.error('ElevenLabs briefing failed', error)
        return Response.json({ error: 'BRIEFING_UNAVAILABLE' }, { status: 502 })
      }
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
