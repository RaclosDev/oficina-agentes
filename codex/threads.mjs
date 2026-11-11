import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { posix, win32 } from 'node:path'
import { codexLink, isCodexId } from './session.mjs'

export function listCodexDesks() {
  return new Promise(resolve => {
    const child = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const lines = createInterface({ input: child.stdout })
    const timeout = setTimeout(() => finish(null), 4000)
    let finished = false

    function finish(desks) {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      lines.close()
      child.kill()
      resolve(desks)
    }

    function send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    child.on('error', () => finish(null))
    child.on('exit', () => finish(null))
    child.stdin.on('error', () => finish(null))
    lines.on('line', line => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.id === 1) {
        if (message.error) return finish(null)
        send({ method: 'initialized' })
        send({ id: 2, method: 'thread/list', params: { limit: 50, sortKey: 'updated_at', archived: false, useStateDbOnly: true } })
      }
      if (message.id === 2) {
        const threads = message.result?.data
        finish(Array.isArray(threads) ? threads.filter(isStoredThread).map(toDesk) : null)
      }
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'oficina-agentes', version: '0.1.0' } } })
  })
}

function isStoredThread(thread) {
  return isCodexId(thread?.id) && !thread.parentThreadId && !thread.ephemeral
    && typeof thread.cwd === 'string' && Number.isFinite(thread.updatedAt)
    && Math.abs(thread.updatedAt) <= 8.64e12
}

function toDesk(thread) {
  const path = /^[A-Za-z]:|^\\\\/.test(thread.cwd) ? win32 : posix
  return {
    id: thread.id,
    provider: 'codex',
    title: typeof thread.name === 'string' ? thread.name.trim().slice(0, 160) || null : null,
    project: path.basename(thread.cwd).slice(0, 120) || 'Codex',
    link: codexLink(thread.id),
    isRunning: thread.status?.type === 'active',
    lastActivityAt: new Date(thread.updatedAt * 1000).toISOString(),
  }
}
