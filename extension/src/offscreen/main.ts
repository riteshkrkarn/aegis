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

function onModelProgress(info: ProgressPayload): void {
  if (modelReady) return

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

    // Never decrease — Transformers.js resets % per file.
    maxOverallPercent = Math.max(maxOverallPercent, Math.min(99, Math.max(0, raw)))
    // Stable label (no per-file name flicker). Filename is throttled away in emitProgress too.
    emitProgress(
      'model_download',
      `Downloading privacy model… ${maxOverallPercent}%`,
      maxOverallPercent,
    )
    return
  }

  if (info.status === 'initiate' || info.status === 'download') {
    emitProgress(
      'model_download',
      `Downloading privacy model… ${maxOverallPercent}%`,
      maxOverallPercent,
    )
    return
  }

  if (info.status === 'done') {
    maxOverallPercent = Math.max(maxOverallPercent, 95)
    emitProgress('model_download', `Downloading privacy model… ${maxOverallPercent}%`, maxOverallPercent)
  }
}

async function getModel(): Promise<[Processor, VisionModel]> {
  if (!modelReady) {
    emitProgress(
      'model_download',
      'Loading local privacy model (first run may take a minute)…',
      0,
    )
  }

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
    emitProgress('model_download', 'Privacy model ready', 100)
  }
  return pair
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as OffscreenFindPiiMessage
  if (msg?.type !== 'OFFSCREEN_FIND_PII') return false

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

console.info('[SIH Offscreen] VLM host ready')
