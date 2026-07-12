# Phase 6 — Dodo Payments setup

Status: code-complete demo/test adapter; dashboard credentials are not configured yet.

## Current safe behavior

- With no Dodo credentials, checkout opens an explicitly labeled Dodo demo checkout.
- Demo checkout never charges and never grants access.
- With test credentials, the server creates a Dodo test checkout and redirects to Dodo's hosted `checkout_url`.
- With live credentials and `DODO_PAYMENTS_MODE=live`, the same server adapter uses live mode.
- A return URL never grants access. Only a verified `payment.succeeded` webhook can grant access.

## Dodo dashboard steps

Use Test Mode while account/bank review is pending.

1. Create one one-time product:
   - Name: `TimeLeak 30-Day Time Reclaim Pass`
   - Price: `$9.99 USD`
   - Billing: one-time
2. Copy its product ID.
3. Generate a test API key.
4. Add this webhook endpoint:
   - `https://timeleak.neorishi.workers.dev/api/webhooks/dodo`
5. Subscribe to:
   - `payment.succeeded`
   - `payment.failed`
   - `refund.succeeded`
6. Copy the webhook signing secret.

## Required server environment variables

Cloudflare Worker secrets/variables:

- `DODO_PAYMENTS_API_KEY` — secret
- `DODO_PAYMENTS_PRODUCT_ID` — variable
- `DODO_PAYMENTS_WEBHOOK_KEY` — secret
- `DODO_PAYMENTS_MODE` — `test` initially; `live` only after approval and a live product/key
- `CONVEX_URL` — production Convex URL
- `PAYMENT_INTERNAL_SECRET` — a strong random secret shared only by Cloudflare and Convex

Convex environment:

- `PAYMENT_INTERNAL_SECRET` — exactly the same value as the Cloudflare secret

Never place API keys, webhook keys, or the internal secret in `VITE_*`, source code, Git, browser local storage, or screenshots.

## Refund MVP

- The paid account view shows the exact UTC refund deadline.
- `Request Refund` creates a Convex refund request with status `requested`.
- Until Dodo refund API wiring is enabled, process the actual refund manually in Dodo.
- Access remains active while the request is pending.
- Access changes to `refunded` only after a verified `refund.succeeded` webhook.
- The UI does not promise an instant automated refund.

## Live-mode checklist

Before changing `DODO_PAYMENTS_MODE` to `live`:

- Dodo account and bank review approved.
- Live one-time product is exactly `$9.99 USD`.
- Live API key installed as a server secret.
- Production webhook is registered and its signature secret installed.
- Test checkout email matches the Convex user's email.
- Test return page stays pending before webhook delivery.
- Duplicate webhook replay leaves `accessUntil` unchanged.
- Failed payment leaves access free.
- Refund success changes payment and access status.

Razorpay remains a backup only; no Razorpay code is included in this phase.
