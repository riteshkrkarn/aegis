const TARGET_TAB_KEY = 'targetTabId'
const POPUP_PAGE = 'src/popup/index.html'

/** Fixed extension UI size — never fullscreen / maximized. */
export const POPUP_WIDTH = 380
export const POPUP_HEIGHT = 600

/** Remember the page tab the toolbar popup was opened from. */
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

/**
 * If the UI was opened as a full tab or a large/maximized window, force it
 * back to the compact extension size. Toolbar action popups are left alone.
 */
export async function ensureCompactPopupWindow(): Promise<void> {
  // Action popups are not a real tab — already sized by CSS.
  const tab = await chrome.tabs.getCurrent()
  if (!tab?.id) return

  const win = await chrome.windows.getCurrent()
  if (win.id == null) return

  // Detached extension window (including leftover fullscreen panel) → shrink.
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
    return
  }

  // Opened as a normal browser tab → move into a compact popup and close the tab.
  if (win.type === 'normal') {
    const url = tab.url || chrome.runtime.getURL(POPUP_PAGE)
    await chrome.windows.create({
      url,
      type: 'popup',
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      focused: true,
    })
    await chrome.tabs.remove(tab.id)
  }
}
