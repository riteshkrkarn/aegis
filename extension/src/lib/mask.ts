/**
 * Local PII masking via Transformers.js VLM.
 *
 * MVP: placeholder regex/canvas-style masking so the pipeline works end-to-end
 * before a specific VLM checkpoint is wired. Replace `maskPiiPlaceholder`
 * with real Transformers.js inference when the model is chosen.
 */

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
  // Common password-field style tokens in markdown dumps
  masked = masked.replace(
    /(password|passwd|pwd)\s*[:=]\s*\S+/gi,
    '$1: [REDACTED_PASSWORD]',
  )
  return masked
}

/**
 * Mask PII given a screenshot (for future VLM) and page markdown.
 * Currently redacts markdown with patterns; screenshot is passed through.
 */
export async function maskPiiWithLocalVlm(
  screenshotDataUrl: string,
  pageMarkdown: string,
): Promise<MaskResult> {
  // TODO: load Transformers.js VLM and redact from screenshot + DOM context.
  // import { pipeline } from '@huggingface/transformers'
  void screenshotDataUrl
  return {
    maskedMarkdown: maskPiiInText(pageMarkdown),
    screenshotDataUrl,
    method: 'placeholder',
  }
}
