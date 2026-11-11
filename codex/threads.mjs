import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { projectOfThread } from './projects.mjs'
import { codexLink, isCodexId } from './session.mjs'

function withCodex(onReady, onMessage, fallback, timeoutMs = 4000) {
  return new Promise(resolve => {
    const child = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const lines = createInterface({ input: child.stdout })
    const timeout = setTimeout(() => finish(undefined, 'Codex tardó demasiado en responder.'), timeoutMs)
    let finished = false

    function finish(result, message) {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      lines.close()
      child.kill()
      resolve(result ?? fallback(message))
    }

    function send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    child.on('error', error => finish(undefined, error.message))
    child.on('exit', () => finish())
    child.stdin.on('error', error => finish(undefined, error.message))
    lines.on('line', line => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.id === 1) {
        if (message.error) return finish(undefined, message.error.message)
        send({ method: 'initialized' })
        return onReady(send)
      }
      onMessage(message, send, finish)
    })
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'oficina-agentes', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      },
    })
  })
}

export function listCodexDesks() {
  let threads
  let projectsLoaded = false
  const projects = []
  const desks = () => Array.isArray(threads) ? threads.filter(isStoredThread).map(thread => toDesk(thread, projects)) : null
  return withCodex(send => {
    send({ id: 2, method: 'thread/list', params: { limit: 50, sortKey: 'updated_at', archived: false, useStateDbOnly: true } })
    send({ id: 3, method: 'project/list', params: {} })
  }, (message, send, finish) => {
    if (message.id === 2) {
      threads = message.result?.data
      if (!Array.isArray(threads) || projectsLoaded) finish()
    }
    if (message.id === 3) {
      const { data, nextCursor } = message.result ?? {}
      if (Array.isArray(data)) {
        for (const project of data) {
          const name = typeof project?.name === 'string' ? project.name.trim().slice(0, 120) : ''
          if (name && typeof project.id === 'string') {
            projects.push({ id: project.id, name, roots: Array.isArray(project.roots) ? project.roots : [] })
          }
        }
        if (nextCursor) return send({ id: 3, method: 'project/list', params: { cursor: nextCursor } })
      }
      projectsLoaded = true
      if (threads) finish()
    }
  }, desks)
}

export function manageCodexThread(threadId, action, isRunning) {
  if (!isCodexId(threadId) || (action !== 'archive' && action !== 'delete')) return Promise.resolve({ status: 'failed' })
  return withCodex(send => {
    send({ id: 2, method: 'thread/read', params: { threadId, includeTurns: false } })
  }, (message, send, finish) => {
    if (message.error) return finish({ status: 'failed', message: message.error.message })
    if (message.id === 2) {
      const thread = message.result?.thread
      if (!isStoredThread(thread) || thread.id !== threadId) return finish({ status: 'failed', message: 'Codex no pudo leer el chat.' })
      if (isRunning() || thread.status?.type === 'active') return finish({ status: 'busy' })
      send({ id: 3, method: `thread/${action}`, params: { threadId } })
    }
    if (message.id === 3) finish({ status: message.result ? 'ok' : 'failed' })
  }, message => ({ status: 'failed', message }), 15000)
}

function isStoredThread(thread) {
  return isCodexId(thread?.id) && !thread.parentThreadId && !thread.ephemeral
    && typeof thread.cwd === 'string' && Number.isFinite(thread.updatedAt)
    && Math.abs(thread.updatedAt) <= 8.64e12
}

function toDesk(thread, projects) {
  return {
    id: thread.id,
    provider: 'codex',
    title: typeof thread.name === 'string' ? thread.name.trim().slice(0, 160) || null : null,
    project: projectOfThread(thread, projects),
    link: codexLink(thread.id),
    isRunning: thread.status?.type === 'active',
    lastActivityAt: new Date(thread.updatedAt * 1000).toISOString(),
  }
}
