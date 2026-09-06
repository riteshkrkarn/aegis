/**
 * Capture the visible tab as a PNG data URL for local VLM masking.
 * Retries around Chrome's intermittent "image readback failed" errors.
 */
export async function captureVisibleTab(windowId?: number): Promise<string> {
  const options: chrome.tabs.CaptureVisibleTabOptions = { format: 'jpeg', quality: 70 }
  let lastError: unknown

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // Brief settle helps after navigations / popup focus changes.
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 200 * attempt))
      }
      const dataUrl =
        typeof windowId === 'number'
          ? await chrome.tabs.captureVisibleTab(windowId, options)
          : await chrome.tabs.captureVisibleTab(options)
      if (!dataUrl) throw new Error('Failed to capture visible tab')
      return dataUrl
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!/readback|capture/i.test(msg) && attempt === 0) break
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`Failed to capture tab: ${detail}`)
}
