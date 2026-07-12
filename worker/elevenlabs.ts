import type { TimeLeakAnalysis } from '../src/timeleakPipeline.js'

const MAX_AUDIO_BYTES = 10_000_000

type Fetcher = typeof fetch

type ElevenLabsOptions = {
  apiKey: string
  fetcher?: Fetcher
}

type TextToSpeechOptions = ElevenLabsOptions & {
  voiceId: string
}

function assertConfigured(value: string, code: string) {
  if (!value.trim()) throw new Error(code)
}

function clockLabel(isoValue: string) {
  const clock = isoValue.slice(11, 16)
  const [rawHour, minute] = clock.split(':').map(Number)
  const suffix = rawHour >= 12 ? 'PM' : 'AM'
  return `${rawHour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function buildBriefingScript(result: TimeLeakAnalysis) {
  if (result.status !== 'pass' || !result.calendarEvent) throw new Error('JUDGE_APPROVED_RESULT_REQUIRED')
  const blockTime = `${clockLabel(result.calendarEvent.start)}–${clockLabel(result.calendarEvent.end)}`
  return [
    `Your TimeLeak is ${result.leak.label}.`,
    `Tomorrow, ${result.repair.instruction}`,
    `The protected ${blockTime} block is for ${result.calendarEvent.title}.`,
    `This is the smallest honest change: it preserves your sleep, essential responsibilities, meals, fixed commitments, and intentional rest.`,
    `You are not trying to redesign your whole day. You are protecting one feasible block for what matters, while leaving the responsibilities you already named intact.`,
  ].join(' ')
}

export async function createBriefingAudio(result: TimeLeakAnalysis, options: TextToSpeechOptions) {
  assertConfigured(options.apiKey, 'ELEVENLABS_API_KEY_MISSING')
  assertConfigured(options.voiceId, 'ELEVENLABS_VOICE_ID_MISSING')
  const response = await (options.fetcher || fetch)(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'xi-api-key': options.apiKey,
      },
      body: JSON.stringify({
        text: buildBriefingScript(result),
        model_id: 'eleven_multilingual_v2',
      }),
    },
  )
  if (!response.ok) throw new Error(`ELEVENLABS_TTS_FAILED_${response.status}`)
  return response
}

export async function transcribeScheduleAudio(audio: File, options: ElevenLabsOptions) {
  assertConfigured(options.apiKey, 'ELEVENLABS_API_KEY_MISSING')
  if (audio.size === 0) throw new Error('EMPTY_AUDIO')
  if (audio.size > MAX_AUDIO_BYTES) throw new Error('AUDIO_TOO_LARGE')
  const form = new FormData()
  form.set('file', audio, audio.name || 'schedule.webm')
  form.set('model_id', 'scribe_v2')
  form.set('tag_audio_events', 'false')
  form.set('diarize', 'false')
  const response = await (options.fetcher || fetch)('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': options.apiKey },
    body: form,
  })
  if (!response.ok) throw new Error(`ELEVENLABS_STT_FAILED_${response.status}`)
  const body = await response.json() as { text?: unknown; language_code?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) throw new Error('EMPTY_TRANSCRIPT')
  return {
    text,
    languageCode: typeof body.language_code === 'string' ? body.language_code : undefined,
  }
}
