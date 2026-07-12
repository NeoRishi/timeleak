import { runTimeLeakPipeline, type PipelineInput } from '../src/timeleakPipeline.js'

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

export default {
  async fetch(request) {
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

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>
