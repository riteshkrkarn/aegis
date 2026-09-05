import { documentToMarkdown } from '../lib/domToMd'
import { executeActions } from '../lib/actions'
import type { PipelineMessage } from '../lib/types'

chrome.runtime.onMessage.addListener((message: PipelineMessage, _sender, sendResponse) => {
  ;(async () => {
    try {
      if (message.type === 'GET_MARKDOWN') {
        sendResponse({ markdown: documentToMarkdown(document) })
        return
      }
      if (message.type === 'EXECUTE_ACTIONS') {
        const results = await executeActions(message.actions)
        sendResponse({ results })
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
