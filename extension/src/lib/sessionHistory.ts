/**
 * Chatbot-style session history (post-MVP Phase 2).
 * Stores sanitized summaries only — never screenshots or raw PII markdown.
 */

export interface SessionStepSummary {
  step: number
  note: string
}

export interface AgentSession {
  id: string
  createdAt: number
  task: string
  finalAnswer?: string
  ok: boolean
  maskMethod?: string
  planner?: 'server' | 'local'
  actionCount: number
  steps: SessionStepSummary[]
  certificateHash?: string
}

const STORAGE_KEY = 'agentSessionHistory'
const MAX_SESSIONS = 40

function newId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function listSessions(): Promise<AgentSession[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const raw = stored[STORAGE_KEY]
  if (!Array.isArray(raw)) return []
  return raw as AgentSession[]
}

export async function saveSession(
  input: Omit<AgentSession, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): Promise<AgentSession> {
  const session: AgentSession = {
    id: input.id ?? newId(),
    createdAt: input.createdAt ?? Date.now(),
    task: input.task.slice(0, 500),
    finalAnswer: input.finalAnswer?.slice(0, 4000),
    ok: input.ok,
    maskMethod: input.maskMethod,
    planner: input.planner,
    actionCount: input.actionCount,
    steps: input.steps.slice(0, 24),
    certificateHash: input.certificateHash,
  }
  const existing = await listSessions()
  const next = [session, ...existing.filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS)
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return session
}

export async function clearSessions(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY)
}

export async function getSession(id: string): Promise<AgentSession | null> {
  const all = await listSessions()
  return all.find((s) => s.id === id) ?? null
}
