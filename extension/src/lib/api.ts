import type { AgentRunRequest, AgentRunResponse } from './types'
import { toUserFacingError } from './errors'

const DEFAULT_API_BASE = 'http://127.0.0.1:8001'

export function getApiBase(): string {
  return DEFAULT_API_BASE
}

export async function runAgentOnServer(
  payload: AgentRunRequest,
  apiBase: string = getApiBase(),
): Promise<AgentRunResponse> {
  let res: Response
  try {
    res = await fetch(`${apiBase}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    throw new Error(toUserFacingError(err))
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // ignore parse failures
    }
    throw new Error(
      detail || toUserFacingError(new Error(`Server error ${res.status}`)),
    )
  }

  return (await res.json()) as AgentRunResponse
}
