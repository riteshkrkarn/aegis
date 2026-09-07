import type {
  PipelineProgressMessage,
  PipelineStage,
  PrivacyAudit,
  PrivacyAuditMessage,
} from './types'

/** Cap preview size so the agent panel stays responsive during demos. */
export const PRIVACY_AUDIT_PREVIEW_CHARS = 6_000

export function buildPrivacyAudit(input: {
  stepIndex: number
  method: PrivacyAudit['method']
  beforeMarkdown: string
  afterMarkdown: string
}): PrivacyAudit {
  const truncated =
    input.beforeMarkdown.length > PRIVACY_AUDIT_PREVIEW_CHARS ||
    input.afterMarkdown.length > PRIVACY_AUDIT_PREVIEW_CHARS

  const clip = (text: string) =>
    text.length > PRIVACY_AUDIT_PREVIEW_CHARS
      ? `${text.slice(0, PRIVACY_AUDIT_PREVIEW_CHARS)}\n…[truncated for demo panel]`
      : text

  return {
    stepIndex: input.stepIndex,
    method: input.method,
    beforeMarkdown: clip(input.beforeMarkdown),
    afterMarkdown: clip(input.afterMarkdown),
    beforeChars: input.beforeMarkdown.length,
    afterChars: input.afterMarkdown.length,
    truncated,
  }
}

/** Broadcast before/after mask payload to the agent panel (demo logger). */
export function emitPrivacyAudit(audit: PrivacyAudit): void {
  const payload: PrivacyAuditMessage = { type: 'PRIVACY_AUDIT', audit }
  void chrome.runtime.sendMessage(payload).catch(() => {
    // Popup may be closed; ignore.
  })
}


type Pending = {
  stage: PipelineStage
  label: string
  percent?: number
}

let pending: Pending | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastSentAt = 0
let lastKey = ''

const MIN_INTERVAL_MS = 450

function sendNow(message: Pending): void {
  const key = `${message.stage}|${message.label}|${message.percent ?? ''}`
  if (key === lastKey) return
  lastKey = key
  lastSentAt = Date.now()

  const payload: PipelineProgressMessage = {
    type: 'PIPELINE_PROGRESS',
    stage: message.stage,
    label: message.label,
    ...(typeof message.percent === 'number' ? { percent: message.percent } : {}),
  }
  void chrome.runtime.sendMessage(payload).catch(() => {
    // Popup may be closed; ignore.
  })
}

function flush(): void {
  flushTimer = null
  if (!pending) return
  const next = pending
  pending = null
  sendNow(next)
}

/**
 * Broadcast progress to the popup.
 * Download updates are throttled so the UI stays readable.
 */
export function emitProgress(
  stage: PipelineStage,
  label: string,
  percent?: number,
): void {
  const message: Pending = { stage, label, percent }

  // Non-download stages should feel snappy.
  if (stage !== 'model_download') {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
      pending = null
    }
    sendNow(message)
    return
  }

  pending = message
  const elapsed = Date.now() - lastSentAt
  if (elapsed >= MIN_INTERVAL_MS) {
    flush()
    return
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flush, MIN_INTERVAL_MS - elapsed)
  }
}
