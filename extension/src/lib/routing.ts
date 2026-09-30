/**
 * Easy vs difficult routing (post-MVP Phase 3).
 * Light tasks plan on-device; heavy/agentic tasks go to FastAPI.
 */

export type TaskDifficulty = 'light' | 'heavy'

const HEAVY_HINTS =
  /\b(fill|form|payment|checkout|login|password|multi[- ]?step|navigate|search|find|compare|book|order|submit|sign\s*up|register)\b/i

const LIGHT_HINTS =
  /^(click|scroll|wait|press|tap)\b|\b(click|scroll)\s+(the\s+)?(submit|#|button|link)/i

/**
 * Classify whether planning can stay local.
 * Conservative: prefer heavy (server) when ambiguous.
 */
export function classifyTaskDifficulty(task: string, pageMarkdown: string): TaskDifficulty {
  const t = task.trim()
  if (!t) return 'heavy'

  // Multi-clause / long instructions → heavy
  if (t.length > 120 || (t.match(/\band\b/gi) || []).length >= 2) return 'heavy'
  if (HEAVY_HINTS.test(t) && !LIGHT_HINTS.test(t)) return 'heavy'

  // Single clear click/scroll with a selector present in markdown → light
  if (LIGHT_HINTS.test(t)) {
    const idMatch = t.match(/#([A-Za-z][\w-]*)/)
    if (idMatch && pageMarkdown.includes(`#${idMatch[1]}`)) return 'light'
    if (/\bscroll\b/i.test(t)) return 'light'
    if (/\bsubmit\b/i.test(t) && /selector=#submit|#submit\b/i.test(pageMarkdown)) return 'light'
    if (/\bclick\b/i.test(t) && /selector=#/i.test(pageMarkdown) && t.length < 80) return 'light'
  }

  // Short extract / read-only questions with no actuation verbs → light answer-only
  if (
    t.length < 90 &&
    /\b(what|who|which|how much|status|show|read|tell me)\b/i.test(t) &&
    !/\b(click|fill|type|navigate|submit|open)\b/i.test(t)
  ) {
    return 'light'
  }

  return 'heavy'
}
