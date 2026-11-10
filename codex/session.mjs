import { posix, win32 } from 'node:path'

const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isCodexId(id) {
  return typeof id === 'string' && UUID.test(id)
}

export function isCodexEvent(event) {
  return EVENTS.has(event?.name) && isCodexId(event.id)
    && typeof event.project === 'string' && event.project.length <= 120
    && (event.turnId === undefined || isCodexId(event.turnId))
}

export function codexEvent(input) {
  const cwd = typeof input?.cwd === 'string' ? input.cwd : ''
  const path = /^[A-Za-z]:|^\\\\/.test(cwd) ? win32 : posix
  const event = {
    name: input?.hook_event_name,
    id: input?.session_id,
    project: path.basename(cwd).slice(0, 120),
    turnId: isCodexId(input?.turn_id) ? input.turn_id : undefined,
  }
  return isCodexEvent(event) ? event : null
}

export function codexLink(id) {
  return `codex://threads/${id}`
}

export function applyCodexEvent(sessions, event) {
  const { id, name, project, turnId } = event
  if (name === 'SessionEnd') return sessions.delete(id)

  const previous = sessions.get(id)
  const ending = name === 'Stop' || name === 'Interrupt'
  if (ending && turnId && previous?.turnId && turnId !== previous.turnId) return false
  if (name === 'SessionStart' && previous) return false

  const running = name === 'UserPromptSubmit'
  const desk = {
    id,
    provider: 'codex',
    title: `Codex · ${id.slice(-6)}`,
    project: project || previous?.desk.project || 'Codex',
    link: codexLink(id),
    isRunning: running,
    lastActivityAt: new Date().toISOString(),
  }
  sessions.set(id, { desk, turnId: running ? turnId : undefined })
  return true
}
