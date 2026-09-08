import type { AgentAction } from './types'
import { INTERACTIVE_SELECTOR, buildSelector } from './domToMd'
import { scrubFillValue } from './piiCanaries'

function isVisible(el: Element): boolean {
  const html = el as HTMLElement
  if (html.hidden) return false
  try {
    const style = window.getComputedStyle(html)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  } catch {
    // Detached node
  }
  return true
}

/**
 * Resolve an action selector. Supports:
 * - Normal CSS (id / name / aria-label / placeholder / …)
 * - Our markdown index hints: `button:nth-of-type-hint(12)` (not valid CSS)
 */
export function resolveElement(selector: string): Element | null {
  const trimmed = selector.trim()
  if (!trimmed) return null

  const hint = trimmed.match(/^([a-z0-9_-]+):nth-of-type-hint\((\d+)\)$/i)
  if (hint) {
    const index = Number(hint[2])
    const nodes = document.querySelectorAll(INTERACTIVE_SELECTOR)
    return nodes[index] ?? null
  }

  try {
    const matches = document.querySelectorAll(trimmed)
    if (!matches.length) return null
    for (const el of matches) {
      if (isVisible(el)) return el
    }
    return matches[0] ?? null
  } catch {
    return null
  }
}

export async function executeAction(action: AgentAction): Promise<string> {
  switch (action.action) {
    case 'click': {
      if (!action.selector) throw new Error('click requires selector')
      const el = resolveElement(action.selector)
      if (!el) throw new Error(`No element for selector: ${action.selector}`)
      ;(el as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' })
      ;(el as HTMLElement).click()
      return `clicked ${action.selector}`
    }
    case 'fill': {
      if (!action.selector) throw new Error('fill requires selector')
      const el = resolveElement(action.selector) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null
      if (!el) throw new Error(`No element for selector: ${action.selector}`)
      const scrubbed = scrubFillValue(action.value)
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      el.focus()
      el.value = scrubbed.value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      if (scrubbed.blocked) {
        return `fill blocked for ${action.selector}: ${scrubbed.reason}`
      }
      return `filled ${action.selector}`
    }
    case 'scroll': {
      window.scrollBy({ top: action.amount ?? 400, behavior: 'smooth' })
      return `scrolled ${action.amount ?? 400}px`
    }
    case 'navigate': {
      if (!action.url) throw new Error('navigate requires url')
      window.location.href = action.url
      return `navigating to ${action.url}`
    }
    case 'wait': {
      const ms = action.amount ?? 500
      await new Promise((r) => setTimeout(r, ms))
      return `waited ${ms}ms`
    }
    default:
      throw new Error(`Unknown action: ${(action as AgentAction).action}`)
  }
}

export async function executeActions(actions: AgentAction[]): Promise<string[]> {
  const results: string[] = []
  for (const action of actions) {
    results.push(await executeAction(action))
  }
  return results
}

/** Helper for debugging: list clickable selectors on the page. */
export function listActionableSelectors(limit = 20): string[] {
  const nodes = document.querySelectorAll(INTERACTIVE_SELECTOR)
  return Array.from(nodes)
    .slice(0, limit)
    .map((el) => buildSelector(el))
}
