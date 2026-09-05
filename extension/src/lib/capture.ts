/**
 * Capture the visible tab as a PNG data URL for local VLM masking.
 */
export async function captureVisibleTab(windowId?: number): Promise<string> {
  const options: chrome.tabs.CaptureVisibleTabOptions = { format: 'png' }
  const dataUrl =
    typeof windowId === 'number'
      ? await chrome.tabs.captureVisibleTab(windowId, options)
      : await chrome.tabs.captureVisibleTab(options)
  if (!dataUrl) {
    throw new Error('Failed to capture visible tab')
  }
  return dataUrl
}
