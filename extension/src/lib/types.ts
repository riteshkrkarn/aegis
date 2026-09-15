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

/** One Two-Witness Actuation Guard check, logged for the integrity ledger. */
export interface WitnessLogEntry {
  selector: string
  ok: boolean
  reason?: string
}

/** A DOM-present-but-not-rendered node excluded before reaching the LLM. */
export interface HiddenNodeLog {
  reason: string
  snippet: string
  instructionLike: boolean
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

/** Optional second witness: ask the local VLM to read a cropped element. */
export type OffscreenReadCropMessage = {
  type: 'OFFSCREEN_READ_CROP'
  screenshotDataUrl: string
  rect: { x: number; y: number; width: number; height: number }
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
  | { type: 'CHECK_SKILL_MATCH'; selectors: string[] }
  | {
      type: 'PIPELINE_RESULT'
      ok: boolean
      message: string
      actions?: AgentAction[]
      answer?: string
      maskMethod?: MaskMethod
      certificate?: unknown
      certificateHash?: string
    }
  | PipelineProgressMessage
  | OffscreenFindPiiMessage
  | OffscreenWarmMessage
  | OffscreenReadCropMessage
