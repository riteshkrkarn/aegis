import type { PipelineMessage } from './types'

const RESTRICTED_URL =
  /^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-search|chrome-native):/i

function assertInjectableUrl(url: string | undefined): void {
  if (!url || RESTRICTED_URL.test(url)) {
    throw new Error(
      'This page cannot be controlled. Open a normal http(s) website and try again.',
    )
  }
}

/** Ping existing content script, or inject it (needed after extension reload). */
export async function ensureContentScript(
  tabId: number,
  tabUrl?: string,
): Promise<void> {
  assertInjectableUrl(tabUrl)

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' } satisfies PipelineMessage)
    return
  } catch {
    // Not injected yet (common right after Reload on chrome://extensions).
  }

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js
  if (!files?.length) {
    throw new Error('Content script is missing from the extension build.')
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Could not attach to this page (${msg}). Refresh the tab and try again.`,
    )
  }

  // Brief settle, then confirm the listener is alive.
  for (let i = 0; i < 5; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' } satisfies PipelineMessage)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 50 * (i + 1)))
    }
  }

  throw new Error(
    'Could not read this page. Refresh the tab, open a normal http(s) site, then try again.',
  )
}
