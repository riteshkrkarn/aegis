import { captureVisibleTab } from '../lib/capture'
import { maskPiiWithLocalVlm } from '../lib/mask'
import { runAgentOnServer } from '../lib/api'
import { ensureContentScript } from '../lib/contentBridge'
import { executeActionsSafely } from '../lib/execute'
import { toUserFacingError } from '../lib/errors'
import { buildPrivacyAudit, emitPrivacyAudit, emitProgress } from '../lib/progress'
import { getTargetTabId, openAgentPanel } from '../lib/agentPanel'
import type {
  AgentAction,
  MaskMethod,
  PipelineMessage,
  PipelineStage,
  PrivacyAudit,
} from '../lib/types'

const MAX_AGENT_STEPS = 8

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const storedId = await getTargetTabId()
  if (typeof storedId === 'number') {
    try {
      const tab = await chrome.tabs.get(storedId)
      if (tab?.id && !tab.url?.startsWith('chrome-extension://')) {
        // Keep it active in its own window so captureVisibleTab works.
        if (!tab.active) {
          await chrome.tabs.update(tab.id, { active: true })
        }
        return tab
      }
    } catch {
      // fall through
    }
  }

  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  })
  const ordered = [
    ...windows.filter((w) => w.focused),
    ...windows.filter((w) => !w.focused),
  ]
  for (const win of ordered) {
    const tab = win.tabs?.find((t) => t.active) ?? win.tabs?.[0]
    if (tab?.id && tab.url && !tab.url.startsWith('chrome-extension://')) {
      await chrome.storage.session.set({ targetTabId: tab.id })
      return tab
    }
  }

  throw new Error('No active tab')
}

async function requestMarkdown(tabId: number): Promise<string> {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'GET_MARKDOWN',
  } satisfies PipelineMessage)) as { markdown?: string; error?: string }

  if (response?.error) throw new Error(response.error)
  if (!response?.markdown) throw new Error('Content script returned no markdown')
  return response.markdown
}

async function observePage(
  tabId: number,
  windowId: number,
  step: number,
): Promise<{
  maskedMarkdown: string
  maskMethod: MaskMethod
  url: string
  privacyAudit: PrivacyAudit
}> {
  const tab = await chrome.tabs.get(tabId)

  // Always re-capture so each planning turn verifies the current viewport.
  // Full VLM only on first turn; later turns use screenshot + regex mask (faster).
  emitProgress(
    'capture',
    step === 0 ? 'Capturing the page…' : `Re-capturing page (verify step ${step + 1})…`,
  )
  const screenshot = await captureVisibleTab(windowId)

  emitProgress('markdown', 'Connecting to the page…')
  await ensureContentScript(tabId, tab.url)
  emitProgress('markdown', 'Reading page structure…')
  const markdown = await requestMarkdown(tabId)

  if (step === 0) {
    emitProgress('model_download', 'Preparing privacy model…')
  } else {
    emitProgress('mask', 'Refreshing privacy mask…')
  }

  const masked = await maskPiiWithLocalVlm(screenshot, markdown, {
    useVlm: step === 0,
  })
  emitProgress('mask', 'Privacy mask applied')

  const privacyAudit = buildPrivacyAudit({
    stepIndex: step,
    method: masked.method,
    beforeMarkdown: markdown,
    afterMarkdown: masked.maskedMarkdown,
  })
  emitPrivacyAudit(privacyAudit)

  return {
    maskedMarkdown: masked.maskedMarkdown,
    maskMethod: masked.method,
    url: tab.url ?? '',
    privacyAudit,
  }
}

async function runTaskPipeline(
  task: string,
  modelId?: string,
): Promise<{
  message: string
  actions: AgentAction[]
  answer?: string
  maskMethod: MaskMethod
  privacyAudit?: PrivacyAudit
}> {
  let stage: PipelineStage = 'capture'
  const tab = await getActiveTab()
  const tabId = tab.id!
  const windowId = tab.windowId

  const allActions: AgentAction[] = []
  const priorResults: string[] = []
  let priorReasoning = ''
  let lastMaskMethod: MaskMethod = 'placeholder'
  let lastPrivacyAudit: PrivacyAudit | undefined
  let finalAnswer = ''
  let pendingAnswer = ''

  try {
    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      const isLastPlan = step === MAX_AGENT_STEPS - 1
      stage = 'capture'
      emitProgress(
        'server',
        step === 0
          ? 'Understanding intent & observing…'
          : isLastPlan
            ? 'Final verify — writing answer…'
            : `Observe → verify → plan (step ${step + 1}/${MAX_AGENT_STEPS})…`,
      )

      const observed = await observePage(tabId, windowId, step)
      lastMaskMethod = observed.maskMethod
      lastPrivacyAudit = observed.privacyAudit

      stage = 'server'
      emitProgress(
        'server',
        isLastPlan
          ? 'Composing final answer…'
          : step === 0
            ? 'Planning first actions…'
            : `Verifying intent & planning (step ${step + 1})…`,
      )
      const serverResult = await runAgentOnServer({
        task,
        page_markdown: observed.maskedMarkdown,
        page_url: observed.url,
        step_index: step,
        prior_results: priorResults,
        prior_reasoning: priorReasoning,
        model_id: modelId,
        force_answer: isLastPlan,
      })

      priorReasoning = serverResult.reasoning || priorReasoning
      const turnAnswer = serverResult.answer?.trim() || ''
      if (turnAnswer) pendingAnswer = turnAnswer
      // Only keep a pending answer if this turn still claims success; otherwise
      // the verify pass rejected the previous claim.
      if (!serverResult.done) pendingAnswer = turnAnswer
      allActions.push(...(serverResult.actions || []))

      const hasActions = Boolean(serverResult.actions?.length)

      // Verified finish: done + answer + no further actions.
      if (serverResult.done && pendingAnswer && !hasActions) {
        finalAnswer = pendingAnswer
        break
      }

      if (!hasActions) {
        priorResults.push(
          serverResult.done
            ? 'done claimed without actions/answer — continue observe/verify'
            : 'no actions — continue observe/verify against intent',
        )
        continue
      }

      stage = 'execute'
      emitProgress(
        'execute',
        `Running ${serverResult.actions!.length} action(s) (step ${step + 1})…`,
      )
      const results = await executeActionsSafely(tabId, serverResult.actions!)
      priorResults.push(...results)
      priorResults.push(
        pendingAnswer
          ? `after actions: re-observe and VERIFY against intent before accepting any answer (tentative: ${pendingAnswer.slice(0, 160)})`
          : 'after actions: re-observe and VERIFY whether the page now matches user intent',
      )
      // Answer is unverified until a later turn confirms with done + no actions.
      if (!(serverResult.done && pendingAnswer)) {
        pendingAnswer = ''
      }

      await new Promise((r) => setTimeout(r, 700))
    }

    // Guaranteed final answer pass if the loop exited without a verified answer.
    if (!finalAnswer) {
      stage = 'capture'
      emitProgress('server', 'Final verify — writing answer…')
      const observed = await observePage(tabId, windowId, MAX_AGENT_STEPS)
      lastMaskMethod = observed.maskMethod
      lastPrivacyAudit = observed.privacyAudit
      stage = 'server'
      const serverResult = await runAgentOnServer({
        task,
        page_markdown: observed.maskedMarkdown,
        page_url: observed.url,
        step_index: MAX_AGENT_STEPS,
        prior_results: priorResults,
        prior_reasoning: priorReasoning,
        model_id: modelId,
        force_answer: true,
      })
      const turnAnswer = serverResult.answer?.trim() || ''
      finalAnswer = turnAnswer || pendingAnswer
    }

    return {
      actions: allActions,
      answer: finalAnswer || undefined,
      maskMethod: lastMaskMethod,
      privacyAudit: lastPrivacyAudit,
      message: finalAnswer
        ? finalAnswer
        : 'Task finished, but the model did not return a final text answer.',
    }
  } catch (err) {
    console.error(`[SIH Agent] failed at stage=${stage}`, err)
    const friendly = toUserFacingError(err, stage)
    throw new Error(
      friendly.includes('(step:') ? friendly : `${friendly} (step: ${stage})`,
    )
  }
}

chrome.action.onClicked.addListener((tab) => {
  void openAgentPanel(tab)
})

chrome.runtime.onMessage.addListener((message: PipelineMessage, _sender, sendResponse) => {
  if (message.type !== 'RUN_TASK') return false

  runTaskPipeline(message.task, message.modelId)
    .then((result) => {
      sendResponse({
        type: 'PIPELINE_RESULT',
        ok: true,
        message: result.message,
        actions: result.actions,
        answer: result.answer,
        maskMethod: result.maskMethod,
        privacyAudit: result.privacyAudit,
      } satisfies PipelineMessage)
    })
    .catch((err: unknown) => {
      console.error('[SIH Agent] pipeline failed', err)
      sendResponse({
        type: 'PIPELINE_RESULT',
        ok: false,
        message: err instanceof Error ? err.message : toUserFacingError(err),
      } satisfies PipelineMessage)
    })

  return true
})

console.info('[SIH Agent] background ready')
