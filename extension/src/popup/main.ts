import type { PipelineMessage } from '../lib/types'

const taskEl = document.getElementById('task') as HTMLTextAreaElement
const runBtn = document.getElementById('run') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLPreElement

function setStatus(text: string, kind: 'ok' | 'error' | 'info' = 'info') {
  statusEl.textContent = text
  statusEl.classList.toggle('ok', kind === 'ok')
  statusEl.classList.toggle('error', kind === 'error')
}

runBtn.addEventListener('click', async () => {
  const task = taskEl.value.trim()
  if (!task) {
    setStatus('Enter a task first.', 'error')
    return
  }

  runBtn.disabled = true
  setStatus('Running pipeline…')

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'RUN_TASK',
      task,
    } satisfies PipelineMessage)) as Extract<PipelineMessage, { type: 'PIPELINE_RESULT' }>

    if (!response?.ok) {
      setStatus(response?.message || 'Pipeline failed', 'error')
      return
    }

    const actionSummary =
      response.actions?.map((a) => a.action + (a.selector ? `:${a.selector}` : '')).join(', ') ||
      'none'
    setStatus(`${response.message}\nActions: ${actionSummary}`, 'ok')
  } catch (err: unknown) {
    setStatus(err instanceof Error ? err.message : String(err), 'error')
  } finally {
    runBtn.disabled = false
  }
})
