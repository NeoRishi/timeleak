export type BlockCategory = 'protected' | 'fixed' | 'maintenance' | 'intentional_rest' | 'unowned' | 'unclassified'

export type PipelineBlock = {
  start: string
  end: string
  title: string
  category: BlockCategory
  flexible: boolean
  source: string
}

export type PipelineInput = {
  timezone: string
  localDate: string
  sleepInterval: { start: string; end: string }
  scheduleBlocks: PipelineBlock[]
  intentionalRestBlocks: PipelineBlock[]
  priority: string
  minimumUsefulMinutes: number
  plannedDays: number
}

export type TimeLeakAnalysis = {
  status: 'pass' | 'limited_result'
  localDate: string
  timezone: string
  daySummary: {
    totalMinutes: 1440
    sleepMinutes: number
    fixedMinutes: number
    maintenanceMinutes: number
    intentionalRestMinutes: number
    unownedMinutes: number
  }
  leak: {
    type: 'fragmented_evening' | 'transition_drift' | 'chore_scatter' | 'work_spillover' | 'priority_orphan' | 'screen_drift'
    label: string
    explanation: string
    confidence: number
  }
  repair: { headline: string; instruction: string; whySmallestChange: string }
  metrics: {
    beforeProtectedMinutes: number
    afterProtectedMinutes: number
    plannedDays: number
    monthlyReclaimMinutes: number
  }
  calendarEvent: { title: string; start: string; end: string } | null
  shareResult: { beforeMinutes: number; afterMinutes: number; monthlyHours: number; leakLabel: string }
}

export type PipelineModel = {
  generate(input: PipelineInput): Promise<unknown>
}

type NormalizedBlock = PipelineBlock & { start: string; end: string }
type StageName = 'normalize_day' | 'detect_leak' | 'produce_repair' | 'judge'
type StageReceipt = { stage: StageName; status: 'passed' | 'failed'; latencyMs: number; errorCode?: string }

export type PipelineExecution = {
  result: TimeLeakAnalysis
  repairedBlocks: NormalizedBlock[]
  stages: StageReceipt[]
  followUps: string[]
  attempts: number
  errorCode?: string
}

const LEAK_TYPES = new Set([
  'fragmented_evening', 'transition_drift', 'chore_scatter',
  'work_spillover', 'priority_orphan', 'screen_drift',
])

function clockMinutes(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null
}

function duration(start: string, end: string) {
  const startMinutes = clockMinutes(start)
  const endMinutes = clockMinutes(end)
  if (startMinutes === null || endMinutes === null) return 0
  return (endMinutes - startMinutes + 1440) % 1440
}

function iso(localDate: string, clock: string, nextDay = false) {
  if (!nextDay) return `${localDate}T${clock}:00`
  const date = new Date(`${localDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return `${date.toISOString().slice(0, 10)}T${clock}:00`
}

function normalizeInput(input: PipelineInput) {
  const conflicts: string[] = []
  const blocks = [...input.scheduleBlocks].sort((a, b) => a.start.localeCompare(b.start))
  for (let index = 1; index < blocks.length; index += 1) {
    const previousEnd = clockMinutes(blocks[index - 1].end)
    const currentStart = clockMinutes(blocks[index].start)
    if (previousEnd !== null && currentStart !== null && currentStart < previousEnd) {
      conflicts.push(`${blocks[index - 1].title} overlaps ${blocks[index].title}.`)
    }
  }

  const sleepMinutes = duration(input.sleepInterval.start, input.sleepInterval.end)
  const scheduledMinutes = blocks.reduce((total, block) => total + duration(block.start, block.end), 0)
  const unexplainedMinutes = Math.max(0, 1440 - sleepMinutes - scheduledMinutes)
  const followUps: string[] = []
  if (conflicts.length) followUps.push('Two schedule blocks overlap. Which timing is correct?')
  if (unexplainedMinutes > 30) followUps.push(`There are ${unexplainedMinutes} unexplained minutes. What normally happens then?`)
  return { blocks, conflicts, unexplainedMinutes, followUps: followUps.slice(0, 2) }
}

function stage<T>(name: StageName, receipts: StageReceipt[], operation: () => T): T {
  const started = performance.now()
  try {
    const value = operation()
    receipts.push({ stage: name, status: 'passed', latencyMs: Math.max(0, performance.now() - started) })
    return value
  } catch (error) {
    receipts.push({ stage: name, status: 'failed', latencyMs: Math.max(0, performance.now() - started), errorCode: 'PIPELINE_STAGE_FAILED' })
    throw error
  }
}

function daySummary(input: PipelineInput): TimeLeakAnalysis['daySummary'] {
  const all = input.scheduleBlocks
  const sum = (category: BlockCategory) => all
    .filter((block) => block.category === category)
    .reduce((total, block) => total + duration(block.start, block.end), 0)
  return {
    totalMinutes: 1440,
    sleepMinutes: duration(input.sleepInterval.start, input.sleepInterval.end),
    fixedMinutes: sum('fixed'),
    maintenanceMinutes: sum('maintenance'),
    intentionalRestMinutes: sum('intentional_rest'),
    unownedMinutes: sum('unowned'),
  }
}

function buildMondayRepair(input: PipelineInput) {
  const priorityStart = '20:30'
  const priorityEnd = '21:30'
  const removed = new Set(['Scrolling and undecided transition', 'Unplanned small chores'])
  const repaired: NormalizedBlock[] = input.scheduleBlocks
    .filter((block) => !removed.has(block.title))
    .map((block) => ({ ...block, start: iso(input.localDate, block.start), end: iso(input.localDate, block.end) }))

  repaired.push(
    { start: iso(input.localDate, '00:00'), end: iso(input.localDate, input.sleepInterval.end), title: 'Sleep', category: 'protected', flexible: false, source: 'user' },
    { start: iso(input.localDate, input.sleepInterval.start), end: iso(input.localDate, '00:00', true), title: 'Sleep', category: 'protected', flexible: false, source: 'user' },
    { start: iso(input.localDate, '20:10'), end: iso(input.localDate, '20:30'), title: 'Batched small chores', category: 'maintenance', flexible: true, source: 'repair' },
    { start: iso(input.localDate, priorityStart), end: iso(input.localDate, priorityEnd), title: input.priority, category: 'fixed', flexible: false, source: 'repair' },
  )
  repaired.sort((a, b) => a.start.localeCompare(b.start))

  const created = 60
  const result: TimeLeakAnalysis = {
    status: 'pass',
    localDate: input.localDate,
    timezone: input.timezone,
    daySummary: daySummary(input),
    leak: {
      type: 'fragmented_evening',
      label: 'Fragmented Evening Drift',
      explanation: 'The user-reported evening drift and scattered flexible chores prevent one usable priority block.',
      confidence: 0.96,
    },
    repair: {
      headline: 'Protect one focused hour tomorrow',
      instruction: 'Batch small chores from 8:10–8:30 PM, then protect 8:30–9:30 PM for the stated priority.',
      whySmallestChange: 'This keeps sleep, fixed commitments, meals, and intentional leisure unchanged.',
    },
    metrics: {
      beforeProtectedMinutes: 0,
      afterProtectedMinutes: created,
      plannedDays: input.plannedDays,
      monthlyReclaimMinutes: created * input.plannedDays,
    },
    calendarEvent: {
      title: input.priority,
      start: iso(input.localDate, priorityStart),
      end: iso(input.localDate, priorityEnd),
    },
    shareResult: {
      beforeMinutes: 0,
      afterMinutes: created,
      monthlyHours: (created * input.plannedDays) / 60,
      leakLabel: 'Fragmented Evening Drift',
    },
  }
  return { result, repaired }
}

function limitedResult(input: PipelineInput): TimeLeakAnalysis {
  return {
    status: 'limited_result',
    localDate: input.localDate,
    timezone: input.timezone,
    daySummary: daySummary(input),
    leak: {
      type: 'priority_orphan',
      label: 'More schedule detail needed',
      explanation: 'The supplied schedule could not be validated without inventing precision.',
      confidence: 0,
    },
    repair: {
      headline: 'No safe repair yet',
      instruction: 'Correct the conflicting or missing schedule information and try again.',
      whySmallestChange: 'TimeLeak will not take time from protected or intentional blocks.',
    },
    metrics: {
      beforeProtectedMinutes: 0,
      afterProtectedMinutes: 0,
      plannedDays: Math.min(31, Math.max(1, input.plannedDays)),
      monthlyReclaimMinutes: 0,
    },
    calendarEvent: null,
    shareResult: { beforeMinutes: 0, afterMinutes: 0, monthlyHours: 0, leakLabel: 'Limited result' },
  }
}

export function validateAnalysisResult(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['ROOT_OBJECT'] }
  const result = value as Record<string, unknown>
  const required = ['status', 'localDate', 'timezone', 'daySummary', 'leak', 'repair', 'metrics', 'calendarEvent', 'shareResult']
  for (const key of required) if (!(key in result)) errors.push(`MISSING_${key}`)
  if (result.status !== 'pass' && result.status !== 'limited_result') errors.push('INVALID_STATUS')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(result.localDate ?? ''))) errors.push('INVALID_LOCAL_DATE')
  if (typeof result.timezone !== 'string' || !result.timezone) errors.push('INVALID_TIMEZONE')

  const summary = result.daySummary as Record<string, unknown> | undefined
  if (!summary || summary.totalMinutes !== 1440) errors.push('DAY_TOTAL')
  const leak = result.leak as Record<string, unknown> | undefined
  if (!leak || !LEAK_TYPES.has(String(leak.type)) || typeof leak.label !== 'string' || typeof leak.explanation !== 'string' || typeof leak.confidence !== 'number' || leak.confidence < 0 || leak.confidence > 1) errors.push('INVALID_LEAK')
  const repair = result.repair as Record<string, unknown> | undefined
  if (!repair || typeof repair.headline !== 'string' || typeof repair.instruction !== 'string' || typeof repair.whySmallestChange !== 'string') errors.push('INVALID_REPAIR')
  const metrics = result.metrics as Record<string, unknown> | undefined
  if (!metrics || !Number.isInteger(metrics.beforeProtectedMinutes) || !Number.isInteger(metrics.afterProtectedMinutes) || !Number.isInteger(metrics.plannedDays) || !Number.isInteger(metrics.monthlyReclaimMinutes)) errors.push('INVALID_METRICS')
  else if ((metrics.plannedDays as number) < 1 || (metrics.plannedDays as number) > 31 || (metrics.monthlyReclaimMinutes as number) !== ((metrics.afterProtectedMinutes as number) - (metrics.beforeProtectedMinutes as number)) * (metrics.plannedDays as number)) errors.push('METRIC_MATH')
  const share = result.shareResult as Record<string, unknown> | undefined
  if (!share || typeof share.beforeMinutes !== 'number' || typeof share.afterMinutes !== 'number' || typeof share.monthlyHours !== 'number' || typeof share.leakLabel !== 'string') errors.push('INVALID_SHARE')
  const event = result.calendarEvent as Record<string, unknown> | null | undefined
  if (event !== null && (!event || typeof event.title !== 'string' || typeof event.start !== 'string' || typeof event.end !== 'string')) errors.push('INVALID_CALENDAR')
  return { valid: errors.length === 0, errors }
}

export async function runTimeLeakPipeline(input: PipelineInput, options: { model?: PipelineModel } = {}): Promise<PipelineExecution> {
  const stages: StageReceipt[] = []
  const normalized = stage('normalize_day', stages, () => normalizeInput(input))
  if (normalized.followUps.length) {
    stages.push({ stage: 'detect_leak', status: 'failed', latencyMs: 0, errorCode: 'FOLLOW_UP_REQUIRED' })
    return { result: limitedResult(input), repairedBlocks: [], stages, followUps: normalized.followUps, attempts: 0, errorCode: 'FOLLOW_UP_REQUIRED' }
  }

  if (options.model) {
    for (let attempts = 1; attempts <= 2; attempts += 1) {
      const candidate = await options.model.generate(input)
      const validation = validateAnalysisResult(candidate)
      if (validation.valid) {
        stages.push(
          { stage: 'detect_leak', status: 'passed', latencyMs: 0 },
          { stage: 'produce_repair', status: 'passed', latencyMs: 0 },
          { stage: 'judge', status: 'passed', latencyMs: 0 },
        )
        return { result: candidate as TimeLeakAnalysis, repairedBlocks: [], stages, followUps: [], attempts }
      }
    }
    stages.push(
      { stage: 'detect_leak', status: 'passed', latencyMs: 0 },
      { stage: 'produce_repair', status: 'failed', latencyMs: 0, errorCode: 'INVALID_AGENT_RESPONSE' },
      { stage: 'judge', status: 'failed', latencyMs: 0, errorCode: 'INVALID_AGENT_RESPONSE' },
    )
    return { result: limitedResult(input), repairedBlocks: [], stages, followUps: [], attempts: 2, errorCode: 'INVALID_AGENT_RESPONSE' }
  }

  const isMondayDemo = input.localDate === '2026-07-13'
    && input.sleepInterval.start === '23:00'
    && input.sleepInterval.end === '07:00'
    && input.scheduleBlocks.some((block) => block.title === 'Scrolling and undecided transition' && block.start === '20:10' && block.end === '21:00')
    && input.scheduleBlocks.some((block) => block.title === 'Unplanned small chores' && block.flexible)
    && input.scheduleBlocks.some((block) => block.title === 'Intentional leisure' && block.category === 'intentional_rest')
  if (!isMondayDemo) {
    stages.push(
      { stage: 'detect_leak', status: 'failed', latencyMs: 0, errorCode: 'RUNTIME_MODEL_REQUIRED' },
      { stage: 'produce_repair', status: 'failed', latencyMs: 0, errorCode: 'RUNTIME_MODEL_REQUIRED' },
      { stage: 'judge', status: 'failed', latencyMs: 0, errorCode: 'RUNTIME_MODEL_REQUIRED' },
    )
    return { result: limitedResult(input), repairedBlocks: [], stages, followUps: [], attempts: 0, errorCode: 'RUNTIME_MODEL_REQUIRED' }
  }

  stage('detect_leak', stages, () => 'fragmented_evening')
  const built = stage('produce_repair', stages, () => buildMondayRepair(input))
  const validation = stage('judge', stages, () => validateAnalysisResult(built.result))
  if (!validation.valid) return { result: limitedResult(input), repairedBlocks: [], stages, followUps: [], attempts: 1, errorCode: validation.errors[0] }
  return { result: built.result, repairedBlocks: built.repaired, stages, followUps: [], attempts: 1 }
}

export const MONDAY_PIPELINE_INPUT: PipelineInput = {
  timezone: 'Asia/Kolkata',
  localDate: '2026-07-13',
  sleepInterval: { start: '23:00', end: '07:00' },
  scheduleBlocks: [
    { start: '07:00', end: '08:00', title: 'Morning routine and breakfast', category: 'maintenance', flexible: false, source: 'demo' },
    { start: '08:00', end: '09:00', title: 'Commute', category: 'fixed', flexible: false, source: 'demo' },
    { start: '09:00', end: '18:00', title: 'Work', category: 'fixed', flexible: false, source: 'demo' },
    { start: '18:00', end: '19:00', title: 'Commute home', category: 'fixed', flexible: false, source: 'demo' },
    { start: '19:00', end: '20:10', title: 'Dinner and household responsibilities', category: 'maintenance', flexible: false, source: 'demo' },
    { start: '20:10', end: '21:00', title: 'Scrolling and undecided transition', category: 'unowned', flexible: true, source: 'demo' },
    { start: '21:00', end: '21:30', title: 'Unplanned small chores', category: 'maintenance', flexible: true, source: 'demo' },
    { start: '21:30', end: '22:30', title: 'Intentional leisure', category: 'intentional_rest', flexible: false, source: 'demo' },
    { start: '22:30', end: '23:00', title: 'Wind-down', category: 'protected', flexible: false, source: 'demo' },
  ],
  intentionalRestBlocks: [
    { start: '21:30', end: '22:30', title: 'Intentional leisure', category: 'intentional_rest', flexible: false, source: 'demo' },
  ],
  priority: 'Complete one module of a personal AI course',
  minimumUsefulMinutes: 60,
  plannedDays: 22,
}
