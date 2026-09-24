/**
 * Muscle Memory: a locally cached, PII-free "recipe" for a task the agent
 * has already completed successfully on this exact page shape before.
 *
 * Deliberate design constraint: a recipe NEVER stores a real value, and
 * never stores a token either (tokens are single-run random strings, so
 * an old one wouldn't resolve against a new observation anyway). A
 * sensitive fill step is stored as "use whatever token THIS selector
 * gets on the next observation" — which is exactly what the normal
 * per-step masking pass already produces on every run regardless of
 * caching. Replay reuses the existing privacy pipeline instead of
 * inventing a second path for sensitive data to travel through. This is
 * what keeps the efficiency pillar from undermining the privacy pillar.
 *
 * Stored in chrome.storage.local, scoped to this browser profile only.
 */
import type { AgentAction } from './types'

export type SkillStep =
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; value?: string; useCurrentToken?: boolean }
  | { action: 'scroll'; amount?: number }
  | { action: 'wait'; amount?: number }

export interface Skill {
  id: string
  domain: string
  taskSignature: string
  pageFingerprint: string
  steps: SkillStep[]
  createdAt: string
  lastUsedAt: string
  successCount: number
}

/**
 * Parse the "## Interactive elements" lines domToMd.ts emits back into a
 * {tag, type, name} shape for fingerprinting, without a second content-
 * script round trip. Tolerant of missing fields — this only needs to be
 * stable, not exhaustive.
 */
export function parseInteractiveShapeFromMarkdown(
  markdown: string,
): Array<{ tag: string; type: string; name: string }> {
  const rows: Array<{ tag: string; type: string; name: string }> = []
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('- ')) continue
    const parts = line.slice(2).split(' | ')
    const first = parts[0] || ''
    const tag = first.split('#')[0].trim()
    if (!tag) continue
    const type = parts.find((p) => p.startsWith('type='))?.slice(5) || ''
    const name = parts.find((p) => p.startsWith('name='))?.slice(5) || ''
    rows.push({ tag, type, name })
  }
  return rows
}

/** Every selector whose value line shows a minted [FIELD:...] token. */
export function extractSensitiveSelectorsFromMarkdown(markdown: string): Set<string> {
  const selectors = new Set<string>()
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('- ') || !/value=\[FIELD:/.test(line)) continue
    const match = line.match(/selector=(\S+)/)
    if (match) selectors.add(match[1])
  }
  return selectors
}

const STORAGE_KEY = 'sih_skill_memory_v1'
const MAX_SKILLS = 200

async function loadAll(): Promise<Record<string, Skill>> {
  const got = await chrome.storage.local.get(STORAGE_KEY)
  return (got[STORAGE_KEY] as Record<string, Skill>) || {}
}

async function saveAll(skills: Record<string, Skill>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: skills })
}

/** Cheap, deterministic hash — good enough for a fingerprint key, not crypto. */
function hashString(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/** Normalize a task string so close paraphrases still hit the same recipe. */
export function taskSignature(task: string): string {
  return task
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .sort()
    .join(' ')
}

/**
 * A structural fingerprint of the page: tag+type+name/aria of every
 * interactive element, WITHOUT values. Two observations of "the same"
 * form on different days should hash the same; two different pages
 * should almost never collide.
 */
export function fingerprintInteractiveElements(
  rows: Array<{ tag: string; type: string; name: string }>,
): string {
  const shape = rows
    .map((r) => `${r.tag}:${r.type}:${r.name}`)
    .sort()
    .join('|')
  return hashString(shape)
}

function skillKey(domain: string, task: string, fingerprint: string): string {
  return `${domain}::${taskSignature(task)}::${fingerprint}`
}

export async function findSkill(
  domain: string,
  task: string,
  fingerprint: string,
): Promise<Skill | null> {
  const all = await loadAll()
  return all[skillKey(domain, task, fingerprint)] ?? null
}

export async function saveSkill(
  domain: string,
  task: string,
  fingerprint: string,
  steps: SkillStep[],
): Promise<void> {
  const all = await loadAll()
  const key = skillKey(domain, task, fingerprint)
  const existing = all[key]
  all[key] = {
    id: key,
    domain,
    taskSignature: taskSignature(task),
    pageFingerprint: fingerprint,
    steps,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    successCount: (existing?.successCount ?? 0) + 1,
  }

  const keys = Object.keys(all)
  if (keys.length > MAX_SKILLS) {
    keys
      .sort((a, b) => new Date(all[a].lastUsedAt).getTime() - new Date(all[b].lastUsedAt).getTime())
      .slice(0, keys.length - MAX_SKILLS)
      .forEach((k) => delete all[k])
  }

  await saveAll(all)
}

/**
 * Convert a recorded action sequence into a storable, value-free recipe.
 * Returns null (skip caching this run) whenever a step can't be made
 * safely value-free — conservative on purpose.
 */
export function toSkillSteps(
  actions: AgentAction[],
  sensitiveSelectors: Set<string>,
): SkillStep[] | null {
  const steps: SkillStep[] = []
  for (const a of actions) {
    if (a.action === 'navigate') return null // don't cache across navigations
    if (a.action === 'click') {
      if (!a.selector) return null
      steps.push({ action: 'click', selector: a.selector })
    } else if (a.action === 'fill') {
      if (!a.selector) return null
      if (sensitiveSelectors.has(a.selector)) {
        steps.push({ action: 'fill', selector: a.selector, useCurrentToken: true })
      } else if (a.value && a.value.length <= 120 && !/\[FIELD:/i.test(a.value)) {
        // Only cache literal fill text when it's short, LLM-composed, and
        // provably not a token — e.g. a search query, not personal data.
        steps.push({ action: 'fill', selector: a.selector, value: a.value })
      } else {
        return null // be conservative: skip caching this run rather than guess
      }
    } else if (a.action === 'scroll') {
      steps.push({ action: 'scroll', amount: a.amount })
    } else if (a.action === 'wait') {
      steps.push({ action: 'wait', amount: a.amount })
    }
  }
  return steps
}

/** Turn cached steps back into real AgentActions right before replay. */
export function fromSkillSteps(
  steps: SkillStep[],
  getCurrentToken: (selector: string) => string | null,
): AgentAction[] {
  return steps.map((s): AgentAction => {
    if (s.action === 'fill' && s.useCurrentToken) {
      const token = getCurrentToken(s.selector)
      return { action: 'fill', selector: s.selector, value: token ?? '' }
    }
    return { ...s }
  })
}
