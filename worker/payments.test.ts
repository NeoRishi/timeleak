import { describe, expect, it, vi } from 'vitest'
import { createCheckout, type PaymentEnvironment } from './payments.js'

const input = {
  userId: 'user_123',
  email: 'buyer@example.com',
  returnUrl: 'https://timeleak.neorishi.workers.dev/?checkout=return',
}

describe('Phase 6 Dodo checkout adapter', () => {
  it('creates an explicitly labeled demo checkout when Dodo credentials are unavailable', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const checkout = await createCheckout({} as PaymentEnvironment, input, { persist })

    expect(checkout).toMatchObject({
      mode: 'demo',
      amountUsdCents: 999,
      customerEmail: 'buyer@example.com',
      checkoutUrl: expect.stringContaining('/checkout/demo'),
    })
    expect(checkout.checkoutUrl).toContain('amount=999')
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_123',
      customerEmail: 'buyer@example.com',
      amountUsdCents: 999,
      mode: 'demo',
    }))
  })

  it('creates a Dodo test checkout with product, customer, metadata, and return URL', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const createDodoSession = vi.fn().mockResolvedValue({
      session_id: 'cks_test_123',
      payment_id: 'pay_test_123',
      checkout_url: 'https://checkout.dodopayments.com/session/cks_test_123',
    })
    const env = {
      DODO_PAYMENTS_API_KEY: 'test-key',
      DODO_PAYMENTS_PRODUCT_ID: 'pdt_timeleak',
      DODO_PAYMENTS_MODE: 'test',
    } as PaymentEnvironment

    const checkout = await createCheckout(env, input, { persist, createDodoSession })

    expect(createDodoSession).toHaveBeenCalledWith(expect.objectContaining({
      product_cart: [{ product_id: 'pdt_timeleak', quantity: 1 }],
      customer: { email: 'buyer@example.com' },
      metadata: { convex_user_id: 'user_123', product: 'timeleak_30_day_pass' },
      return_url: input.returnUrl,
    }))
    expect(checkout).toMatchObject({ mode: 'test', amountUsdCents: 999, checkoutUrl: 'https://checkout.dodopayments.com/session/cks_test_123' })
  })

  it('never creates checkout for a malformed user, email, or return URL', async () => {
    const persist = vi.fn()
    await expect(createCheckout({} as PaymentEnvironment, { ...input, email: 'bad' }, { persist })).rejects.toThrow('INVALID_CHECKOUT_INPUT')
    await expect(createCheckout({} as PaymentEnvironment, { ...input, userId: '' }, { persist })).rejects.toThrow('INVALID_CHECKOUT_INPUT')
    await expect(createCheckout({} as PaymentEnvironment, { ...input, returnUrl: 'javascript:alert(1)' }, { persist })).rejects.toThrow('INVALID_CHECKOUT_INPUT')
    expect(persist).not.toHaveBeenCalled()
  })
})
