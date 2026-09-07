/**
 * Convert a document into lightweight Markdown for the LLM.
 * Runs in the content-script context where `document` is available.
 */

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

  // Generic currency patterns inside the card
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

function extractVisibleText(doc: Document): string {
  const mainEl = doc.querySelector(
    'main, [role="main"], #main, #search, .s-main-slot, #centerCol, #dp-container',
  )
  const root = (mainEl as HTMLElement | null) || doc.body
  if (!root) return ''

  // Prefer innerText blocks with newlines so listings stay separable.
  const raw = root.innerText || root.textContent || ''
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
  const href = el.getAttribute('href')
  const text = cleanText(el.textContent, 80)

  // Surface current field values in markdown so local masking can redact them.
  // Never export password / hidden values (screenshot + password: regex cover those).
  let valueAttr: string | null = null
  if (tag === 'input' || tag === 'textarea') {
    const skipTypes = new Set(['password', 'hidden', 'file', 'submit', 'button', 'image', 'reset'])
    if (!skipTypes.has(type)) {
      const raw =
        tag === 'textarea'
          ? (el as HTMLTextAreaElement).value
          : (el as HTMLInputElement).value
      const clipped = cleanText(raw, 120)
      if (clipped) valueAttr = `value=${clipped}`
    }
  } else if (tag === 'select') {
    const sel = el as HTMLSelectElement
    const clipped = cleanText(sel.value || sel.options[sel.selectedIndex]?.text, 80)
    if (clipped) valueAttr = `value=${clipped}`
  }

  const selectorParts: string[] = []
  if (el.id) selectorParts.push(`#${CSS.escape(el.id)}`)
  else if (name) selectorParts.push(`${tag}[name="${name}"]`)
  else selectorParts.push(`${tag}:nth-of-type-hint(${index})`)

  const selector = selectorParts[0]
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

export function documentToMarkdown(doc: Document = document): string {
  const title = doc.title || 'Untitled'
  const url = doc.location?.href || ''
  const lines: string[] = [`# ${title}`, '', `URL: ${url}`, '']

  const products = extractProductCards(doc)
  if (products.length) {
    lines.push('## Product / result listings (title + price)', '')
    lines.push(
      'Use these rows as primary evidence for shopping or comparison tasks.',
    )
    lines.push('')
    lines.push(...products)
    lines.push('')
  }

  lines.push('## Visible text', '')
  const bodyText = extractVisibleText(doc)
  lines.push(bodyText || '_No visible text._')
  lines.push('', '## Interactive elements', '')

  const interactive = doc.querySelectorAll(
    'input, button, textarea, select, [role="button"], a[href], [onclick]',
  )

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

  return lines.join('\n')
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
