import { captureVisibleTab } from '../lib/capture'
import { maskPiiWithLocalVlm } from '../lib/mask'
import { runAgentOnServer } from '../lib/api'
import { ensureContentScript } from '../lib/contentBridge'
import { executeActionsSafely } from '../lib/execute'
import { toUserFacingError } from '../lib/errors'
import { emitProgress } from '../lib/progress'
import {
  getTargetTabId,
  openOrFocusAgentPanel,
  rememberSourceTab,
  savePanelBounds,
} from '../lib/agentPanel'
import { IntegrityLedger } from '../lib/integrityLedger'
import {
  findSkill,
  saveSkill,
  toSkillSteps,
  fromSkillSteps,
  fingerprintInteractiveElements,
  parseInteractiveShapeFromMarkdown,
  extractSensitiveSelectorsFromMarkdown,
} from '../lib/skillMemory'
import type {
  AgentAction,
  HiddenNodeLog,
  MaskMethod,
  PipelineMessage,
  PipelineStage,
  WitnessLogEntry,
} from '../lib/types'

const MAX_AGENT_STEPS = 8

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  // Prefer the last-focused normal browser window's active tab.
  // Do NOT stick to a stale targetTabId from an earlier page - that
  // forces chrome.tabs.update(... active) and jumps back to the wrong tab.
  // windowTypes: ['normal'] excludes the agent panel popup even when it is focused.
  try {
    const last = await chrome.windows.getLastFocused({
      populate: true,
      windowTypes: ['normal'],
    })
    const tab = last.tabs?.find((t) => t.active) ?? last.tabs?.[0]
    if (tab?.id && tab.url && !tab.url.startsWith('chrome-extension://')) {
      await chrome.storage.session.set({ targetTabId: tab.id })
      return tab
    }
  } catch {
    // fall through
  }

  const storedId = await getTargetTabId()
  if (typeof storedId === 'number') {
    try {
      const tab = await chrome.tabs.get(storedId)
      if (tab?.id && !tab.url?.startsWith('chrome-extension://')) {
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
  for (const win of windows) {
    const tab = win.tabs?.find((t) => t.active) ?? win.tabs?.[0]
    if (tab?.id && tab.url && !tab.url.startsWith('chrome-extension://')) {
      await chrome.storage.session.set({ targetTabId: tab.id })
      return tab
    }
  }

  throw new Error('No active tab')
}

interface MarkdownResponse {
  markdown: string
  tokensIssued: number
  hiddenNodesFiltered: HiddenNodeLog[]
}

async function requestMarkdown(tabId: number): Promise<MarkdownResponse> {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'GET_MARKDOWN',
  } satisfies PipelineMessage)) as {
    markdown?: string
    tokensIssued?: number
    hiddenNodesFiltered?: HiddenNodeLog[]
    error?: string
  }

  if (response?.error) throw new Error(response.error)
  if (!response?.markdown) throw new Error('Content script returned no markdown')
  return {
    markdown: response.markdown,
    tokensIssued: response.tokensIssued ?? 0,
    hiddenNodesFiltered: response.hiddenNodesFiltered ?? [],
  }
}

/** Two-Witness pre-check: do the skill's recorded selectors still match THIS page? */
async function checkSkillStillMatches(
  tabId: number,
  selectors: string[],
): Promise<Array<WitnessLogEntry & { currentToken?: string }>> {
  if (!selectors.length) return []
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'CHECK_SKILL_MATCH',
    selectors,
  } satisfies PipelineMessage)) as {
    checks?: Array<WitnessLogEntry & { currentToken?: string }>
    error?: string
  }
  if (response?.error) return selectors.map((s) => ({ selector: s, ok: false, reason: response.error }))
  return response.checks ?? []
}

interface Observation {
  maskedMarkdown: string
  beforeMarkdown: string
  maskMethod: MaskMethod
  url: string
  tokensIssued: number
  hiddenNodesFiltered: HiddenNodeLog[]
}

async function observePage(tabId: number, windowId: number, step: number): Promise<Observation> {
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
  const md = await requestMarkdown(tabId)

  if (step === 0) {
    const warm = await chrome.storage.session.get('privacyModelReady')
    emitProgress(
      'model_download',
      warm.privacyModelReady ? 'Using cached privacy model…' : 'Preparing privacy model…',
    )
  } else {
    emitProgress('mask', 'Refreshing privacy mask…')
  }

  const masked = await maskPiiWithLocalVlm(screenshot, md.markdown, {
    useVlm: step === 0,
  })
  emitProgress('mask', 'Privacy mask applied')

  return {
    maskedMarkdown: masked.maskedMarkdown,
    beforeMarkdown: md.markdown,
    maskMethod: masked.method,
    url: tab.url ?? '',
    tokensIssued: md.tokensIssued,
    hiddenNodesFiltered: md.hiddenNodesFiltered,
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname || 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface PipelineResult {
  message: string
  actions: AgentAction[]
  answer?: string
  maskMethod: MaskMethod
  certificate?: unknown
  certificateHash?: string
}

async function runTaskPipeline(task: string, modelId?: string): Promise<PipelineResult> {
  let stage: PipelineStage = 'capture'
  const tab = await getActiveTab()
  const tabId = tab.id!
  const windowId = tab.windowId
  emitProgress('capture', `Working on: ${(tab.url || '').slice(0, 80)}`)

  const ledger = new IntegrityLedger(task)
  const allActions: AgentAction[] = []
  const priorResults: string[] = []
  const sensitiveSelectorsSeen = new Set<string>()
  let priorReasoning = ''
  let lastMaskMethod: MaskMethod = 'placeholder'
  let finalAnswer = ''
  let pendingAnswer = ''
  let usedSkillReplay = false

  try {
    // ---- Muscle Memory: try a verified, PII-free recipe before ever
    // calling the server LLM. Only ever short-circuits the multi-step
    // PLANNING loop below — the final answer still goes through one
    // normal (cheap) server confirmation pass, same as any other run.
    stage = 'capture'
    const firstObserved = await observePage(tabId, windowId, 0)
    lastMaskMethod = firstObserved.maskMethod
    for (const sel of extractSensitiveSelectorsFromMarkdown(firstObserved.beforeMarkdown)) {
      sensitiveSelectorsSeen.add(sel)
    }
    const domain = domainOf(firstObserved.url)
    const fingerprint = fingerprintInteractiveElements(
      parseInteractiveShapeFromMarkdown(firstObserved.beforeMarkdown),
    )
    const skill = await findSkill(domain, task, fingerprint)
    let step0AlreadyRecorded = false

    if (skill) {
      const selectors = skill.steps
        .map((s) => ('selector' in s ? s.selector : undefined))
        .filter((s): s is string => Boolean(s))
      const witnessChecks = await checkSkillStillMatches(tabId, selectors)
      const allMatch = witnessChecks.length > 0 && witnessChecks.every((w) => w.ok)
      step0AlreadyRecorded = true

      await ledger.recordStep({
        step: 0,
        beforeMarkdown: firstObserved.beforeMarkdown,
        afterMarkdown: firstObserved.maskedMarkdown,
        tokensIssued: firstObserved.tokensIssued,
        hiddenNodesFiltered: firstObserved.hiddenNodesFiltered,
        witnessChecks,
        skillReplayed: allMatch,
      })

      if (allMatch) {
        emitProgress('execute', 'Replaying a known recipe (no server call)…')
        const tokenBySelector = new Map(witnessChecks.map((w) => [w.selector, w.currentToken]))
        const replayActions = fromSkillSteps(
          skill.steps,
          (selector) => tokenBySelector.get(selector) ?? null,
        )
        const outcome = await executeActionsSafely(tabId, replayActions)
        allActions.push(...replayActions)
        priorResults.push(...outcome.results)
        priorResults.push('replayed from Muscle Memory  -  re-observe and verify before answering')
        usedSkillReplay = true
      }
    } else {
      await ledger.recordStep({
        step: 0,
        beforeMarkdown: firstObserved.beforeMarkdown,
        afterMarkdown: firstObserved.maskedMarkdown,
        tokensIssued: firstObserved.tokensIssued,
        hiddenNodesFiltered: firstObserved.hiddenNodesFiltered,
        witnessChecks: [],
        skillReplayed: false,
      })
    }

    // ---- Normal per-step observe -> plan -> execute loop, skipped
    // entirely when a skill replay above already produced actions.
    if (!usedSkillReplay) {
      for (let step = 0; step < MAX_AGENT_STEPS; step++) {
        const isLastPlan = step === MAX_AGENT_STEPS - 1
        stage = 'capture'
        emitProgress(
          'server',
          step === 0
            ? 'Understanding intent & observing…'
            : isLastPlan
              ? 'Final verify  -  writing answer…'
              : `Observe → verify → plan (step ${step + 1}/${MAX_AGENT_STEPS})…`,
        )

        const observed = step === 0 ? firstObserved : await observePage(tabId, windowId, step)
        lastMaskMethod = observed.maskMethod
        for (const sel of extractSensitiveSelectorsFromMarkdown(observed.beforeMarkdown)) {
          sensitiveSelectorsSeen.add(sel)
        }

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
          debug_before_markdown: observed.beforeMarkdown,
          mask_method: observed.maskMethod,
        })

        priorReasoning = serverResult.reasoning || priorReasoning
        const turnAnswer = serverResult.answer?.trim() || ''
        if (turnAnswer) pendingAnswer = turnAnswer
        if (!serverResult.done) pendingAnswer = turnAnswer
        allActions.push(...(serverResult.actions || []))

        const hasActions = Boolean(serverResult.actions?.length)

        if (serverResult.done && pendingAnswer && !hasActions) {
          finalAnswer = pendingAnswer
          break
        }

        if (!hasActions) {
          priorResults.push(
            serverResult.done
              ? 'done claimed without actions/answer  -  continue observe/verify'
              : 'no actions  -  continue observe/verify against intent',
          )
          if (step > 0 || !step0AlreadyRecorded) {
            await ledger.recordStep({
              step,
              beforeMarkdown: observed.beforeMarkdown,
              afterMarkdown: observed.maskedMarkdown,
              tokensIssued: observed.tokensIssued,
              hiddenNodesFiltered: observed.hiddenNodesFiltered,
              witnessChecks: [],
            })
          }
          continue
        }

        stage = 'execute'
        emitProgress(
          'execute',
          `Running ${serverResult.actions!.length} action(s) (step ${step + 1})…`,
        )
        const outcome = await executeActionsSafely(tabId, serverResult.actions!)
        priorResults.push(...outcome.results)
        priorResults.push(
          pendingAnswer
            ? `after actions: re-observe and VERIFY against intent before accepting any answer (tentative: ${pendingAnswer.slice(0, 160)})`
            : 'after actions: re-observe and VERIFY whether the page now matches user intent',
        )
        if (!(serverResult.done && pendingAnswer)) {
          pendingAnswer = ''
        }

        if (step > 0 || !step0AlreadyRecorded) {
          await ledger.recordStep({
            step,
            beforeMarkdown: observed.beforeMarkdown,
            afterMarkdown: observed.maskedMarkdown,
            tokensIssued: observed.tokensIssued,
            hiddenNodesFiltered: observed.hiddenNodesFiltered,
            witnessChecks: outcome.witnessChecks,
          })
        }

        await new Promise((r) => setTimeout(r, 700))
      }
    }

    // Guaranteed final answer pass — reused for BOTH the skill-replay
    // path and the normal loop, so a replay is confirmed the same way a
    // fresh plan would be, never trusted blindly.
    if (!finalAnswer) {
      stage = 'capture'
      emitProgress('server', 'Final verify  -  writing answer…')
      const observed = await observePage(tabId, windowId, MAX_AGENT_STEPS)
      lastMaskMethod = observed.maskMethod
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
        debug_before_markdown: observed.beforeMarkdown,
        mask_method: observed.maskMethod,
      })
      const turnAnswer = serverResult.answer?.trim() || ''
      finalAnswer = turnAnswer || pendingAnswer
      await ledger.recordStep({
        step: MAX_AGENT_STEPS,
        beforeMarkdown: observed.beforeMarkdown,
        afterMarkdown: observed.maskedMarkdown,
        tokensIssued: observed.tokensIssued,
        hiddenNodesFiltered: observed.hiddenNodesFiltered,
        witnessChecks: [],
      })
    }

    // Save what just worked as a new/updated recipe — but only a FRESH,
    // verified run, and only when every step can be made value-free.
    // A replayed run is never re-cached: it changes nothing, so there is
    // nothing new to learn from it.
    if (!usedSkillReplay && finalAnswer) {
      const steps = toSkillSteps(allActions, sensitiveSelectorsSeen)
      if (steps && steps.length) {
        const domain = domainOf(firstObserved.url)
        const fingerprint = fingerprintInteractiveElements(
          parseInteractiveShapeFromMarkdown(firstObserved.beforeMarkdown),
        )
        await saveSkill(domain, task, fingerprint, steps)
      }
    }

    const { certificate, sha256 } = await ledger.toSignedExport()

    return {
      actions: allActions,
      answer: finalAnswer || undefined,
      maskMethod: lastMaskMethod,
      message: finalAnswer
        ? finalAnswer
        : 'Task finished, but the model did not return a final text answer.',
      certificate,
      certificateHash: sha256,
    }
  } catch (err) {
    console.error(`[SIH Agent] failed at stage=${stage}`, err)
    const friendly = toUserFacingError(err, stage)
    throw new Error(friendly.includes('(step:') ? friendly : `${friendly} (step: ${stage})`)
  }
}

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
        certificate: result.certificate,
        certificateHash: result.certificateHash,
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

// Detached popup window (draggable) instead of the fixed toolbar popup.
chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    await rememberSourceTab(tab)
    await openOrFocusAgentPanel()
  })()
})

chrome.windows.onBoundsChanged.addListener((win) => {
  if (win.type !== 'popup') return
  void savePanelBounds(win)
})

console.info('[SIH Agent] background ready')
