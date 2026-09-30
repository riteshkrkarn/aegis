/**
 * On-device planner for light tasks (Phase 3).
 * Uses the same Transformers.js VLM runtime only for masking elsewhere;
 * light planning here is deterministic over sanitized markdown so latency stays low.
 */
import type { AgentAction, AgentRunResponse } from './types'

function findSelector(markdown: string, prefer: RegExp): string | null {
  const rows = markdown.split('\n').filter((ln) => /selector=/i.test(ln))
  for (const row of rows) {
    if (!prefer.test(row)) continue
    const m = row.match(/selector=([^\s|]+)/i)
    if (m?.[1]) return m[1].trim()
  }
  // Fallback: first id selector in interactive list
  for (const row of rows) {
    const m = row.match(/selector=(#[A-Za-z][\w-]*)/i)
    if (m?.[1]) return m[1]
  }
  return null
}

function extractVisibleSnippet(markdown: string, maxLen = 400): string {
  const idx = markdown.toLowerCase().indexOf('## visible')
  const body = idx >= 0 ? markdown.slice(idx) : markdown
  return body.replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

/**
 * Plan light tasks entirely on-device from sanitized markdown + task text.
 */
export function planLightTaskLocally(
  task: string,
  pageMarkdown: string,
  pageUrl: string,
): AgentRunResponse {
  const lower = task.toLowerCase()
  const actions: AgentAction[] = []

  const idInTask = task.match(/#([A-Za-z][\w-]*)/)
  if (/\bscroll\b/.test(lower)) {
    const amount = /up/.test(lower) ? -400 : 400
    actions.push({ action: 'scroll', amount })
    return {
      actions,
      reasoning: 'local light planner: scroll',
      done: true,
      answer: `Scrolled the page (${amount}px) on ${pageUrl || 'current page'}.`,
    }
  }

  if (/\bclick\b|\bpress\b|\btap\b|\bsubmit\b/.test(lower)) {
    let selector: string | null = idInTask ? `#${idInTask[1]}` : null
    if (!selector && /\bsubmit\b/.test(lower)) {
      selector = findSelector(pageMarkdown, /submit|#submit/i) || '#submit'
    }
    if (!selector) {
      selector = findSelector(pageMarkdown, /button|submit|link/i)
    }
    if (selector) {
      actions.push({ action: 'click', selector })
      return {
        actions,
        reasoning: 'local light planner: click',
        done: true,
        answer: `Clicked ${selector}.`,
      }
    }
  }

  // Read-only / extract: answer from visible text without actions
  const snippet = extractVisibleSnippet(pageMarkdown)
  return {
    actions: [],
    reasoning: 'local light planner: extract from sanitized markdown',
    done: true,
    answer: snippet
      ? `From the current page: ${snippet}`
      : 'Could not extract a clear answer from the current page.',
  }
}
