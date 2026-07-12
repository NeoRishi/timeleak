
export type PaymentEnvironment = {
  DODO_PAYMENTS_API_KEY?: string
  DODO_PAYMENTS_PRODUCT_ID?: string
  DODO_PAYMENTS_WEBHOOK_KEY?: string
  DODO_PAYMENTS_MODE?: 'test' | 'live'
  CONVEX_URL?: string
  PAYMENT_INTERNAL_SECRET?: string
}

export type CheckoutInput = { userId: string; email: string; returnUrl: string }
export type PendingPayment = {
  userId: string
  providerPaymentId: string
  checkoutSessionId: string
  customerEmail: string
  amountUsdCents: 999
  mode: 'demo' | 'test' | 'live'
}

type SessionResponse = { session_id: string; payment_id?: string | null; checkout_url?: string | null }
type CheckoutDependencies = {
  persist: (payment: PendingPayment) => Promise<unknown>
  createDodoSession?: (request: {
    product_cart: Array<{ product_id: string; quantity: number }>
    customer: { email: string }
    metadata: Record<string, string>
    return_url: string
    cancel_url: string
    confirm: true
  }) => Promise<SessionResponse>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateInput(input: CheckoutInput) {
  let url: URL
  try {
    url = new URL(input.returnUrl)
  } catch {
    throw new Error('INVALID_CHECKOUT_INPUT')
  }
  if (!input.userId.trim() || !EMAIL.test(input.email.trim()) || !['https:', 'http:'].includes(url.protocol)) {
    throw new Error('INVALID_CHECKOUT_INPUT')
  }
}

function randomId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export async function createCheckout(env: PaymentEnvironment, input: CheckoutInput, dependencies: CheckoutDependencies) {
  validateInput(input)
  const email = input.email.trim().toLowerCase()
  const hasDodo = Boolean(env.DODO_PAYMENTS_API_KEY && env.DODO_PAYMENTS_PRODUCT_ID)

  if (!hasDodo) {
    const checkoutSessionId = randomId('demo_cks')
    const providerPaymentId = randomId('demo_pay')
    const mode = 'demo' as const
    await dependencies.persist({
      userId: input.userId,
      providerPaymentId,
      checkoutSessionId,
      customerEmail: email,
      amountUsdCents: 999,
      mode,
    })
    const origin = new URL(input.returnUrl).origin
    const params = new URLSearchParams({
      session: checkoutSessionId,
      amount: '999',
      email,
      return_url: input.returnUrl,
    })
    return {
      mode,
      amountUsdCents: 999 as const,
      customerEmail: email,
      checkoutSessionId,
      providerPaymentId,
      checkoutUrl: `${origin}/checkout/demo?${params}`,
    }
  }

  const mode = env.DODO_PAYMENTS_MODE === 'live' ? 'live' as const : 'test' as const
  const request = {
    product_cart: [{ product_id: env.DODO_PAYMENTS_PRODUCT_ID!, quantity: 1 }],
    customer: { email },
    metadata: { convex_user_id: input.userId, product: 'timeleak_30_day_pass' },
    return_url: input.returnUrl,
    cancel_url: input.returnUrl.replace('checkout=return', 'checkout=cancelled'),
    confirm: true as const,
  }
  const createSession = dependencies.createDodoSession ?? (async (body: typeof request) => {
    const { default: DodoPayments } = await import('dodopayments')
    const client = new DodoPayments({
      bearerToken: env.DODO_PAYMENTS_API_KEY!,
      environment: mode === 'live' ? 'live_mode' : 'test_mode',
    })
    return client.checkoutSessions.create(body)
  })
  const session = await createSession(request)
  if (!session.checkout_url) throw new Error('DODO_CHECKOUT_URL_MISSING')
  const providerPaymentId = session.payment_id || `session:${session.session_id}`
  await dependencies.persist({
    userId: input.userId,
    providerPaymentId,
    checkoutSessionId: session.session_id,
    customerEmail: email,
    amountUsdCents: 999,
    mode,
  })
  return {
    mode,
    amountUsdCents: 999 as const,
    customerEmail: email,
    checkoutSessionId: session.session_id,
    providerPaymentId,
    checkoutUrl: session.checkout_url,
  }
}
