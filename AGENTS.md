# TimeLeak Project Instructions

## Product

TimeLeak is a Personal Time Reclaim Agent for ambitious professionals. It maps one ordinary 24-hour day, protects sleep and intentional rest, finds the largest honestly reclaimable time leak, and produces one feasible repair for tomorrow.

Core promise: Show us your 24 hours. We find the time you can honestly reclaim and protect it for what matters beyond work.

## Scope lock

- One user goal, one 24-hour map, one leak, one repair.
- Free users get one complete repair for tomorrow.
- Paid offer is a one-time $9.99 30-day pass with immediate access and a seven-calendar-day full-refund window.
- Do not build a dashboard, habit tracker, medical tool, personality test, time tracker, or generic chatbot.
- Do not reduce sleep, essential work, caregiving, meals, or intentional rest to create time.
- Leaked time means time the user neither consciously chose nor valued afterward.

## Required onboarding

Target: under two minutes; hard ceiling: five minutes.

Collect only:
1. Email.
2. Sleep and wake time.
3. Tomorrow's full-day schedule by demo, paste, screenshot, or short voice description.
4. One life priority that keeps getting postponed.

Ask a follow-up only when the 24-hour map has a material gap or contradiction.

## Agent workflow

Run in this order:
1. Day Mapper: normalize the full day and mark uncertainty.
2. Leak Detective: select exactly one defensible leak.
3. Day Architect: create exactly one conflict-free repair.
4. Truth Judge: validate arithmetic, privacy, feasibility, and product rules.

If the judge fails the result, revise once. If it still fails, return an honest limited result instead of invented precision.

## Output contract

Return JSON matching `contracts/timeleak-analysis.schema.json`. Never add undocumented fields to production responses. Store inputs, outputs, stage status, latency, and errors in Convex.

## Privacy and claims

- Never infer phone use, chores, relationships, commute, health, or fatigue unless the user supplied it.
- Never expose private event names or priorities on a share card.
- Never show chain-of-thought. Show short, user-facing explanations only.
- Never make medical, psychological, chronotype, Dosha, or productivity diagnoses.
- Treat uploaded schedules as private. Do not send them to LinkUp or public services.

## Build stack

- Hermes with OpenAI drives the agent workflow.
- Convex is the source of truth for users, analyses, events, access, payments, and agent runs.
- Cloudflare hosts the public product and may proxy server-side calls.
- Dodo Payments provides the live $9.99 checkout and payment webhooks.
- ElevenLabs creates a dynamic spoken Tomorrow Briefing from an approved result.
- LinkUp may find one current starting resource only when the user's chosen priority genuinely needs live search.
- Wispr Flow is used to dictate build prompts, copy, tests, and the demo script; it is not an end-user integration.

## Definition of done

A cold user can enter an email, complete onboarding, receive a truthful tomorrow repair in under two minutes, download or copy the repair, see the $9.99 offer, and complete checkout. The Convex dashboard must show the user, first-use event, analysis, and payment status. The product must be live on a Cloudflare URL and survive empty input, malformed schedule, refresh, back navigation, duplicate webhook, and agent timeout.

