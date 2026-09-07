import type { PipelineMessage, PipelineStage, PrivacyAudit } from '../lib/types'
import { toUserFacingError } from '../lib/errors'
import {
  DEFAULT_MODEL_ID,
  MODEL_OPTIONS,
  isModelChoiceId,
  normalizeModelChoiceId,
  type ModelChoiceId,
  type ModelOption,
} from '../lib/models'

const MODEL_STORAGE_KEY = 'plannerModelId'

const taskEl = document.getElementById('task') as HTMLTextAreaElement
const modelEl = document.getElementById('model') as HTMLSelectElement
const modelHintEl = document.getElementById('model-hint') as HTMLSpanElement
const runBtn = document.getElementById('run') as HTMLButtonElement
const closeBtn = document.getElementById('close') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLParagraphElement
const spinnerEl = document.getElementById('spinner') as HTMLElement
const progressLabelEl = document.getElementById('progress-label') as HTMLParagraphElement
const progressBarEl = document.getElementById('progress-bar') as HTMLElement
const privacyAuditEl = document.getElementById('privacy-audit') as HTMLElement
const privacyMetaEl = document.getElementById('privacy-meta') as HTMLParagraphElement
const privacyBeforeEl = document.getElementById('privacy-before') as HTMLElement
const privacyAfterEl = document.getElementById('privacy-after') as HTMLElement
const stepEls = Array.from(
  document.querySelectorAll<HTMLLIElement>('#progress-steps li[data-stage]'),
)

const STAGE_ORDER: PipelineStage[] = [
  'capture',
  'markdown',
  'model_download',
  'mask',
  'server',
  'execute',
  'done',
]

let running = false
let highestStageIdx = -1
let currentStage: PipelineStage | null = null
let maxDownloadPercent = 0

function setStatus(text: string, kind: 'ok' | 'error' | 'info' = 'info') {
  statusEl.textContent = text
  statusEl.classList.toggle('ok', kind === 'ok')
  statusEl.classList.toggle('error', kind === 'error')
}

function methodLabel(method: PrivacyAudit['method']): string {
  return method === 'transformers-js-vlm' ? 'VLM + regex' : 'regex only'
}

function renderPrivacyAudit(audit: PrivacyAudit) {
  privacyAuditEl.hidden = false
  const truncNote = audit.truncated ? ' · preview truncated' : ''
  privacyMetaEl.textContent = `Step ${audit.stepIndex} · Mask=${methodLabel(audit.method)} · ${audit.beforeChars} → ${audit.afterChars} chars${truncNote}`
  privacyBeforeEl.textContent = audit.beforeMarkdown || '(empty)'
  privacyAfterEl.textContent = audit.afterMarkdown || '(empty)'
}

function resetPrivacyAudit() {
  privacyAuditEl.hidden = true
  privacyMetaEl.textContent = 'Waiting for mask…'
  privacyBeforeEl.textContent = ''
  privacyAfterEl.textContent = ''
}

function setStepState(li: HTMLLIElement, state: string) {
  const stateEl = li.querySelector('.step-state')
  if (stateEl) stateEl.textContent = state
}

function resetSteps() {
  currentStage = null
  highestStageIdx = -1
  maxDownloadPercent = 0
  for (const li of stepEls) {
    li.classList.remove('active', 'done', 'failed')
    setStepState(li, 'Pending')
  }
  progressBarEl.className = 'bar-fill indeterminate'
  progressBarEl.style.width = ''
  progressLabelEl.textContent = 'Starting…'
  spinnerEl.hidden = false
}

function paintSteps(activeStage: PipelineStage, percent?: number) {
  const idx = STAGE_ORDER.indexOf(activeStage)
  for (const li of stepEls) {
    const stageName = li.dataset.stage as PipelineStage
    const stepIdx = STAGE_ORDER.indexOf(stageName)
    li.classList.remove('failed')

    if (activeStage === 'done' || idx > stepIdx) {
      li.classList.add('done')
      li.classList.remove('active')
      setStepState(li, 'Done')
    } else if (stageName === activeStage) {
      li.classList.add('active')
      li.classList.remove('done')
      const runningLabel =
        activeStage === 'model_download' && typeof percent === 'number'
          ? `${percent}%`
          : 'Running'
      setStepState(li, runningLabel)
    } else {
      li.classList.remove('active', 'done')
      setStepState(li, 'Pending')
    }
  }
}

function markStage(stage: PipelineStage, label: string, percent?: number) {
  const idx = STAGE_ORDER.indexOf(stage)

  let pct = percent
  if (stage === 'model_download' && typeof percent === 'number' && Number.isFinite(percent)) {
    maxDownloadPercent = Math.max(maxDownloadPercent, Math.round(percent))
    pct = maxDownloadPercent
  }

  // Agent loops re-observe: allow checklist to restart from earlier stages.
  if (idx < highestStageIdx && stage !== 'done') {
    if (
      stage === 'capture' ||
      stage === 'markdown' ||
      stage === 'mask' ||
      stage === 'server' ||
      stage === 'execute'
    ) {
      highestStageIdx = idx
    } else if (stage === 'model_download') {
      progressLabelEl.textContent = label
      if (typeof pct === 'number') {
        progressBarEl.className = 'bar-fill'
        progressBarEl.style.width = `${Math.max(4, Math.min(100, pct))}%`
        const active = stepEls.find((li) => li.dataset.stage === 'model_download')
        if (active) setStepState(active, `${pct}%`)
      }
      return
    } else {
      return
    }
  }

  highestStageIdx = Math.max(highestStageIdx, idx)
  currentStage = stage
  paintSteps(stage, pct)
  progressLabelEl.textContent = label
  spinnerEl.hidden = stage === 'done'

  if (typeof pct === 'number' && Number.isFinite(pct)) {
    progressBarEl.className = 'bar-fill'
    progressBarEl.style.width = `${Math.max(4, Math.min(100, pct))}%`
  } else if (stage === 'done') {
    progressBarEl.className = 'bar-fill'
    progressBarEl.style.width = '100%'
  } else {
    const approx = Math.max(12, Math.round(((idx + 1) / STAGE_ORDER.length) * 100))
    progressBarEl.className = 'bar-fill'
    progressBarEl.style.width = `${approx}%`
  }
}

function markFailed(stageHint?: string | null) {
  spinnerEl.hidden = true
  progressBarEl.className = 'bar-fill'
  progressLabelEl.textContent = 'Stopped with an error'

  let failed: PipelineStage | null = currentStage
  if (stageHint && STAGE_ORDER.includes(stageHint as PipelineStage)) {
    failed = stageHint as PipelineStage
  }
  if (!failed) return

  const idx = STAGE_ORDER.indexOf(failed)
  for (const li of stepEls) {
    const stageName = li.dataset.stage as PipelineStage
    const stepIdx = STAGE_ORDER.indexOf(stageName)
    li.classList.remove('active')
    if (stepIdx < idx) {
      li.classList.add('done')
      li.classList.remove('failed')
      setStepState(li, 'Done')
    } else if (stageName === failed) {
      li.classList.add('failed')
      li.classList.remove('done')
      setStepState(li, 'Failed')
    } else {
      li.classList.remove('done', 'failed')
      setStepState(li, 'Skipped')
    }
  }
}

function extractFailedStage(message: string): string | null {
  const match = message.match(/\(step:\s*([a-z_]+)\)/i)
  return match?.[1] ?? null
}

function updateModelHint() {
  const opt = MODEL_OPTIONS.find((o) => o.id === modelEl.value)
  modelHintEl.textContent = opt?.description ?? ''
}

function providerLabel(provider: ModelOption['provider']): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'groq') return 'Groq'
  return 'NVIDIA'
}

async function initModelSelect() {
  for (const opt of MODEL_OPTIONS) {
    const el = document.createElement('option')
    el.value = opt.id
    el.textContent = `${opt.label} · ${providerLabel(opt.provider)}`
    modelEl.appendChild(el)
  }

  const stored = await chrome.storage.local.get(MODEL_STORAGE_KEY)
  const raw = stored[MODEL_STORAGE_KEY]
  const migrated =
    typeof raw === 'string' ? normalizeModelChoiceId(raw) : null
  modelEl.value = migrated ?? DEFAULT_MODEL_ID
  if (migrated && migrated !== raw) {
    void chrome.storage.local.set({ [MODEL_STORAGE_KEY]: migrated })
  }
  updateModelHint()

  modelEl.addEventListener('change', () => {
    const id = modelEl.value as ModelChoiceId
    void chrome.storage.local.set({ [MODEL_STORAGE_KEY]: id })
    updateModelHint()
  })
}

chrome.runtime.onMessage.addListener((message: PipelineMessage) => {
  if (!running) return
  if (message.type === 'PIPELINE_PROGRESS') {
    markStage(message.stage, message.label, message.percent)
    return
  }
  if (message.type === 'PRIVACY_AUDIT') {
    renderPrivacyAudit(message.audit)
  }
})

closeBtn.addEventListener('click', () => {
  window.close()
})

runBtn.addEventListener('click', async () => {
  const task = taskEl.value.trim()
  if (!task) {
    setStatus('Enter a task first.', 'error')
    return
  }

  const modelId = isModelChoiceId(modelEl.value) ? modelEl.value : DEFAULT_MODEL_ID

  running = true
  runBtn.disabled = true
  modelEl.disabled = true
  setStatus(`Working with ${MODEL_OPTIONS.find((o) => o.id === modelId)?.label ?? modelId}…`)
  resetSteps()
  resetPrivacyAudit()
  // Immediate first paint so the user sees activity before background replies.
  markStage('capture', 'Capturing the page…')

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'RUN_TASK',
      task,
      modelId,
    } satisfies PipelineMessage)) as Extract<PipelineMessage, { type: 'PIPELINE_RESULT' }>

    if (!response?.ok) {
      const msg = toUserFacingError(response?.message || 'Pipeline failed')
      markFailed(extractFailedStage(response?.message || '') || extractFailedStage(msg))
      setStatus(msg, 'error')
      return
    }

    if (response.privacyAudit) {
      renderPrivacyAudit(response.privacyAudit)
    }

    markStage('done', 'All steps finished')
    const answer = response.answer?.trim() || response.message?.trim()
    const maskNote = response.maskMethod
      ? ` · Mask=${methodLabel(response.maskMethod)}`
      : ''
    setStatus(`${answer || 'Task completed.'}${maskNote}`, 'ok')
  } catch (err: unknown) {
    const msg = toUserFacingError(err)
    markFailed(extractFailedStage(msg))
    setStatus(msg, 'error')
  } finally {
    running = false
    runBtn.disabled = false
    modelEl.disabled = false
  }
})

void initModelSelect()
