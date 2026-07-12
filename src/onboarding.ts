export type ScheduleMethod = '' | 'demo' | 'paste' | 'voice' | 'screenshot'
export type PriorityCategory = '' | 'Health' | 'Family' | 'Learning' | 'Personal project' | 'Creative work' | 'Other'

export type ScheduleEvent = {
  start: string
  end: string
  title: string
  category: string
  movable: boolean
  source: string
}

export type OnboardingState = {
  started: boolean
  step: 1 | 2 | 3 | 4 | 5
  email: string
  userId: string
  sessionId: string
  sleepStart: string
  wakeTime: string
  scheduleMethod: ScheduleMethod
  pastedSchedule: string
  scheduleEvents: ScheduleEvent[]
  priorityCategory: PriorityCategory
  priorityText: string
  priorityMinimumMinutes: 45 | 60 | 90
}

export const STORAGE_KEY = 'timeleak.onboarding.v1'

export const MONDAY_DEMO_EVENTS: ScheduleEvent[] = [
  { start: '07:00', end: '08:00', title: 'Morning routine and breakfast', category: 'maintenance', movable: false, source: 'demo' },
  { start: '08:00', end: '09:00', title: 'Commute', category: 'fixed', movable: false, source: 'demo' },
  { start: '09:00', end: '18:00', title: 'Work', category: 'fixed', movable: false, source: 'demo' },
  { start: '18:00', end: '19:00', title: 'Commute home', category: 'fixed', movable: false, source: 'demo' },
  { start: '19:00', end: '20:10', title: 'Dinner and household responsibilities', category: 'maintenance', movable: false, source: 'demo' },
  { start: '20:10', end: '21:00', title: 'Scrolling and undecided transition', category: 'unowned', movable: true, source: 'demo' },
  { start: '21:00', end: '21:30', title: 'Unplanned small chores', category: 'maintenance', movable: true, source: 'demo' },
  { start: '21:30', end: '22:30', title: 'Intentional leisure', category: 'intentional_rest', movable: false, source: 'demo' },
  { start: '22:30', end: '23:00', title: 'Wind-down', category: 'protected', movable: false, source: 'demo' },
]

function createSessionId() {
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('') || `session-${Date.now()}`
}

export async function hashSessionId(sessionId: string) {
  const bytes = new TextEncoder().encode(sessionId)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('')
}

export function initialOnboardingState(): OnboardingState {
  return {
    started: false,
    step: 1,
    email: '',
    userId: '',
    sessionId: createSessionId(),
    sleepStart: '23:00',
    wakeTime: '07:00',
    scheduleMethod: '',
    pastedSchedule: '',
    scheduleEvents: [],
    priorityCategory: '',
    priorityText: '',
    priorityMinimumMinutes: 60,
  }
}

export function loadOnboardingState(): OnboardingState {
  const fallback = initialOnboardingState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<OnboardingState>
    const step = Number(saved.step)
    return {
      ...fallback,
      ...saved,
      step: step >= 1 && step <= 5 ? (step as OnboardingState['step']) : 1,
      sessionId: saved.sessionId || fallback.sessionId,
      scheduleEvents: Array.isArray(saved.scheduleEvents) ? saved.scheduleEvents : [],
    }
  } catch {
    return fallback
  }
}

export function saveOnboardingState(state: OnboardingState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function minutesFromClock(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function sleepDurationMinutes(start: string, end: string) {
  const startMinutes = minutesFromClock(start)
  const endMinutes = minutesFromClock(end)
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return 0
  return (endMinutes - startMinutes + 1440) % 1440
}

function parseTimeToken(value: string) {
  const match = value.trim().toLowerCase().replace(/\./g, '').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const meridiem = match[3]
  if (minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    if (hour === 12) hour = 0
    if (meridiem === 'pm') hour += 12
  } else if (hour > 23) return null
  return hour * 60 + minute
}

function clockFromMinutes(minutes: number) {
  const safe = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export function formatClock(value: string) {
  const minutes = minutesFromClock(value)
  if (minutes === null) return value
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

export function parseSchedule(text: string) {
  const events: ScheduleEvent[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const pattern = /^(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*:?\s*(.+)$/i

  lines.forEach((line, index) => {
    const match = line.match(pattern)
    const start = match ? parseTimeToken(match[1]) : null
    const end = match ? parseTimeToken(match[2]) : null
    const title = match?.[3]?.trim()
    if (start === null || end === null || end <= start || !title) {
      errors.push(`Line ${index + 1} could not be read.`)
      return
    }
    events.push({
      start: clockFromMinutes(start),
      end: clockFromMinutes(end),
      title,
      category: 'unclassified',
      movable: false,
      source: 'paste',
    })
  })

  events.sort((a, b) => a.start.localeCompare(b.start))
  const overlaps: string[] = []
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].start < events[index - 1].end) {
      overlaps.push(`${events[index - 1].title} overlaps ${events[index].title}.`)
    }
  }

  return { events, errors, overlaps }
}
