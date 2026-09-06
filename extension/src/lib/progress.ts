import type { PipelineProgressMessage, PipelineStage } from './types'

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
