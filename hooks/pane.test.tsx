import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'oficina-agentes',
  component: 'Pane',
  requestId: 'oficina',
  props: {
    title: 'Oficina',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RUNNING = 'local_11111111-1111-1111-1111-111111111111'
const PAUSED = 'local_22222222-2222-2222-2222-222222222222'

const SESSIONS = [
  { sessionId: RUNNING, title: 'Arreglar login', cwd: 'C:/code/mi-proyecto', isRunning: true, link: 'claude://a', prNumber: 12 },
  {
    sessionId: PAUSED,
    title: 'Docs',
    cwd: 'C:/code/otra',
    isRunning: false,
    link: 'claude://b',
    lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
]

test('el panel tiene filtros, estado y acciones con confirmación', async ($, on) => {
  const calls: string[] = []
  const toasts: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'local_self' }))
  on('session.root', () => ({ value: 'C:/code/mi-proyecto' }))
  on('clock.every', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { ok: true, status: 200, headers: {}, text: '[]' } }))
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('tool.call', (_, e) => {
    const tool = (e as { tool: string }).tool
    calls.push(tool)
    if (tool.endsWith('list_sessions')) return { result: JSON.stringify(SESSIONS) }
    if (tool.endsWith('get_session'))
      return { result: JSON.stringify({ sessionId: 'local_self', title: 'Yo', cwd: 'C:/code/mi-proyecto' }) }
    return { result: 'ok' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // El refresco del arranque va sin await: se deja terminar.
  for (let i = 0; i < 20; i++) await Promise.resolve()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'chip-all' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'chip-otra' })).toBeDefined()
    // En el escritorio el título, los datos y el estado van dentro del dibujo (como en el navegador).
    const said = async (re: RegExp) =>
      surface === 'terminal'
        ? (await ui.find({ type: 'Text', text: re })) !== undefined
        : (await ui.findAll({ type: 'Svg' })).some(s => re.test(String((s.props as { alt?: string }).alt)))
    expect(await said(/PR #12/)).toBe(true)
    expect(await said(/hace 5 min/)).toBe(true)
    if (surface === 'desktop') {
      const sources = (await ui.findAll({ type: 'Svg' })).map(s => String((s.props as { source?: string }).source))
      expect(sources.some(src => src.includes('Arreglar login') && src.includes('#262836'))).toBe(true)
    }
    // Los tres botones siempre, en las dos tarjetas: la tarjeta no cambia de forma con el estado.
    for (const id of [RUNNING, PAUSED])
      for (const a of ['stop', 'archive', 'delete'])
        expect(await ui.find({ type: 'Button', key: `${a}-${id}` })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Archivar la que trabaja no aplica: explica por qué y no pide confirmación.
  await ui.press({ key: `archive-${RUNNING}` })
  expect(await ui.find({ type: 'Text', text: /¿Archivar/ })).toBeUndefined()
  expect(toasts.some(t => /Detén «Arreglar login» antes de archivarla/.test(t))).toBe(true)

  await ui.press({ key: `archive-${PAUSED}` })
  expect(await ui.find({ type: 'Text', text: /¿Archivar «Docs»\?/ })).toBeDefined()
  await ui.press({ key: `yes-${PAUSED}` })
  expect(calls).toContain('mcp__ccd_session_mgmt__archive_session')
  // Solo el aviso de archivado, sin «Puede que la app te pida confirmarlo».
  expect(toasts).toContain('Se ha archivado «Docs».')
  expect(toasts.some(t => /confirmarlo/.test(t))).toBe(false)

  await ui.press({ key: 'chip-otra' })
  expect(await ui.find({ type: 'Button', key: `stop-${RUNNING}` })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'deco' })).toBeDefined()
  await ui.unmount()
})

test('archivar la sesión abierta queda pendiente y se reintenta al refrescar', async ($, on) => {
  const toasts: string[] = []
  let archiveTries = 0
  let open = true
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'local_self' }))
  on('session.root', () => ({ value: 'C:/code/mi-proyecto' }))
  on('clock.every', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { ok: true, status: 200, headers: {}, text: '[]' } }))
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('tool.call', (_, e) => {
    const tool = (e as { tool: string }).tool
    if (tool.endsWith('list_sessions')) return { result: JSON.stringify(SESSIONS) }
    if (tool.endsWith('get_session'))
      return { result: JSON.stringify({ sessionId: 'local_self', title: 'Yo', cwd: 'C:/code/mi-proyecto' }) }
    if (tool.endsWith('archive_session')) {
      archiveTries++
      if (open)
        return {
          isError: true,
          result: `Session ${PAUSED} ("Docs") was not archived: the app is keeping it for the user (pinned or in use).`,
        }
      return { result: 'Archived' }
    }
    return { result: 'ok' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 20; i++) await Promise.resolve()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `archive-${PAUSED}` })
  await ui.press({ key: `yes-${PAUSED}` })
  expect(toasts.some(t => /se archivará en cuanto cambies/.test(t))).toBe(true)
  const afterFirst = archiveTries

  // Sigue abierta: el refresco lo reintenta y continúa pendiente.
  await ui.press({ key: 'refresh' })
  expect(archiveTries).toBeGreaterThan(afterFirst)
  expect(toasts.some(t => /^Archivada/.test(t))).toBe(false)

  // Ya no está abierta: el siguiente refresco la archiva.
  open = false
  await ui.press({ key: 'refresh' })
  expect(toasts).toContain('Se ha archivado «Docs».')
  const tries = archiveTries
  await ui.press({ key: 'refresh' })
  expect(archiveTries).toBe(tries)
  await ui.unmount()
})

test('/oficina-panel abre la página real en el navegador de Claude y, si no puede, el panel', async ($, on) => {
  let deny = false
  const opened: string[] = []
  const urls: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'local_self' }))
  on('session.root', () => ({ value: 'C:/code/mi-proyecto' }))
  on('clock.every', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { ok: true, status: 200, headers: {}, text: '[]' } }))
  on('tool.call', (_, e) => {
    const call = e as { tool: string; url?: string }
    if (call.tool.endsWith('list_sessions')) return { result: '[]' }
    if (call.tool.endsWith('preview_start')) {
      urls.push(String(call.url))
      return deny ? { isError: true, result: 'Permission denied' } : { result: 'Browser pane opened.' }
    }
    return { result: '{}' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ok = await $.command.run({ command: 'oficina-panel' } as never)
  expect(urls).toEqual(['http://127.0.0.1:3210'])
  expect(String((ok as { text?: string }).text)).toContain('navegador de Claude')
  expect(opened).toEqual([])

  deny = true
  const no = await $.command.run({ command: 'oficina-panel' } as never)
  expect(opened).toEqual(['oficina'])
  expect(String((no as { text?: string }).text)).toContain('panel simple')
})
