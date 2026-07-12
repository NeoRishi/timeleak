import { validateAnalysisResult, type PipelineExecution, type TimeLeakAnalysis } from './timeleakPipeline'

export const RESULT_STORAGE_KEY = 'timeleak.result.v1'

type SavedResult = Pick<PipelineExecution, 'result' | 'repairedBlocks'>

export type PublicSharePayload = {
  beforeMinutes: number
  afterMinutes: number
  monthlyHours: number
  leakLabel: string
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function compactLocalDateTime(value: string) {
  return value.replace(/[-:]/g, '').slice(0, 15)
}

export function createCalendarFile(result: TimeLeakAnalysis) {
  if (!result.calendarEvent) throw new Error('CALENDAR_EVENT_UNAVAILABLE')
  const event = result.calendarEvent
  const uid = `timeleak-${result.localDate}-${event.start.slice(11, 16).replace(':', '')}@timeleak.app`
  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TimeLeak//Tomorrow Repair//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;TZID=${result.timezone}:${compactLocalDateTime(event.start)}`,
    `DTEND;TZID=${result.timezone}:${compactLocalDateTime(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    'DESCRIPTION:Protected priority block created by TimeLeak.',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
  return {
    filename: `timeleak-${result.localDate}.ics`,
    mimeType: 'text/calendar;charset=utf-8',
    content,
  }
}

export function createPublicSharePayload(result: TimeLeakAnalysis): PublicSharePayload {
  return {
    beforeMinutes: result.shareResult.beforeMinutes,
    afterMinutes: result.shareResult.afterMinutes,
    monthlyHours: result.shareResult.monthlyHours,
    leakLabel: result.shareResult.leakLabel,
  }
}

export function saveResult(value: SavedResult) {
  localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(value))
}

export function loadSavedResult(): SavedResult | null {
  try {
    const raw = localStorage.getItem(RESULT_STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as SavedResult
    if (!validateAnalysisResult(saved?.result).valid || !Array.isArray(saved?.repairedBlocks)) return null
    return saved
  } catch {
    return null
  }
}

export function downloadTextFile(filename: string, mimeType: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
