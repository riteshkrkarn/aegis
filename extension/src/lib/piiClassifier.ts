/**
 * DOM-native PII / sensitive-field classifier.
 *
 * The previous approach asked a screenshot-reading VLM to *find* PII from
 * pixels. A browser agent has something a generic screen agent does not:
 * structured field metadata (type, name, aria-label, placeholder,
 * autocomplete). Those signals are more reliable than pixel inference and
 * almost free to compute, so we classify with them FIRST and only fall
 * back to the (expensive, imperfect) VLM / regex pass for free-form text
 * that has no structure to read.
 *
 * This module does not redact anything itself — see secureTokens.ts for
 * that. It only answers "is this field sensitive, and what kind".
 */

export type SensitiveCategory =
  | 'payment-card'
  | 'password'
  | 'otp'
  | 'phone'
  | 'email'
  | 'address'
  | 'name'
  | 'aadhaar'
  | 'pan'
  | 'upi'
  | 'passport'
  | 'ifsc'
  | 'bank-account'
  | 'vehicle-registration'
  | 'dob'
  | 'other-sensitive'

export interface FieldSignals {
  tag: string
  type?: string
  name?: string
  aria?: string
  placeholder?: string
  autocomplete?: string
  id?: string
}

export interface FieldClassification {
  category: SensitiveCategory
  /** Which signal decided it — useful for debugging / the integrity ledger. */
  matchedOn: 'autocomplete' | 'type' | 'keyword'
}

/**
 * WHATWG autocomplete tokens are a standardized, high-precision signal —
 * this is literally how browsers/password managers already classify
 * fields. We only need the last significant token.
 * https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
 */
const AUTOCOMPLETE_MAP: Record<string, SensitiveCategory> = {
  'cc-number': 'payment-card',
  'cc-csc': 'payment-card',
  'cc-exp': 'payment-card',
  'cc-exp-month': 'payment-card',
  'cc-exp-year': 'payment-card',
  'cc-name': 'payment-card',
  'current-password': 'password',
  'new-password': 'password',
  'one-time-code': 'otp',
  tel: 'phone',
  'tel-national': 'phone',
  'tel-country-code': 'phone',
  email: 'email',
  'postal-code': 'address',
  'street-address': 'address',
  'address-line1': 'address',
  'address-line2': 'address',
  'address-line3': 'address',
  'given-name': 'name',
  'family-name': 'name',
  name: 'name',
  bday: 'dob',
  'bday-day': 'dob',
  'bday-month': 'dob',
  'bday-year': 'dob',
}

const TYPE_MAP: Record<string, SensitiveCategory> = {
  password: 'password',
  email: 'email',
  tel: 'phone',
}

/**
 * Keyword patterns over name / id / aria-label / placeholder. Ordered
 * roughly most-specific-first so e.g. "aadhaar" wins before a generic
 * "number" match. Word-boundary-anchored to avoid matching inside
 * unrelated words (e.g. bare "pan" inside "company").
 */
const KEYWORD_PATTERNS: Array<{ category: SensitiveCategory; pattern: RegExp }> = [
  { category: 'aadhaar', pattern: /\b(aadhaar|aadhar|uidai)\b/i },
  { category: 'pan', pattern: /\bpan\s*(card|no|number)?\b/i },
  { category: 'upi', pattern: /\bupi\s*(id)?\b/i },
  { category: 'ifsc', pattern: /\bifsc\b/i },
  { category: 'passport', pattern: /\bpassport\b/i },
  { category: 'vehicle-registration', pattern: /\b(vehicle|rc)\s*(no|number|registration)\b/i },
  { category: 'bank-account', pattern: /\b(account|acc)\s*(no|number)\b/i },
  { category: 'payment-card', pattern: /\b(card\s*(no|number)|ccv|cvv|cvc)\b/i },
  { category: 'password', pattern: /\b(pass(word)?|pwd)\b/i },
  { category: 'otp', pattern: /\botp\b/i },
  { category: 'phone', pattern: /\b(phone|mobile|contact\s*no)\b/i },
  { category: 'email', pattern: /\be-?mail\b/i },
  { category: 'address', pattern: /\b(address|pincode|pin\s*code|zip)\b/i },
  { category: 'dob', pattern: /\b(dob|date\s*of\s*birth|birth\s*date)\b/i },
  { category: 'name', pattern: /\b(full\s*name|first\s*name|last\s*name|surname)\b/i },
]

function lastAutocompleteToken(autocomplete: string): string {
  const parts = autocomplete.trim().toLowerCase().split(/\s+/)
  return parts[parts.length - 1] || ''
}

export function classifyFieldBySignals(signals: FieldSignals): FieldClassification | null {
  if (signals.autocomplete) {
    const token = lastAutocompleteToken(signals.autocomplete)
    const hit = AUTOCOMPLETE_MAP[token]
    if (hit) return { category: hit, matchedOn: 'autocomplete' }
  }

  if (signals.type) {
    const hit = TYPE_MAP[signals.type.toLowerCase()]
    if (hit) return { category: hit, matchedOn: 'type' }
  }

  const haystack = [signals.name, signals.aria, signals.placeholder, signals.id]
    .filter(Boolean)
    .join(' ')
  if (haystack) {
    for (const { category, pattern } of KEYWORD_PATTERNS) {
      if (pattern.test(haystack)) return { category, matchedOn: 'keyword' }
    }
  }

  return null
}

// ---------------------------------------------------------------------
// India-specific value patterns (free-text fallback + defence in depth).
// A general regex list ("email/card/phone/password") misses almost every
// identifier an Indian government form actually uses. These are shape
// checks; Aadhaar additionally gets a real checksum validation so we
// don't flag every random 12-digit number (order IDs, tracking numbers).
// ---------------------------------------------------------------------

/**
 * Verhoeff checksum — the actual algorithm UIDAI uses for the Aadhaar
 * check digit. Implemented so Aadhaar detection is a validated match,
 * not a "12 digits in a row" guess.
 */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

export function isValidVerhoeff(numString: string): boolean {
  const digits = numString.replace(/\D/g, '')
  if (!digits) return false
  let c = 0
  const reversed = digits.split('').reverse()
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]]
  }
  return c === 0
}

export interface IndiaPiiPattern {
  category: SensitiveCategory
  pattern: RegExp
  /** Optional extra validation beyond the shape match (e.g. checksum). */
  validate?: (match: string) => boolean
}

export const INDIA_PII_PATTERNS: IndiaPiiPattern[] = [
  {
    category: 'aadhaar',
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    validate: isValidVerhoeff,
  },
  {
    // 5 letters, 4 digits, 1 letter. 4th letter is a real holder-type code
    // (P=individual, C=company, H=HUF, F=firm, A=AOP, T=trust, ...).
    category: 'pan',
    pattern: /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g,
  },
  {
    // 4-letter bank code + literal '0' + 6-char branch code (RBI spec).
    category: 'ifsc',
    pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
  },
  {
    // username@psp-handle, no dot in the handle (unlike almost all email
    // domains) — the one thing that reliably tells a UPI ID apart from
    // an email address using the same "local@domain" shape.
    category: 'upi',
    pattern: /\b[\w.-]{2,64}@[a-z]{2,20}\b/gi,
    validate: (m) => !m.split('@')[1]?.includes('.'),
  },
  {
    category: 'vehicle-registration',
    pattern: /\b[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,2}[ -]?\d{4}\b/g,
  },
  {
    category: 'passport',
    pattern: /\b[A-Z]\d{7}\b/g,
  },
]

/** Scan free text (already known to be non-structured) for India-specific PII. */
export function findIndiaPii(text: string): Array<{ category: SensitiveCategory; value: string }> {
  const found: Array<{ category: SensitiveCategory; value: string }> = []
  for (const { category, pattern, validate } of INDIA_PII_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text))) {
      const value = m[0]
      if (!validate || validate(value)) found.push({ category, value })
      if (pattern.lastIndex === m.index) pattern.lastIndex++ // guard zero-width
    }
  }
  return found
}
