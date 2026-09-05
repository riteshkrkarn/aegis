import type { AgentAction } from './types'
import { buildSelector } from './domToMd'

function resolveElement(selector: string): Element | null {
  try {
    return document.querySelector(selector)
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
      el.focus()
      el.value = action.value ?? ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
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
  const nodes = document.querySelectorAll('a[href], button, input, textarea, select')
  return Array.from(nodes)
    .slice(0, limit)
    .map((el) => buildSelector(el))
}
