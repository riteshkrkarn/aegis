/**
 * Demo / safety-net PII strings: used for markdown masking and to block
 * typing raw secrets into forms even if the planner somehow emits them.
 */

export type PiiCanaryType = 'name' | 'address' | 'email' | 'phone' | 'card' | 'password'

export const PII_CANARIES: Array<{ type: PiiCanaryType; value: string }> = [
  { type: 'address', value: 'Flat 12B, 14 MG Road, Bengaluru, Karnataka 560001' },
  { type: 'address', value: '14 MG Road, Bengaluru, Karnataka 560001' },
  { type: 'name', value: 'Priya Ananya Sharma' },
  { type: 'name', value: 'Rohan Sharma' },
  { type: 'email', value: 'priya.sharma+discharge@arogya-clinic.test' },
  { type: 'email', value: 'family.care@mail.test' },
  { type: 'phone', value: '+91 98765-43210' },
  { type: 'phone', value: '+91 99887-66554' },
  { type: 'phone', value: '(022) 4000-2199' },
  { type: 'card', value: '4111 1111 1111 1111' },
  { type: 'card', value: '5500-0000-0000-0004' },
  { type: 'card', value: '6011000990139424' },
  { type: 'password', value: 'WardAccess!992' },
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Flexible whitespace so DOM/markdown line breaks still match. */
function flexPattern(value: string): RegExp {
  const body = escapeRegExp(value).replace(/\s+/g, '\\s+')
  return new RegExp(body, 'gi')
}

export function redactCanariesInText(text: string): string {
  let masked = text
  const sorted = [...PII_CANARIES].sort((a, b) => b.value.length - a.value.length)
  for (const { type, value } of sorted) {
    masked = masked.replace(flexPattern(value), `[REDACTED_${type.toUpperCase()}]`)
  }
  return masked
}

/**
 * If a fill value is (or contains) raw demo PII, replace with redaction token(s).
 * Returns null when the whole value was blocked as raw PII.
 */
export function scrubFillValue(raw: string | undefined): {
  value: string
  blocked: boolean
  reason?: string
} {
  const value = (raw ?? '').trim()
  if (!value) return { value: '', blocked: false }

  for (const { type, value: canary } of PII_CANARIES) {
    const pattern = flexPattern(canary)
    if (pattern.test(value)) {
      // Reset lastIndex after test on global-ish patterns
      pattern.lastIndex = 0
      if (value.replace(/\s+/g, ' ').toLowerCase() === canary.replace(/\s+/g, ' ').toLowerCase()) {
        return {
          value: `[REDACTED_${type.toUpperCase()}]`,
          blocked: true,
          reason: `blocked raw ${type}; filled [REDACTED_${type.toUpperCase()}] instead`,
        }
      }
      return {
        value: value.replace(flexPattern(canary), `[REDACTED_${type.toUpperCase()}]`),
        blocked: true,
        reason: `scrubbed raw ${type} from fill value`,
      }
    }
  }

  return { value: raw ?? '', blocked: false }
}
