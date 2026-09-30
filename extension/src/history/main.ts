import { clearSessions, listSessions, type AgentSession } from '../lib/sessionHistory'

const listEl = document.getElementById('list') as HTMLUListElement
const emptyEl = document.getElementById('empty') as HTMLParagraphElement
const clearBtn = document.getElementById('clear') as HTMLButtonElement
const closeBtn = document.getElementById('close') as HTMLButtonElement

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

function renderSession(session: AgentSession): HTMLLIElement {
  const li = document.createElement('li')
  li.className = 'session'

  const meta = document.createElement('div')
  meta.className = 'session-meta'
  meta.innerHTML = `
    <span>${formatTime(session.createdAt)}</span>
    <span class="badge ${session.ok ? 'ok' : 'fail'}">${session.ok ? 'ok' : 'failed'}</span>
    <span class="badge">${session.planner ?? 'server'}</span>
    <span class="badge">${session.maskMethod ?? 'mask?'}</span>
    <span>${session.actionCount} action(s)</span>
  `

  const task = document.createElement('p')
  task.className = 'task'
  task.textContent = session.task

  const answer = document.createElement('p')
  answer.className = 'answer'
  answer.textContent = session.finalAnswer || '(no answer)'

  li.append(meta, task, answer)

  if (session.steps?.length) {
    const ol = document.createElement('ol')
    ol.className = 'steps'
    for (const step of session.steps) {
      const item = document.createElement('li')
      item.textContent = `Step ${step.step}: ${step.note}`
      ol.appendChild(item)
    }
    li.appendChild(ol)
  }

  if (session.certificateHash) {
    const hash = document.createElement('p')
    hash.className = 'answer'
    hash.textContent = `Integrity: ${session.certificateHash.slice(0, 16)}…`
    li.appendChild(hash)
  }

  return li
}

async function refresh() {
  const sessions = await listSessions()
  listEl.replaceChildren()
  emptyEl.hidden = sessions.length > 0
  for (const session of sessions) {
    listEl.appendChild(renderSession(session))
  }
}

clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all session history?')) return
  await clearSessions()
  await refresh()
})

closeBtn.addEventListener('click', () => {
  window.close()
})

void refresh()
