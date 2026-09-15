/**
 * Strict visibility check used ONLY to decide what is excluded from the
 * markdown sent to the LLM — never to hide anything from the user's own
 * screen.
 *
 * The existing isVisible() (domToMd.ts / actions.ts) checks `hidden` /
 * display / visibility. A page can pass all of that and still not be
 * perceivable by a human: zero-size boxes, content pushed off-screen, or
 * text painted the same colour as its background. That gap is exactly
 * the surface "fine-print" prompt-injection attacks use — hidden
 * instructions crafted to steer the agent, not the user.
 *
 * This is a deterministic, code-level check (no model call), so it
 * can't itself be talked out of excluding something by adversarial page
 * content.
 */

export type HiddenReason = 'zero-size' | 'offscreen' | 'color-match' | 'zero-opacity'

export interface HiddenCheckResult {
  renderedInvisible: boolean
  reason?: HiddenReason
}

function colorsVisuallyMatch(a: string, b: string): boolean {
  const na = a.replace(/\s+/g, '')
  const nb = b.replace(/\s+/g, '')
  if (!na || !nb) return false
  if (na === 'rgba(0,0,0,0)' || na === 'transparent') return false
  return na === nb
}

/** True when a node is present in the DOM but not actually perceivable. */
export function isRenderedInvisible(el: Element): HiddenCheckResult {
  const html = el as HTMLElement
  let style: CSSStyleDeclaration
  try {
    style = window.getComputedStyle(html)
  } catch {
    return { renderedInvisible: false } // detached node — not our concern here
  }

  const opacity = parseFloat(style.opacity || '1')
  if (opacity === 0) return { renderedInvisible: true, reason: 'zero-opacity' }

  const rect = html.getBoundingClientRect()
  if (rect.width <= 1 || rect.height <= 1) {
    return { renderedInvisible: true, reason: 'zero-size' }
  }

  const docWidth = document.documentElement.clientWidth || window.innerWidth
  const docHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight)
  const farOffscreen =
    rect.right < -1000 || rect.bottom < -1000 || rect.left > docWidth + 1000 || rect.top > docHeight + 1000
  if (farOffscreen) return { renderedInvisible: true, reason: 'offscreen' }

  if (colorsVisuallyMatch(style.color, style.backgroundColor)) {
    return { renderedInvisible: true, reason: 'color-match' }
  }

  return { renderedInvisible: false }
}

/**
 * Cheap heuristic for text that reads like an instruction aimed at an
 * agent/model rather than page content aimed at a human. Used only to
 * flag + log for the integrity ledger — never as the sole reason to
 * drop content that IS actually visible.
 */
const INSTRUCTION_LIKE = [
  /\bignore\s+(the\s+)?(previous|above|prior)\s+instructions?\b/i,
  /\byou\s+are\s+(an?\s+)?(ai|agent|assistant|llm)\b/i,
  /\bsystem\s*:\s*/i,
  /\bdo\s+not\s+(tell|inform|alert)\s+the\s+user\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\bactual\s+task\s*:/i,
]

export function looksInstructionLike(text: string): boolean {
  return INSTRUCTION_LIKE.some((re) => re.test(text))
}

/** Only the text directly inside this element, not aggregated from descendants. */
function directText(el: Element): string {
  let text = ''
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent || ''
  }
  return text.replace(/\s+/g, ' ').trim()
}

export interface FilteredNode {
  reason: HiddenReason
  snippet: string
  instructionLike: boolean
}

/**
 * Walk a root looking for DOM-present-but-not-rendered text with
 * meaningful content. Returns what was excluded so the exclusion is
 * itself auditable (goes into the integrity ledger), not silent.
 */
export function findHiddenTextNodes(root: Element, limit = 25): FilteredNode[] {
  const found: FilteredNode[] = []
  const seen = new Set<string>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode() as Element | null
  while (node && found.length < limit) {
    const text = directText(node)
    if (text.length >= 8 && !seen.has(text)) {
      const check = isRenderedInvisible(node)
      if (check.renderedInvisible && check.reason) {
        seen.add(text)
        found.push({
          reason: check.reason,
          snippet: text.slice(0, 160),
          instructionLike: looksInstructionLike(text),
        })
      }
    }
    node = walker.nextNode() as Element | null
  }
  return found
}
