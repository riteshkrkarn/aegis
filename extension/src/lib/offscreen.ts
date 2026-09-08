const OFFSCREEN_PATH = 'src/offscreen/index.html'

let creating: Promise<void> | null = null

async function hasOffscreenDocument(): Promise<boolean> {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
    })
    return contexts.length > 0
  }
  return chrome.offscreen.hasDocument()
}

async function warmPrivacyModel(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_WARM' })
  } catch {
    // Offscreen may still be booting; FIND_PII will load on demand.
  }
}

/** Ensure the Transformers.js offscreen document exists (idempotent). */
export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return

  if (creating) {
    await creating
    return
  }

  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
      justification:
        'Run local Transformers.js VLM to mask PII before any server call',
    })
    .then(async () => {
      // Prefetch weights into memory so later Runs reuse the warm model.
      await warmPrivacyModel()
    })
    .finally(() => {
      creating = null
    })

  await creating
}
