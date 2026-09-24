import { documentToMarkdownDetailed } from '../lib/domToMd'
import { executeActions, verifySelectorsMatchPlan } from '../lib/actions'
import type { PipelineMessage } from '../lib/types'

chrome.runtime.onMessage.addListener((message: PipelineMessage, _sender, sendResponse) => {
  ;(async () => {
    try {
      if (message.type === 'PING') {
        sendResponse({ ok: true })
        return
      }
      if (message.type === 'GET_MARKDOWN') {
        const detailed = documentToMarkdownDetailed(document)
        sendResponse({
          markdown: detailed.markdown,
          tokensIssued: detailed.tokensIssued,
          hiddenNodesFiltered: detailed.hiddenNodesFiltered,
        })
        return
      }
      if (message.type === 'EXECUTE_ACTIONS') {
        const outcome = await executeActions(message.actions)
        sendResponse({ results: outcome.results, witnessChecks: outcome.witnessChecks })
        return
      }
      if (message.type === 'CHECK_SKILL_MATCH') {
        const checks = verifySelectorsMatchPlan(message.selectors)
        sendResponse({ checks })
        return
      }
    } catch (err: unknown) {
      sendResponse({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })()

  return true
})

console.info('[SIH Agent] content script ready')
