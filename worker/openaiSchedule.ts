type Fetcher = typeof fetch

type ScheduleEvent = {
  start: string
  end: string
  title: string
  category: 'fixed' | 'maintenance' | 'intentional_rest' | 'unowned' | 'unclassified'
  movable: boolean
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    events: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          start: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
          end: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
          title: { type: 'string', minLength: 1, maxLength: 100 },
          category: { type: 'string', enum: ['fixed', 'maintenance', 'intentional_rest', 'unowned', 'unclassified'] },
          movable: { type: 'boolean' },
        },
        required: ['start', 'end', 'title', 'category', 'movable'],
      },
    },
  },
  required: ['events'],
} as const

function minutes(clock: string) {
  const [hour, minute] = clock.split(':').map(Number)
  return hour * 60 + minute
}

function formatClock(clock: string) {
  const [hour, minute] = clock.split(':').map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

function extractOutputText(body: unknown) {
  if (!body || typeof body !== 'object') return ''
  const response = body as { output_text?: unknown; output?: unknown }
  if (typeof response.output_text === 'string') return response.output_text
  if (!Array.isArray(response.output)) return ''
  for (const item of response.output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text
      }
    }
  }
  return ''
}

function validateEvents(value: unknown): ScheduleEvent[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { events?: unknown }).events)) throw new Error('INVALID_SCHEDULE_OUTPUT')
  const events = (value as { events: ScheduleEvent[] }).events
  if (!events.length) throw new Error('NO_EXPLICIT_SCHEDULE_BLOCKS')
  for (const event of events) {
    if (!event || typeof event.title !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.end)) {
      throw new Error('INVALID_SCHEDULE_OUTPUT')
    }
    if (minutes(event.end) <= minutes(event.start)) throw new Error('INVALID_SCHEDULE_RANGE')
  }
  events.sort((a, b) => a.start.localeCompare(b.start))
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].start < events[index - 1].end) throw new Error('OVERLAPPING_SCHEDULE')
  }
  return events
}

export async function interpretScheduleTranscript(transcript: string, options: { apiKey: string; fetcher?: Fetcher }) {
  const privateText = transcript.trim()
  if (!options.apiKey.trim()) throw new Error('OPENAI_API_KEY_MISSING')
  if (!privateText) throw new Error('EMPTY_TRANSCRIPT')
  if (privateText.length > 5000) throw new Error('TRANSCRIPT_TOO_LARGE')
  const response = await (options.fetcher || fetch)('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      input: [
        {
          role: 'system',
          content: 'Convert only schedule facts explicitly supplied by the user into time blocks. Never invent commute, chores, meals, phone use, fatigue, relationships, health, or missing times. Omit any activity without both a clear start and end time. Use short neutral titles. Mark movable true only when the user explicitly says the activity is flexible, optional, drifting, scrolling, or unplanned.',
        },
        { role: 'user', content: privateText },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'timeleak_spoken_schedule',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  })
  if (!response.ok) throw new Error(`OPENAI_SCHEDULE_FAILED_${response.status}`)
  const outputText = extractOutputText(await response.json())
  if (!outputText) throw new Error('EMPTY_SCHEDULE_OUTPUT')
  let parsed: unknown
  try { parsed = JSON.parse(outputText) } catch { throw new Error('INVALID_SCHEDULE_OUTPUT') }
  const events = validateEvents(parsed)
  return {
    events: events.map((event) => ({ ...event, source: 'voice' as const })),
    scheduleText: events.map((event) => `${formatClock(event.start)} - ${formatClock(event.end)}: ${event.title}`).join('\n'),
  }
}
