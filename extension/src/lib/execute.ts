import type { AgentAction } from './types'
import { ensureContentScript } from './contentBridge'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') {
      await sleep(350)
      return
    }
    await sleep(150)
  }
}

async function sendActions(
  tabId: number,
  actions: AgentAction[],
): Promise<string[]> {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'EXECUTE_ACTIONS',
    actions,
  })) as { results?: string[]; error?: string }

  if (response?.error) throw new Error(response.error)
  return response.results ?? []
}

/**
 * Execute actions one-by-one. Navigations are done from the background so the
 * content-script port is not killed mid-response (bfcache / page swap).
 */
export async function executeActionsSafely(
  tabId: number,
  actions: AgentAction[],
): Promise<string[]> {
  const results: string[] = []

  for (const action of actions) {
    const before = await chrome.tabs.get(tabId)
    const beforeUrl = before.url ?? ''

    if (action.action === 'navigate') {
      if (!action.url) throw new Error('navigate requires url')
      await chrome.tabs.update(tabId, { url: action.url })
      await waitForTabComplete(tabId)
      const tab = await chrome.tabs.get(tabId)
      await ensureContentScript(tabId, tab.url)
      results.push(`navigated to ${action.url}`)
      continue
    }

    await ensureContentScript(tabId, beforeUrl)
    const chunk = await sendActions(tabId, [action])
    results.push(...chunk)

    // Clicks/fills may trigger in-page navigation; reattach if the page swapped.
    if (action.action === 'click' || action.action === 'fill') {
      await sleep(400)
      try {
        const after = await chrome.tabs.get(tabId)
        if (after.status !== 'complete') {
          await waitForTabComplete(tabId)
        }
        if ((after.url ?? '') !== beforeUrl) {
          await ensureContentScript(tabId, after.url)
        } else {
          // SPA soft-nav / search submit: still refresh bridge.
          await ensureContentScript(tabId, after.url)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (
          msg.toLowerCase().includes('back/forward cache') ||
          msg.toLowerCase().includes('message channel is closed') ||
          msg.toLowerCase().includes('receiving end does not exist')
        ) {
          await waitForTabComplete(tabId)
          const tab = await chrome.tabs.get(tabId)
          await ensureContentScript(tabId, tab.url)
        } else {
          throw err
        }
      }
    }
  }

  return results
}
