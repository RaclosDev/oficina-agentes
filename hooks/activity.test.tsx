import { expect, test } from 'claude-code/testing'

const FOCUSED = 'local_33333333-3333-3333-3333-333333333333'
const IDLE = 'local_44444444-4444-4444-4444-444444444444'

const SESSIONS = [
  { sessionId: FOCUSED, title: 'Arreglar login', cwd: 'C:/code/mi-proyecto', isRunning: true, pinned: true, lastActivityAt: '2026-01-01T10:00:00Z' },
  { sessionId: IDLE, title: 'Docs', cwd: 'C:/code/otra', isRunning: false, lastActivityAt: '2026-01-01T09:00:00Z', group: { name: 'Equipo' } },
]

const EVENTS: Record<string, string> = {
  [FOCUSED]: [
    'Session "Arreglar login" (working) — showing 3 of 9 messages',
    '[assistant] Voy a cambiar el formulario.',
    '[assistant] (called Edit)',
    '[assistant] (called mcp__ccd_turn__update_plan)',
  ].join('\n'),
  [IDLE]: [
    'Session "Docs" (idle) — showing 3 of 9 messages',
    '[assistant] (called Bash)',
    '[assistant] He actualizado el [README](https://x.test/readme) con la guía. Falta revisar el inglés.',
    '[result] done (success), 3 turns',
  ].join('\n'),
}

test('envía al servidor qué sesión está en pantalla, las fijadas y qué hace cada una', async ($, on) => {
  const posts: unknown[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'local_self' }))
  on('session.root', () => ({ value: 'C:/code/mi-proyecto' }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: { shownAt: 1 } }))
  on('http.fetch', (_, e) => {
    const { url, init } = e as { url: string; init?: { body?: string } }
    if (url.endsWith('/api/sessions') && init?.body) posts.push(JSON.parse(init.body))
    return { value: { ok: true, status: 200, headers: {}, text: '[]' } }
  })
  on('tool.call', (_, e) => {
    const { tool, session_id } = e as { tool: string; session_id?: string }
    if (tool.endsWith('list_sessions')) return { result: JSON.stringify(SESSIONS) }
    if (tool.endsWith('get_session')) return { result: JSON.stringify({ sessionId: 'local_self', title: 'Yo', cwd: 'C:/code/mi-proyecto' }) }
    if (tool.endsWith('get_window_layout'))
      return { result: JSON.stringify({ main_window: { panes: [{ session_id: FOCUSED, focused: true }] }, popout_windows: { sessions: [] } }) }
    if (tool.endsWith('list_events')) return { result: EVENTS[session_id ?? ''] ?? '' }
    return { result: 'ok' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // El refresco del arranque va sin await y encadena varias llamadas: se espera a su envío.
  for (let i = 0; i < 5000 && posts.length === 0; i++) await Promise.resolve()
  // …y a que termine lo que el refresco hace después de enviar.
  for (let i = 0; i < 500; i++) await Promise.resolve()

  expect(posts.length > 0).toBe(true)
  const desks = (posts.at(-1) as { desks: Record<string, unknown>[] }).desks
  const focused = desks.find(d => d.id === FOCUSED) ?? {}
  const idle = desks.find(d => d.id === IDLE) ?? {}

  expect(focused.onScreen).toBe(true)
  expect(focused.focused).toBe(true)
  expect(focused.pinned).toBe(true)
  // Trabajando: la última herramienta que dice algo (las internas de la app se saltan).
  expect(focused.activity).toEqual({ kind: 'tool', tool: 'Edit' })

  expect(idle.onScreen).toBe(false)
  expect(idle.group).toBe('Equipo')
  // En pausa: la primera frase de su último mensaje, sin enlaces markdown.
  expect(idle.activity).toEqual({ kind: 'text', text: 'He actualizado el README con la guía.' })
})
