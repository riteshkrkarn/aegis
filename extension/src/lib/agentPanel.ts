const TARGET_TAB_KEY = 'targetTabId'
const PANEL_BOUNDS_KEY = 'agentPanelBounds'
const POPUP_PAGE = 'src/popup/index.html'

/** Fixed extension UI size — never fullscreen / maximized. */
export const POPUP_WIDTH = 380
export const POPUP_HEIGHT = 600

type PanelBounds = { left: number; top: number }

/** Remember the page tab the toolbar action was opened from. */
export async function rememberSourceTab(sourceTab?: chrome.tabs.Tab): Promise<void> {
  if (sourceTab?.id && sourceTab.id >= 0 && !sourceTab.url?.startsWith('chrome-extension://')) {
    await chrome.storage.session.set({ [TARGET_TAB_KEY]: sourceTab.id })
  } else {
    // Icon clicked with no usable tab: clear stale binding so Run uses last-focused page.
    await chrome.storage.session.remove(TARGET_TAB_KEY)
  }
}

export async function getTargetTabId(): Promise<number | undefined> {
  const data = await chrome.storage.session.get(TARGET_TAB_KEY)
  const id = data[TARGET_TAB_KEY]
  return typeof id === 'number' ? id : undefined
}

async function getSavedBounds(): Promise<PanelBounds | undefined> {
  const data = await chrome.storage.local.get(PANEL_BOUNDS_KEY)
  const bounds = data[PANEL_BOUNDS_KEY] as PanelBounds | undefined
  if (
    bounds &&
    typeof bounds.left === 'number' &&
    typeof bounds.top === 'number' &&
    Number.isFinite(bounds.left) &&
    Number.isFinite(bounds.top)
  ) {
    return bounds
  }
  return undefined
}

/** Persist panel position so the next open restores where the user left it. */
export async function savePanelBounds(win?: chrome.windows.Window | null): Promise<void> {
  const current = win ?? (await chrome.windows.getCurrent())
  if (current.type !== 'popup') return
  if (typeof current.left !== 'number' || typeof current.top !== 'number') return
  await chrome.storage.local.set({
    [PANEL_BOUNDS_KEY]: { left: current.left, top: current.top } satisfies PanelBounds,
  })
}

async function findOpenPanelWindow(): Promise<chrome.windows.Window | undefined> {
  const url = chrome.runtime.getURL(POPUP_PAGE)
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })
  for (const win of windows) {
    const match = win.tabs?.some((t) => t.url === url || t.pendingUrl === url)
    if (match) return win
  }
  return undefined
}

/**
 * Open the agent UI as a detachable OS popup window (draggable via title bar),
 * or focus it if already open. Restores the last saved screen position.
 */
export async function openOrFocusAgentPanel(): Promise<void> {
  const existing = await findOpenPanelWindow()
  if (existing?.id != null) {
    await chrome.windows.update(existing.id, { focused: true })
    return
  }

  const bounds = await getSavedBounds()
  const createData: chrome.windows.CreateData = {
    url: chrome.runtime.getURL(POPUP_PAGE),
    type: 'popup',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    focused: true,
  }
  if (bounds) {
    createData.left = bounds.left
    createData.top = bounds.top
  }

  await chrome.windows.create(createData)
}

/**
 * If the UI was opened as a full tab or a large/maximized window, force it
 * back to the compact extension size. Keeps the user's chosen position.
 */
export async function ensureCompactPopupWindow(): Promise<void> {
  const tab = await chrome.tabs.getCurrent()
  if (!tab?.id) return

  const win = await chrome.windows.getCurrent()
  if (win.id == null) return

  // Detached extension window → keep compact size; save position.
  if (win.type === 'popup') {
    const tooWide = typeof win.width === 'number' && win.width > POPUP_WIDTH + 40
    const tooTall = typeof win.height === 'number' && win.height > POPUP_HEIGHT + 80
    if (win.state === 'maximized' || win.state === 'fullscreen' || tooWide || tooTall) {
      await chrome.windows.update(win.id, {
        state: 'normal',
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        focused: true,
      })
    }
    await savePanelBounds(win)
    return
  }

  // Opened as a normal browser tab → move into a compact popup and close the tab.
  if (win.type === 'normal') {
    const bounds = await getSavedBounds()
    const url = tab.url || chrome.runtime.getURL(POPUP_PAGE)
    const createData: chrome.windows.CreateData = {
      url,
      type: 'popup',
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      focused: true,
    }
    if (bounds) {
      createData.left = bounds.left
      createData.top = bounds.top
    }
    await chrome.windows.create(createData)
    await chrome.tabs.remove(tab.id)
  }
}
