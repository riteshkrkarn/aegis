const AGENT_PAGE = 'src/popup/index.html'
const AGENT_WINDOW_KEY = 'agentWindowId'
const TARGET_TAB_KEY = 'targetTabId'

async function getStoredWindowId(): Promise<number | undefined> {
  const data = await chrome.storage.session.get(AGENT_WINDOW_KEY)
  const id = data[AGENT_WINDOW_KEY]
  return typeof id === 'number' ? id : undefined
}

async function setStoredWindowId(id: number | undefined): Promise<void> {
  if (typeof id === 'number') {
    await chrome.storage.session.set({ [AGENT_WINDOW_KEY]: id })
  } else {
    await chrome.storage.session.remove(AGENT_WINDOW_KEY)
  }
}

/** Open or focus the persistent agent panel (survives blur / minimize better than action popup). */
export async function openAgentPanel(sourceTab?: chrome.tabs.Tab): Promise<void> {
  // Always re-bind to the tab where the user clicked the icon.
  if (sourceTab?.id && sourceTab.id >= 0 && !sourceTab.url?.startsWith('chrome-extension://')) {
    await chrome.storage.session.set({ [TARGET_TAB_KEY]: sourceTab.id })
  } else {
    // Icon clicked with no usable tab: clear stale binding so Run uses last-focused page.
    await chrome.storage.session.remove(TARGET_TAB_KEY)
  }

  const existingId = await getStoredWindowId()
  if (typeof existingId === 'number') {
    try {
      await chrome.windows.update(existingId, { focused: true, drawAttention: true })
      return
    } catch {
      await setStoredWindowId(undefined)
    }
  }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL(AGENT_PAGE),
    type: 'popup',
    width: 400,
    height: 680,
    focused: true,
  })

  if (created.id != null) {
    await setStoredWindowId(created.id)
  }
}

export async function getTargetTabId(): Promise<number | undefined> {
  const data = await chrome.storage.session.get(TARGET_TAB_KEY)
  const id = data[TARGET_TAB_KEY]
  return typeof id === 'number' ? id : undefined
}

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    const existingId = await getStoredWindowId()
    if (existingId === windowId) {
      await setStoredWindowId(undefined)
    }
  })()
})
