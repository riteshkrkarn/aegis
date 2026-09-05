/**
 * Convert a document (or HTML string) into lightweight Markdown for the LLM.
 * Runs in the content-script context where `document` is available.
 */

function isVisible(el: Element): boolean {
  const html = el as HTMLElement
  if (html.hidden) return false
  const style = window.getComputedStyle(html)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return true
}

function describeInteractive(el: Element, index: number): string | null {
  if (!isVisible(el)) return null

  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const name = el.getAttribute('name')
  const type = el.getAttribute('type')
  const role = el.getAttribute('role')
  const aria = el.getAttribute('aria-label')
  const placeholder = el.getAttribute('placeholder')
  const href = el.getAttribute('href')
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)

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
  const lines: string[] = [
    `# ${title}`,
    '',
    `URL: ${url}`,
    '',
    '## Interactive elements',
    '',
  ]

  const interactive = doc.querySelectorAll(
    'a[href], button, input, textarea, select, [role="button"], [onclick]',
  )

  let count = 0
  interactive.forEach((el, index) => {
    const row = describeInteractive(el, index)
    if (row) {
      lines.push(row)
      count += 1
    }
  })

  if (count === 0) {
    lines.push('_No interactive elements found._')
  }

  lines.push('', '## Visible text (excerpt)', '')

  const bodyText = (doc.body?.innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)
  lines.push(bodyText || '_No visible text._')

  // Prefer stable selectors: rewrite nth hints using id/name when possible
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
