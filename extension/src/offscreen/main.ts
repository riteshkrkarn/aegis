/**
 * Offscreen document: runs SmolVLM via Transformers.js (WebGPU preferred).
 * Background asks for PII findings; screenshot never leaves the device.
 */
import {
  AutoModelForVision2Seq,
  AutoProcessor,
  env,
  load_image,
} from '@huggingface/transformers'
import { emitProgress } from '../lib/progress'
import type { OffscreenFindPiiMessage, PiiFinding } from '../lib/types'

env.allowLocalModels = false
env.useBrowserCache = true

const MODEL_ID = 'HuggingFaceTB/SmolVLM-256M-Instruct'
const MAX_MARKDOWN_CHARS = 2500
const MAX_NEW_TOKENS = 256
const KEEP_ALIVE_MS = 20_000

type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
type VisionModel = Awaited<ReturnType<typeof AutoModelForVision2Seq.from_pretrained>>
type ProgressPayload = {
  status?: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}

let processorPromise: Promise<Processor> | null = null
let modelPromise: Promise<VisionModel> | null = null
let modelReady = false
/** True once we observe a real network download (vs cache hydrate). */
let sawNetworkDownload = false

async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  try {
    const nav = navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown> }
    }
    const adapter = await nav.gpu?.requestAdapter()
    if (adapter) return 'webgpu'
  } catch {
    // fall through
  }
  return 'wasm'
}

const fileProgress = new Map<string, { loaded: number; total: number }>()
let maxOverallPercent = 0

function loadingLabel(percent: number): string {
  // Transformers.js emits the same progress events for cache hits and network fetches.
  const verb = sawNetworkDownload ? 'Downloading' : 'Loading'
  return `${verb} privacy model… ${percent}%`
}

function onModelProgress(info: ProgressPayload): void {
  if (modelReady) return

  if (info.status === 'download') {
    sawNetworkDownload = true
  }

  if (info.status === 'progress') {
    const file = info.file || 'model'
    const loaded = typeof info.loaded === 'number' ? info.loaded : 0
    const total =
      typeof info.total === 'number' && info.total > 0
        ? info.total
        : typeof info.progress === 'number' && info.progress > 0
          ? Math.round(loaded / (info.progress / 100))
          : 0

    if (total > 0) {
      fileProgress.set(file, { loaded, total })
    } else if (typeof info.progress === 'number') {
      // Fallback when totals are missing: treat reported % as this file only.
      fileProgress.set(file, {
        loaded: Math.round(info.progress),
        total: 100,
      })
    }

    let sumLoaded = 0
    let sumTotal = 0
    for (const part of fileProgress.values()) {
      sumLoaded += part.loaded
      sumTotal += part.total
    }

    const raw =
      sumTotal > 0
        ? Math.round((sumLoaded / sumTotal) * 100)
        : typeof info.progress === 'number'
          ? Math.round(info.progress)
          : 0

    // Never decrease  -  Transformers.js resets % per file.
    maxOverallPercent = Math.max(maxOverallPercent, Math.min(99, Math.max(0, raw)))
    emitProgress('model_download', loadingLabel(maxOverallPercent), maxOverallPercent)
    return
  }

  if (info.status === 'initiate' || info.status === 'download') {
    emitProgress('model_download', loadingLabel(maxOverallPercent), maxOverallPercent)
    return
  }

  if (info.status === 'done') {
    maxOverallPercent = Math.max(maxOverallPercent, 95)
    emitProgress('model_download', loadingLabel(maxOverallPercent), maxOverallPercent)
  }
}

async function getModel(): Promise<[Processor, VisionModel]> {
  if (modelReady && processorPromise && modelPromise) {
    return Promise.all([processorPromise, modelPromise])
  }

  emitProgress(
    'model_download',
    sawNetworkDownload || maxOverallPercent > 0
      ? loadingLabel(maxOverallPercent)
      : 'Loading privacy model (cached after first run)…',
    maxOverallPercent,
  )

  processorPromise ??= AutoProcessor.from_pretrained(MODEL_ID, {
    progress_callback: onModelProgress,
  })

  if (!modelPromise) {
    const device = await pickDevice()
    modelPromise = AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
      device,
      dtype: device === 'webgpu' ? 'fp32' : 'q8',
      progress_callback: onModelProgress,
    }).catch(async (err) => {
      console.warn('[SIH Offscreen] primary device failed, retrying wasm', err)
      emitProgress('model_download', 'Retrying privacy model on CPU…')
      return AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: onModelProgress,
      })
    })
  }

  const pair = await Promise.all([processorPromise, modelPromise])
  if (!modelReady) {
    modelReady = true
    emitProgress(
      'model_download',
      sawNetworkDownload ? 'Privacy model ready' : 'Privacy model ready (cached)',
      100,
    )
    void chrome.storage.session.set({ privacyModelReady: true })
  }
  return pair
}

/** Keep the offscreen document alive so the in-memory model is not dropped. */
function startKeepAlive(): void {
  window.setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => undefined)
  }, KEEP_ALIVE_MS)
}

function buildPrompt(pageMarkdown: string): string {
  const clipped =
    pageMarkdown.length > MAX_MARKDOWN_CHARS
      ? `${pageMarkdown.slice(0, MAX_MARKDOWN_CHARS)}\n…[truncated]`
      : pageMarkdown

  return [
    'Find personally identifiable information in this screenshot and page text.',
    'Include emails, phone numbers, credit/debit card numbers, passwords, full names, and postal addresses.',
    'Return ONLY a JSON array (no markdown fences, no commentary).',
    'Each item: {"type":"email|phone|card|password|name|address|other","value":"<exact string>"}',
    'If none, return [].',
    '',
    'Page text:',
    clipped,
  ].join('\n')
}

function parseFindings(raw: string): PiiFinding[] {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []

  try {
    const parsed: unknown = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []

    const out: PiiFinding[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const type = typeof rec.type === 'string' ? rec.type.trim() : ''
      const value = typeof rec.value === 'string' ? rec.value.trim() : ''
      if (!type || !value) continue
      out.push({ type, value })
    }
    return out
  } catch {
    return []
  }
}

async function findPii(
  screenshotDataUrl: string,
  pageMarkdown: string,
): Promise<PiiFinding[]> {
  const [processor, model] = await getModel()
  emitProgress('mask', 'Scanning page for sensitive data…')
  const image = await load_image(screenshotDataUrl)

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image', image: screenshotDataUrl },
        { type: 'text', text: buildPrompt(pageMarkdown) },
      ],
    },
  ]

  // SmolVLM multimodal chat templates accept structured content; typings are text-only.
  const text = processor.apply_chat_template(messages as never, {
    add_generation_prompt: true,
  })
  const inputs = await processor(text, [image], {})

  const output = (await model.generate({
    ...inputs,
    do_sample: false,
    max_new_tokens: MAX_NEW_TOKENS,
    return_dict_in_generate: true,
  })) as { sequences?: unknown } | unknown

  const sequences =
    output && typeof output === 'object' && 'sequences' in output && output.sequences
      ? output.sequences
      : output

  const decoded = processor.batch_decode(sequences as never, {
    skip_special_tokens: true,
  })

  const raw = decoded[0] ?? ''
  const assistantOnly = raw.includes('assistant')
    ? raw.slice(raw.lastIndexOf('assistant') + 'assistant'.length)
    : raw

  return parseFindings(assistantOnly || raw)
}

async function cropDataUrl(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('failed to decode screenshot for crop'))
    img.src = dataUrl
  })

  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable for crop')
  ctx.drawImage(img, rect.x, rect.y, width, height, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

/**
 * OPTIONAL second witness for the Two-Witness Actuation Guard: read just
 * the cropped element's pixels, independent of what the DOM claims. Off
 * by default in actions.ts (the structural check alone already defeats
 * TOCTOU-style attacks at zero model cost) — enable once that path is
 * confirmed working, for defence against label-spoofing / visual forgery
 * specifically. Reuses the same local model as PII detection, with a much
 * narrower prompt over a tiny crop, so the cost is small.
 */
async function readCrop(
  screenshotDataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const [processor, model] = await getModel()
  const cropped = await cropDataUrl(screenshotDataUrl, rect)
  const image = await load_image(cropped)

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image', image: cropped },
        {
          type: 'text',
          text: 'What text or label appears on this single UI element? Reply with just the text, nothing else.',
        },
      ],
    },
  ]

  const text = processor.apply_chat_template(messages as never, {
    add_generation_prompt: true,
  })
  const inputs = await processor(text, [image], {})
  const output = (await model.generate({
    ...inputs,
    do_sample: false,
    max_new_tokens: 32,
    return_dict_in_generate: true,
  })) as { sequences?: unknown } | unknown

  const sequences =
    output && typeof output === 'object' && 'sequences' in output && output.sequences
      ? output.sequences
      : output
  const decoded = processor.batch_decode(sequences as never, { skip_special_tokens: true })
  const raw = decoded[0] ?? ''
  const assistantOnly = raw.includes('assistant')
    ? raw.slice(raw.lastIndexOf('assistant') + 'assistant'.length)
    : raw
  return (assistantOnly || raw).trim()
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | null)?.type

  if (type === 'OFFSCREEN_WARM') {
    getModel()
      .then(() => sendResponse({ ok: true, ready: modelReady }))
      .catch((err: unknown) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return true
  }

  if (type === 'OFFSCREEN_READ_CROP') {
    const msg = message as { screenshotDataUrl: string; rect: { x: number; y: number; width: number; height: number } }
    readCrop(msg.screenshotDataUrl, msg.rect)
      .then((readText) => sendResponse({ ok: true, text: readText }))
      .catch((err: unknown) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      })
    return true
  }

  if (type !== 'OFFSCREEN_FIND_PII') return false

  const msg = message as OffscreenFindPiiMessage
  findPii(msg.screenshotDataUrl, msg.pageMarkdown)
    .then((findings) => {
      sendResponse({ ok: true, findings } satisfies {
        ok: true
        findings: PiiFinding[]
      })
    })
    .catch((err: unknown) => {
      console.error('[SIH Offscreen] VLM failed', err)
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    })

  return true
})

startKeepAlive()
console.info('[SIH Offscreen] VLM host ready')
