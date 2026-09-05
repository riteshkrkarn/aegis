import { captureVisibleTab } from '../lib/capture'
import { maskPiiWithLocalVlm } from '../lib/mask'
import { runAgentOnServer } from '../lib/api'
import type { AgentAction, PipelineMessage } from '../lib/types'

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab')
  return tab
}

async function requestMarkdown(tabId: number): Promise<string> {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'GET_MARKDOWN',
  } satisfies PipelineMessage)) as { markdown?: string; error?: string }

  if (response?.error) throw new Error(response.error)
  if (!response?.markdown) throw new Error('Content script returned no markdown')
  return response.markdown
}

async function requestExecute(
  tabId: number,
  actions: AgentAction[],
): Promise<string[]> {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'EXECUTE_ACTIONS',
    actions,
  } satisfies PipelineMessage)) as { results?: string[]; error?: string }

  if (response?.error) throw new Error(response.error)
  return response.results ?? []
}

async function runTaskPipeline(task: string): Promise<{
  message: string
  actions: AgentAction[]
}> {
  const tab = await getActiveTab()
  const tabId = tab.id!

  const screenshot = await captureVisibleTab(tab.windowId)
  const markdown = await requestMarkdown(tabId)
  const masked = await maskPiiWithLocalVlm(screenshot, markdown)

  const serverResult = await runAgentOnServer({
    task,
    page_markdown: masked.maskedMarkdown,
    page_url: tab.url ?? '',
  })

  const results = await requestExecute(tabId, serverResult.actions)
  return {
    actions: serverResult.actions,
    message: `Mask=${masked.method}. Executed: ${results.join('; ') || 'none'}`,
  }
}

chrome.runtime.onMessage.addListener((message: PipelineMessage, _sender, sendResponse) => {
  if (message.type !== 'RUN_TASK') return false

  runTaskPipeline(message.task)
    .then((result) => {
      sendResponse({
        type: 'PIPELINE_RESULT',
        ok: true,
        message: result.message,
        actions: result.actions,
      } satisfies PipelineMessage)
    })
    .catch((err: unknown) => {
      sendResponse({
        type: 'PIPELINE_RESULT',
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      } satisfies PipelineMessage)
    })

  return true
})

console.info('[SIH Agent] background ready')
