import type { AgentAction, WitnessLogEntry } from './types'
import { INTERACTIVE_SELECTOR, buildSelector } from './domToMd'
import { scrubFillValue } from './piiCanaries'
import { resolveTokens, getTokenForSelector, isBareToken } from './secureTokens'
import { verifyBeforeAction, isSensitiveAction, type WitnessResult } from './twoWitness'

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

export interface ActionOutcome {
  message: string
  witness?: WitnessLogEntry
}

/**
 * Two-Witness Actuation Guard, applied at the one place every action
 * actually fires. Only ENFORCED (can block) for actions judged
 * sensitive/irreversible by isSensitiveAction — ordinary clicks still get
 * checked (and logged for the integrity ledger) but are not blocked on a
 * mismatch, so normal SPA re-renders don't make the agent unusable.
 */
function checkWitness(selector: string, el: Element, labelText: string): {
  result: WitnessResult
  sensitive: boolean
} {
  const result = verifyBeforeAction(selector, el)
  const sensitive = isSensitiveAction(labelText)
  return { result, sensitive }
}

export async function executeAction(action: AgentAction): Promise<ActionOutcome> {
  switch (action.action) {
    case 'click': {
      if (!action.selector) throw new Error('click requires selector')
      const el = resolveElement(action.selector)
      if (!el) throw new Error(`No element for selector: ${action.selector}`)

      const labelText = (el.getAttribute('aria-label') || el.textContent || '').trim()
      const { result, sensitive } = checkWitness(action.selector, el, labelText)
      const witness: WitnessLogEntry = { selector: action.selector, ok: result.ok, reason: result.ok ? undefined : result.reason }

      if (sensitive && !result.ok) {
        return {
          message: `blocked click on "${labelText.slice(0, 40)}" (${action.selector}): ${result.reason}`,
          witness,
        }
      }

      ;(el as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' })
      ;(el as HTMLElement).click()
      return { message: `clicked ${action.selector}`, witness }
    }
    case 'fill': {
      if (!action.selector) throw new Error('fill requires selector')
      const el = resolveElement(action.selector) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null
      if (!el) throw new Error(`No element for selector: ${action.selector}`)

      const labelText = (el.getAttribute('aria-label') || el.getAttribute('name') || '').trim()
      const { result, sensitive } = checkWitness(action.selector, el, labelText)
      const witness: WitnessLogEntry = { selector: action.selector, ok: result.ok, reason: result.ok ? undefined : result.reason }

      if (sensitive && !result.ok) {
        return {
          message: `blocked fill on ${action.selector}: ${result.reason}`,
          witness,
        }
      }

      // Resolve any [FIELD:category#token] the planner is referencing back
      // to its real value NOW, at the last possible moment — this is the
      // only place a token ever becomes a real value again. A value that
      // WAS a token is already vouched for by our own minting (it came
      // from a real DOM field we classified), so it skips the raw-PII
      // safety net below — that net exists to catch the LLM inventing or
      // copying a secret itself, not to re-flag data our own pipeline
      // just verified and deliberately made available for this fill.
      const rawValue = action.value ?? ''
      const wasToken = isBareToken(rawValue)
      const resolved = resolveTokens(rawValue)
      const scrubbed = wasToken
        ? { value: resolved, blocked: false }
        : scrubFillValue(resolved)
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      el.focus()
      el.value = scrubbed.value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      if (scrubbed.blocked) {
        return { message: `fill blocked for ${action.selector}: ${scrubbed.reason}`, witness }
      }
      return { message: `filled ${action.selector}`, witness }
    }
    case 'scroll': {
      window.scrollBy({ top: action.amount ?? 400, behavior: 'smooth' })
      return { message: `scrolled ${action.amount ?? 400}px` }
    }
    case 'navigate': {
      if (!action.url) throw new Error('navigate requires url')
      window.location.href = action.url
      return { message: `navigating to ${action.url}` }
    }
    case 'wait': {
      const ms = action.amount ?? 500
      await new Promise((r) => setTimeout(r, ms))
      return { message: `waited ${ms}ms` }
    }
    default:
      throw new Error(`Unknown action: ${(action as AgentAction).action}`)
  }
}

export interface ExecuteActionsResult {
  results: string[]
  witnessChecks: WitnessLogEntry[]
}

export async function executeActions(actions: AgentAction[]): Promise<ExecuteActionsResult> {
  const results: string[] = []
  const witnessChecks: WitnessLogEntry[] = []
  for (const action of actions) {
    const outcome = await executeAction(action)
    results.push(outcome.message)
    if (outcome.witness) witnessChecks.push(outcome.witness)
  }
  return { results, witnessChecks }
}

/**
 * Used only for Muscle Memory replay: check every selector a cached
 * recipe references against the CURRENT page (same Two-Witness check
 * used before any live action), and hand back the fresh token minted
 * for each selector in THIS observation — a cached recipe never stores
 * a token itself (see skillMemory.ts), so replay always resolves
 * against whatever the normal masking pass just produced.
 */
export function verifySelectorsMatchPlan(
  selectors: string[],
): Array<WitnessLogEntry & { currentToken?: string }> {
  return selectors.map((selector) => {
    const el = resolveElement(selector)
    if (!el) return { selector, ok: false, reason: 'element not found on current page' }
    const result = verifyBeforeAction(selector, el)
    const currentToken = getTokenForSelector(selector) ?? undefined
    return {
      selector,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      currentToken,
    }
  })
}

/** Helper for debugging: list clickable selectors on the page. */
export function listActionableSelectors(limit = 20): string[] {
  const nodes = document.querySelectorAll(INTERACTIVE_SELECTOR)
  return Array.from(nodes)
    .slice(0, limit)
    .map((el) => buildSelector(el))
}
