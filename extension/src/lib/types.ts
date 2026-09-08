export type AgentActionType = 'click' | 'fill' | 'scroll' | 'navigate' | 'wait'

export type MaskMethod = 'placeholder' | 'transformers-js-vlm'

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
  step_index?: number
  prior_results?: string[]
  prior_reasoning?: string
  model_id?: string
  /** Final turn: model must return done + answer, no more actions. */
  force_answer?: boolean
  /** Pre-mask markdown for backend DEBUG terminal/file logger only. */
  debug_before_markdown?: string
  mask_method?: MaskMethod
}

export interface AgentRunResponse {
  actions: AgentAction[]
  reasoning?: string
  done?: boolean
  /** Plain-language result for the user when the goal is complete. */
  answer?: string
}

export interface PiiFinding {
  type: string
  value: string
}

export type PipelineStage =
  | 'capture'
  | 'markdown'
  | 'model_download'
  | 'mask'
  | 'server'
  | 'execute'
  | 'done'

export type OffscreenFindPiiMessage = {
  type: 'OFFSCREEN_FIND_PII'
  screenshotDataUrl: string
  pageMarkdown: string
}

export type OffscreenWarmMessage = {
  type: 'OFFSCREEN_WARM'
}

export type PipelineProgressMessage = {
  type: 'PIPELINE_PROGRESS'
  stage: PipelineStage
  label: string
  /** 0–100 when known (e.g. model download). */
  percent?: number
}

export type PipelineMessage =
  | { type: 'RUN_TASK'; task: string; modelId?: string }
  | { type: 'PING' }
  | { type: 'GET_MARKDOWN' }
  | { type: 'EXECUTE_ACTIONS'; actions: AgentAction[] }
  | {
      type: 'PIPELINE_RESULT'
      ok: boolean
      message: string
      actions?: AgentAction[]
      answer?: string
      maskMethod?: MaskMethod
    }
  | PipelineProgressMessage
  | OffscreenFindPiiMessage
  | OffscreenWarmMessage
