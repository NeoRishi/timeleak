import { useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import App, { type OnboardingBackend } from './App'

export function ConnectedApp() {
  const createOrFindUser = useMutation(api.users.createOrFindUser)
  const trackEvent = useMutation(api.events.trackEvent)

  const backend: OnboardingBackend = {
    createUser: (input) => createOrFindUser(input),
    trackEvent: (name, properties, userId, sessionId) =>
      trackEvent({
        name,
        properties,
        userId: userId ? (userId as Id<'users'>) : undefined,
        sessionId: sessionId || 'missing-session',
      }),
    analyze: async (input) => {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error('ANALYSIS_FAILED')
      return response.json()
    },
  }

  return <App backend={backend} />
}
