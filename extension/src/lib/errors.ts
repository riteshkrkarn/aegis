/** Map technical failures to short user-facing copy. */
export function toUserFacingError(err: unknown, stageHint?: string): string {
  const raw = (err instanceof Error ? err.message : String(err)).trim()
  if (!raw) return 'Something went wrong while running the task. Please try again.'

  const lower = raw.toLowerCase()
  const stepMatch = lower.match(/\(step:\s*([a-z_]+)\)/)
  const stage = (stageHint || stepMatch?.[1] || '').toLowerCase()

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('err_connection') ||
    lower.includes('net::err_')
  ) {
    return 'Cannot reach the local server. Make sure it is running on port 8001.'
  }

  // Page bridge failures (not model download)
  if (
    lower.includes('receiving end does not exist') ||
    lower.includes('could not establish connection') ||
    lower.includes('content script') ||
    lower.includes('cannot be scripted') ||
    lower.includes('cannot access') && lower.includes('page')
  ) {
    return 'Could not read this page. Refresh the tab, open a normal http(s) site, then try again.'
  }

  if (
    lower.includes('back/forward cache') ||
    lower.includes('bfcache') ||
    lower.includes('message channel is closed')
  ) {
    return 'The page navigated during actions. Retry  -  the agent will reattach after navigation.'
  }

  if (lower.includes('message port closed')) {
    return 'Lost connection mid-run. Keep the popup open and try again.'
  }

  if (lower.includes('no active tab')) {
    return 'No active tab found. Open a normal web page and try again.'
  }

  if (lower.includes('readback') || lower.includes('failed to capture tab')) {
    return 'Could not capture the tab (Chrome image readback). Keep the Amazon tab visible, close other overlays, and try again.'
  }

  if (
    lower.includes('vlm timed out') ||
    lower.includes('offscreen vlm') ||
    (lower.includes('privacy model') && !lower.includes('lost connection'))
  ) {
    return 'Local privacy model failed or timed out. Check your network for the first download, then retry.'
  }

  if (lower.includes('webgpu') || lower.includes('onnx') || lower.includes('huggingface')) {
    return 'Local privacy model failed to load. Check network access to Hugging Face, then retry.'
  }

  if (lower.includes('model') && (lower.includes('not found') || lower.includes('404'))) {
    return 'The configured language model is unavailable. Check GROQ_MODEL in backend/.env.'
  }

  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'The language model is rate-limited. Wait a moment and try again.'
  }

  if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401')) {
    return 'Language model API key is missing or invalid.'
  }

  const withoutStep = raw.replace(/\s*\(step:\s*[a-z_]+\)\s*$/i, '').trim()
  if (isCleanUserMessage(withoutStep)) {
    return stage && !withoutStep.includes('(step:')
      ? `${withoutStep} (step: ${stage})`
      : raw.includes('(step:')
        ? raw
        : withoutStep
  }

  if (lower.includes('502') || lower.includes('provider')) {
    return 'The planning server hit a provider error. Check backend logs and model settings.'
  }

  const snippet = raw.replace(/\s+/g, ' ').slice(0, 160)
  return `Task failed: ${snippet}`
}

function isCleanUserMessage(raw: string): boolean {
  if (raw.length > 220) return false
  if (raw.includes('{') || raw.includes('}')) return false
  if (raw.includes('<html') || raw.includes('Traceback')) return false
  if (/https?:\/\/\S+/i.test(raw) && raw.length > 120) return false
  return /[a-zA-Z]/.test(raw) && !raw.includes('Client error')
}
