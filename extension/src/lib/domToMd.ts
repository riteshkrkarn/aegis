/**
 * Convert a document into lightweight Markdown for the LLM.
 * Runs in the content-script context where `document` is available.
 */
import { classifyFieldBySignals } from './piiClassifier'
import { mintToken, resetTokenStore, tokenCount } from './secureTokens'
import { findHiddenTextNodes, type FilteredNode } from './hiddenContentFilter'
import { recordPlanSignature, resetPlanSignatures } from './twoWitness'

/** Must stay in sync with resolveElement() in actions.ts (nth-of-type-hint indices). */
export const INTERACTIVE_SELECTOR =
  'input, button, textarea, select, [role="button"], a[href], [onclick]'

function isVisible(el: Element): boolean {
  const html = el as HTMLElement
  if (html.hidden) return false
  const style = window.getComputedStyle(html)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return true
}

function cleanText(value: string | null | undefined, max = 200): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Amazon (and similar) often keep the real price in .a-offscreen / aria text. */
function extractPrice(root: Element): string {
  const offscreen = root.querySelector(
    '.a-price .a-offscreen, .a-color-price, [data-a-color="price"] .a-offscreen',
  )
  const off = cleanText(offscreen?.textContent, 40)
  if (off) return off

  const symbol = cleanText(root.querySelector('.a-price-symbol')?.textContent, 4)
  const whole = cleanText(root.querySelector('.a-price-whole')?.textContent, 24).replace(/[.,]$/, '')
  const frac = cleanText(root.querySelector('.a-price-fraction')?.textContent, 8)
  if (whole) return `${symbol}${whole}${frac ? `.${frac}` : ''}`

  const blob = cleanText(root.textContent, 500)
  const match = blob.match(/(?:₹|Rs\.?|INR|\$|€|£)\s*[\d,]+(?:\.\d+)?/i)
  return match ? match[0] : ''
}

function extractProductCards(doc: Document): string[] {
  const cards = doc.querySelectorAll(
    [
      '[data-component-type="s-search-result"]',
      '.s-result-item[data-asin]:not([data-asin=""])',
      'div[data-asin]:not([data-asin=""])',
      '[data-testid="product-card"]',
      '.product-card',
      'li.product-item',
    ].join(', '),
  )

  const lines: string[] = []
  const seen = new Set<string>()
  const MAX_CARDS = 25

  for (let i = 0; i < cards.length && lines.length < MAX_CARDS; i++) {
    const card = cards[i]
    if (!isVisible(card)) continue

    const asin = card.getAttribute('data-asin') || ''
    const titleEl =
      card.querySelector('h2 a span') ||
      card.querySelector('h2 span') ||
      card.querySelector('h2') ||
      card.querySelector('[data-cy="title-recipe"]') ||
      card.querySelector('a.a-link-normal .a-text-normal') ||
      card.querySelector('a[href*="/dp/"]')
    const title = cleanText(titleEl?.textContent, 160)
    if (!title || title.length < 4) continue

    const price = extractPrice(card)
    const rating = cleanText(
      card.querySelector('.a-icon-alt, [aria-label*="out of 5"]')?.textContent,
      60,
    )
    const key = `${title}|${price}|${asin}`
    if (seen.has(key)) continue
    seen.add(key)

    const parts = [`${lines.length + 1}. ${title}`]
    if (price) parts.push(`price=${price}`)
    if (rating) parts.push(`rating=${rating}`)
    if (asin) parts.push(`asin=${asin}`)
    lines.push(parts.join(' | '))
  }

  return lines
}

/**
 * Strip any exact hidden-node snippets out of an already-assembled text
 * blob. Pragmatic post-hoc removal (string match on the captured
 * snippet) rather than a full text-node-level rewrite — good enough to
 * keep genuinely hidden "fine print" injection attempts out of what
 * reaches the LLM, while keeping .innerText's layout/whitespace handling
 * for everything else. (A v2 could filter at the text-node level during
 * extraction instead of after, to close the edge case where the same
 * string also appears legitimately elsewhere.)
 */
function stripHiddenSnippets(text: string, findings: FilteredNode[]): string {
  let out = text
  for (const f of findings) {
    if (f.snippet.length >= 8) out = out.split(f.snippet).join('')
  }
  return out
}

function extractVisibleText(doc: Document, hiddenFindings: FilteredNode[]): string {
  const mainEl = doc.querySelector(
    'main, [role="main"], #main, #search, .s-main-slot, #centerCol, #dp-container',
  )
  const root = (mainEl as HTMLElement | null) || doc.body
  if (!root) return ''

  // Detect DOM-present-but-not-rendered text (the "fine print injection"
  // surface) before assembling what the LLM will read.
  hiddenFindings.push(...findHiddenTextNodes(root))

  const raw = stripHiddenSnippets(root.innerText || root.textContent || '', hiddenFindings)
  return raw
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 220)
    .join('\n')
    .slice(0, 10000)
}

function describeInteractive(el: Element, index: number): string | null {
  if (!isVisible(el)) return null

  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const name = el.getAttribute('name')
  const type = (el.getAttribute('type') || '').toLowerCase()
  const role = el.getAttribute('role')
  const aria = el.getAttribute('aria-label')
  const placeholder = el.getAttribute('placeholder')
  const autocomplete = el.getAttribute('autocomplete') || undefined
  const href = el.getAttribute('href')
  const text = cleanText(el.textContent, 80)

  // Prefer real CSS; fall back to index hint (resolved in actions.ts, not querySelector).
  let selector: string
  if (el.id) selector = `#${CSS.escape(el.id)}`
  else if (name) selector = `${tag}[name="${CSS.escape(name)}"]`
  else if (aria) selector = `${tag}[aria-label="${CSS.escape(aria)}"]`
  else if (placeholder) selector = `${tag}[placeholder="${CSS.escape(placeholder)}"]`
  else selector = `${tag}:nth-of-type-hint(${index})`

  // Two-Witness Guard: remember what this element looked like right now,
  // so an action fired against this selector later can detect drift.
  recordPlanSignature(selector, el)

  // DOM-native classification FIRST (type/name/aria/placeholder/autocomplete)
  // — cheap, structural, and available before any pixel/VLM pass.
  const classification = classifyFieldBySignals({
    tag,
    type,
    name: name || undefined,
    aria: aria || undefined,
    placeholder: placeholder || undefined,
    autocomplete,
    id: el.id || undefined,
  })

  // Surface current field values in markdown so the planner can reason
  // about them. Never export password / hidden values. For anything else
  // classified sensitive, mint an "available but invisible" token instead
  // of the raw value — the LLM can still plan a fill against it, but the
  // real value never leaves this content script (see secureTokens.ts).
  let valueAttr: string | null = null
  if (tag === 'input' || tag === 'textarea') {
    const skipTypes = new Set(['password', 'hidden', 'file', 'submit', 'button', 'image', 'reset'])
    if (!skipTypes.has(type)) {
      const raw =
        tag === 'textarea'
          ? (el as HTMLTextAreaElement).value
          : (el as HTMLInputElement).value
      const clipped = cleanText(raw, 120)
      if (clipped) {
        valueAttr = classification
          ? `value=${mintToken(classification.category, clipped, selector)}`
          : `value=${clipped}`
      }
    }
  } else if (tag === 'select') {
    const sel = el as HTMLSelectElement
    const clipped = cleanText(sel.value || sel.options[sel.selectedIndex]?.text, 80)
    if (clipped) valueAttr = `value=${clipped}`
  }

  const meta = [
    tag + id,
    type ? `type=${type}` : null,
    role ? `role=${role}` : null,
    name ? `name=${name}` : null,
    aria ? `aria=${aria}` : null,
    placeholder ? `placeholder=${placeholder}` : null,
    valueAttr,
    href ? `href=${href}` : null,
    text ? `text="${text}"` : null,
    `selector=${selector}`,
  ]
    .filter(Boolean)
    .join(' | ')

  return `- ${meta}`
}

export interface MarkdownResult {
  markdown: string
  tokensIssued: number
  hiddenNodesFiltered: FilteredNode[]
}

export function documentToMarkdownDetailed(doc: Document = document): MarkdownResult {
  // Fresh observation invalidates prior tokens / plan-time signatures —
  // both are only ever meant to be trusted against THIS snapshot.
  resetTokenStore()
  resetPlanSignatures()
  const hiddenNodesFiltered: FilteredNode[] = []

  const title = doc.title || 'Untitled'
  const url = doc.location?.href || ''
  const lines: string[] = [`# ${title}`, '', `URL: ${url}`, '']

  const products = extractProductCards(doc)
  if (products.length) {
    lines.push('## Product / result listings (title + price)', '')
    lines.push('Use these rows as primary evidence for shopping or comparison tasks.')
    lines.push('')
    lines.push(...products)
    lines.push('')
  }

  lines.push('## Visible text', '')
  const bodyText = extractVisibleText(doc, hiddenNodesFiltered)
  lines.push(bodyText || '_No visible text._')
  lines.push('', '## Interactive elements', '')

  const interactive = doc.querySelectorAll(INTERACTIVE_SELECTOR)

  let count = 0
  const MAX_INTERACTIVE = 70
  for (let i = 0; i < interactive.length && count < MAX_INTERACTIVE; i++) {
    const el = interactive[i]
    const row = describeInteractive(el, i)
    if (row) {
      lines.push(row)
      count += 1
    }
  }

  if (count === 0) {
    lines.push('_No interactive elements found._')
  }

  return { markdown: lines.join('\n'), tokensIssued: tokenCount(), hiddenNodesFiltered }
}

/** Back-compat plain-string wrapper for any caller that only wants the text. */
export function documentToMarkdown(doc: Document = document): string {
  return documentToMarkdownDetailed(doc).markdown
}

/** Prefer id / name / aria when building a usable CSS selector for actions. */
export function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const name = el.getAttribute('name')
  const tag = el.tagName.toLowerCase()
  if (name) return `${tag}[name="${CSS.escape(name)}"]`
  const aria = el.getAttribute('aria-label')
  if (aria) return `${tag}[aria-label="${CSS.escape(aria)}"]`
  return tag
}
