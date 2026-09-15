/**
 * Local PII masking via Transformers.js VLM (offscreen) + regex safety net.
 *
 * Structured form FIELDS are now classified and tokenized at the source in
 * domToMd.ts (see piiClassifier.ts / secureTokens.ts) — that is more
 * accurate than pattern-matching flattened text, since it has type / name
 * / aria / autocomplete to work with. What's left for this file is
 * genuinely unstructured: free-standing page TEXT (an address printed on
 * a confirmation screen, not typed into any field) and a defence-in-depth
 * backstop in case a field's classification was missed. This is also
 * where India-specific identifiers (Aadhaar/PAN/UPI/IFSC/vehicle-reg) are
 * caught — the original list here only covered email/card/phone.
 */
import { ensureOffscreenDocument } from './offscreen'
import { emitProgress } from './progress'
import { redactCanariesInText } from './piiCanaries'
import { findIndiaPii } from './piiClassifier'
import type { OffscreenFindPiiMessage, PiiFinding } from './types'

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  {
    name: 'card',
    // 13–19 digit card numbers; ignore short currency amounts.
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
  },
]

/** Phone shapes used on the demo page + common US/IN forms (not card groups). */
const PHONE_PATTERNS: RegExp[] = [
  /\+\d{1,3}\s?\d{5}[\s-]\d{5}\b/g, // +91 99887-66554
  /\+\d{1,3}\s?\d{10}\b/g, // +919876543210
  /\(\d{2,4}\)[\s-]?\d{3,4}[\s-]\d{4}\b/g, // (022) 4000-2199
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, // 415-555-0198
  /\b[6-9]\d{4}[\s-]\d{5}\b/g, // 98765-43210
  /\b[6-9]\d{9}\b/g, // 9876543210
]

function looksLikeCurrencyAmount(value: string): boolean {
  return /^(?:₹|Rs\.?|INR|\$|€|£)?\s*[\d,]+(?:\.\d+)?$/i.test(value.trim())
}

const VLM_TIMEOUT_MS = 180_000

export interface MaskResult {
  maskedMarkdown: string
  screenshotDataUrl: string
  method: 'placeholder' | 'transformers-js-vlm'
}

/** Apply placeholder PII redaction to markdown text. */
export function maskPiiInText(text: string): string {
  // Names/addresses/demo canaries first (flexible whitespace).
  let masked = redactCanariesInText(text)
  for (const { name, pattern } of PII_PATTERNS) {
    masked = masked.replace(pattern, () => {
      return `[REDACTED_${name.toUpperCase()}]`
    })
  }
  for (const pattern of PHONE_PATTERNS) {
    // Reset lastIndex for global patterns reused across calls.
    pattern.lastIndex = 0
    masked = masked.replace(pattern, (match) => {
      if (looksLikeCurrencyAmount(match)) return match
      if (/^[\d,]+(?:\.\d+)?$/.test(match) && match.length <= 8) return match
      return '[REDACTED_PHONE]'
    })
  }
  masked = masked.replace(
    /(password|passwd|pwd)\s*[:=]\s*\S+/gi,
    '$1: [REDACTED_PASSWORD]',
  )
  // India-specific identifiers a generic email/card/phone list misses
  // entirely — Aadhaar (checksum-validated), PAN, IFSC, UPI, vehicle reg.
  for (const { category, value } of findIndiaPii(masked)) {
    masked = masked.split(value).join(`[REDACTED_${category.toUpperCase().replace(/-/g, '_')}]`)
  }
  // Second pass in case regex left adjacent canary fragments.
  return redactCanariesInText(masked)
}

/** Replace VLM-reported values in markdown (longest first). */
export function applyPiiFindings(text: string, findings: PiiFinding[]): string {
  let masked = text
  const sorted = [...findings].sort((a, b) => b.value.length - a.value.length)
  for (const { type, value } of sorted) {
    if (!value) continue
    if (looksLikeCurrencyAmount(value)) continue
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
