import type { AgentRunRequest, AgentRunResponse } from './types'

const DEFAULT_API_BASE = 'http://127.0.0.1:8000'

export function getApiBase(): string {
  return DEFAULT_API_BASE
}

export async function runAgentOnServer(
  payload: AgentRunRequest,
  apiBase: string = getApiBase(),
): Promise<AgentRunResponse> {
  const res = await fetch(`${apiBase}/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Server error ${res.status}: ${text}`)
  }

  return (await res.json()) as AgentRunResponse
}
