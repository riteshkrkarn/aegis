export type AgentActionType = 'click' | 'fill' | 'scroll' | 'navigate' | 'wait'

export interface AgentAction {
  action: AgentActionType
  selector?: string
  value?: string
  url?: string
  amount?: number
}

export interface AgentRunRequest {
  task: string
  page_markdown: string
  page_url: string
}

export interface AgentRunResponse {
  actions: AgentAction[]
  reasoning?: string
}

export type PipelineMessage =
  | { type: 'RUN_TASK'; task: string }
  | { type: 'GET_MARKDOWN' }
  | { type: 'EXECUTE_ACTIONS'; actions: AgentAction[] }
  | { type: 'PIPELINE_RESULT'; ok: boolean; message: string; actions?: AgentAction[] }
