/**
 * Local PII masking via Transformers.js VLM (offscreen) + regex safety net.
 *
 * Approach A: VLM finds PII strings from screenshot + markdown; we redact
 * those strings in markdown before anything is sent to the server.
 */
import { ensureOffscreenDocument } from './offscreen'
import { emitProgress } from './progress'
import type { OffscreenFindPiiMessage, PiiFinding } from './types'

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  {
    name: 'card',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
  },
  {
    name: 'phone',
    pattern: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g,
  },
]

const VLM_TIMEOUT_MS = 180_000

export interface MaskResult {
  maskedMarkdown: string
  screenshotDataUrl: string
  method: 'placeholder' | 'transformers-js-vlm'
}

/** Apply placeholder PII redaction to markdown text. */
export function maskPiiInText(text: string): string {
  let masked = text
  for (const { name, pattern } of PII_PATTERNS) {
    masked = masked.replace(pattern, `[REDACTED_${name.toUpperCase()}]`)
  }
  masked = masked.replace(
    /(password|passwd|pwd)\s*[:=]\s*\S+/gi,
    '$1: [REDACTED_PASSWORD]',
  )
  return masked
}

/** Replace VLM-reported values in markdown (longest first). */
export function applyPiiFindings(text: string, findings: PiiFinding[]): string {
  let masked = text
  const sorted = [...findings].sort((a, b) => b.value.length - a.value.length)
  for (const { type, value } of sorted) {
    if (!value) continue
    const label = `[REDACTED_${type.toUpperCase().replace(/[^A-Z0-9]+/gi, '_')}]`
    masked = masked.split(value).join(label)
  }
  return masked
}

async function requestVlmFindings(
  screenshotDataUrl: string,
  pageMarkdown: string,
): Promise<PiiFinding[]> {
  emitProgress('model_download', 'Preparing local privacy model…')
  await ensureOffscreenDocument()

  const message: OffscreenFindPiiMessage = {
    type: 'OFFSCREEN_FIND_PII',
    screenshotDataUrl,
    pageMarkdown,
  }

  const send = () =>
    chrome.runtime.sendMessage(message) as Promise<{
      ok?: boolean
      findings?: PiiFinding[]
      error?: string
    }>

  // Offscreen may still be booting right after createDocument.
  let response: Awaited<ReturnType<typeof send>> | undefined
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      response = await Promise.race([
        send(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`VLM timed out after ${VLM_TIMEOUT_MS}ms`)),
            VLM_TIMEOUT_MS,
          )
        }),
      ])
      break
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
    }
  }

  if (!response) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Offscreen VLM did not respond')
  }

  if (!response.ok) {
    throw new Error(response.error || 'Offscreen VLM returned no findings')
  }
  return response.findings ?? []
}

/**
 * Mask PII given a screenshot + page markdown.
 * Uses Transformers.js VLM when available; always applies regex afterwards.
 * Pass useVlm=false on later agent turns to avoid capture/VLM thrashing.
 */
export async function maskPiiWithLocalVlm(
  screenshotDataUrl: string,
  pageMarkdown: string,
  options: { useVlm?: boolean } = {},
): Promise<MaskResult> {
  const useVlm = options.useVlm !== false
  let method: MaskResult['method'] = 'placeholder'
  let masked = pageMarkdown

  if (!useVlm || !screenshotDataUrl) {
    emitProgress('mask', 'Applying basic privacy mask…')
    return {
      maskedMarkdown: maskPiiInText(pageMarkdown),
      screenshotDataUrl,
      method: 'placeholder',
    }
  }

  try {
    const findings = await requestVlmFindings(screenshotDataUrl, pageMarkdown)
    emitProgress('mask', 'Applying privacy mask…')
    masked = applyPiiFindings(pageMarkdown, findings)
    method = 'transformers-js-vlm'
  } catch (err) {
    console.warn('[SIH Agent] VLM mask failed; using regex only', err)
    emitProgress('mask', 'Using basic privacy mask…')
  }

  return {
    maskedMarkdown: maskPiiInText(masked),
    screenshotDataUrl,
    method,
  }
}
