// Oficina: servidor local mínimo (sin dependencias) para la vista flotante.
// Recibe las sesiones que envía el mod "oficina-agentes" y las sirve a la página.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { applyCodexEvent, codexLink, isCodexEvent, isCodexId } from '../codex/session.mjs'

const HOST = '127.0.0.1'
const PORT = Number(process.env.OFICINA_PORT ?? 3210)
const here = dirname(fileURLToPath(import.meta.url))

const SESSION_LINK = /^claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]{36}$/
const SESSION_ID = /^local_[0-9a-f-]{36}$/
const ACTIONS = new Set(['archive', 'stop', 'delete', 'pin', 'unpin', 'rename', 'move', 'unread'])
const GROUP_ID = /^[\w-]{1,80}$/
const NEW_CHAT = 'claude://claude.ai/epitaxy/new'
let actions = []

let claude = { desks: [], groups: [], available: false }
const codex = new Map()
let updatedAt = 0
const clients = new Set()

function snapshot() {
  return {
    desks: [...claude.desks, ...Array.from(codex.values(), session => session.desk)],
    groups: claude.groups,
    hasClaude: claude.available,
    updatedAt,
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

// Versión de la página (fecha del index.html): una ventana abierta con una versión
// antigua se recarga sola al recibir otra distinta.
async function pageVersion() {
  try {
    return String(Math.round((await stat(join(here, 'index.html'))).mtimeMs))
  } catch {
    return '0'
  }
}
let watchTimer
try {
  watch(join(here, 'index.html'), () => {
    clearTimeout(watchTimer)
    watchTimer = setTimeout(async () => {
      const v = await pageVersion()
      for (const c of clients) c.write(`event: version\ndata: ${v}\n\n`)
    }, 500)
  })
} catch {
  // sin vigilancia de archivos: la versión se comprueba al reconectar
}

function broadcast() {
  updatedAt = Date.now()
  const data = `data: ${JSON.stringify(snapshot())}\n\n`
  for (const res of clients) res.write(data)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`)

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = (await readFile(join(here, 'index.html'), 'utf8')).replaceAll('__OFICINA_VERSION__', await pageVersion())
    return send(res, 200, html, 'text/html; charset=utf-8')
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, updatedAt }))
  }

  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    return send(res, 200, JSON.stringify(snapshot()))
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write(`event: version\ndata: ${await pageVersion()}\n\n`)
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`)
    clients.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(res)
    })
    return
  }

  // Solo el mod escribe: exige una cabecera propia, que una web ajena no puede
  // mandar sin un preflight CORS que este servidor nunca aprueba.
  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    if (req.headers['x-oficina'] !== '1') return send(res, 403, '{"error":"forbidden"}')
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 500_000) return send(res, 413, '{"error":"too large"}')
    }
    try {
      const parsed = JSON.parse(body)
      if (!Array.isArray(parsed.desks)) throw new Error('desks')
      // Varias sesiones envían por turnos y ninguna sabe su propia actividad: se conserva
      // la última conocida de cada sesión para que no aparezca y desaparezca.
      const before = new Map(claude.desks.map(d => [d.id, d]))
      // Lo mismo con lo que las sesiones con una versión antigua del mod aún no envían.
      const desks = parsed.desks.map(d => {
        const prev = before.get(d.id)
        if (!prev) return d
        const out = { ...d }
        if (!out.activity && prev.activity && prev.lastActivityAt === d.lastActivityAt) out.activity = prev.activity
        for (const k of ['onScreen', 'focused', 'pinned']) if (out[k] === undefined && prev[k] !== undefined) out[k] = prev[k]
        return out
      })
      const groups = Array.isArray(parsed.groups) ? parsed.groups : claude.groups
      claude = { desks, groups, available: true }
      broadcast()
      return send(res, 204, '')
    } catch {
      return send(res, 400, '{"error":"bad json"}')
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/codex/event') {
    if (req.headers['x-oficina'] !== '1') return send(res, 403, '{"error":"forbidden"}')
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 2_000) return send(res, 413, '{"error":"too large"}')
    }
    let event
    try {
      event = JSON.parse(body)
    } catch {
      return send(res, 400, '{"error":"bad json"}')
    }
    if (!isCodexEvent(event)) return send(res, 400, '{"error":"bad event"}')
    if (applyCodexEvent(codex, event)) broadcast()
    return send(res, 204, '')
  }

  // Acciones sobre sesiones (archivar, detener): la página las encola y el mod,
  // que es quien puede hablar con la app, las recoge y las ejecuta.
  if (req.method === 'POST' && url.pathname === '/api/action') {
    if (req.headers['x-oficina'] !== '1') return send(res, 403, '{"error":"forbidden"}')
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 2_000) return send(res, 413, '{"error":"too large"}')
    }
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      return send(res, 400, '{"error":"bad json"}')
    }
    const { action, sessionId } = parsed ?? {}
    if (!ACTIONS.has(action) || !SESSION_ID.test(String(sessionId))) {
      return send(res, 400, '{"error":"bad action"}')
    }
    // Datos extra según la acción: el nuevo título o el grupo de destino (null = sin grupo).
    const extra = {}
    if (action === 'rename') {
      const title = String(parsed.title ?? '').replace(/[\u0000-\u001f]/g, ' ').trim()
      if (!title || title.length > 120) return send(res, 400, '{"error":"bad title"}')
      extra.title = title
    }
    if (action === 'move') {
      if (parsed.groupId !== null && !GROUP_ID.test(String(parsed.groupId))) return send(res, 400, '{"error":"bad group"}')
      extra.groupId = parsed.groupId
    }
    if (!actions.some(a => a.action === action && a.sessionId === sessionId)) {
      actions.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, action, sessionId, ...extra })
      if (actions.length > 20) actions.shift()
    }
    return send(res, 202, '{"queued":true}')
  }

  if (req.method === 'GET' && url.pathname === '/api/actions') {
    if (req.headers['x-oficina'] !== '1') return send(res, 403, '{"error":"forbidden"}')
    // Una sesión no recibe acciones sobre sí misma mientras otra pueda hacerlas: la app
    // siempre pide confirmación cuando una sesión se archiva o se elimina a sí misma.
    // Si en 8 s ninguna otra la ha recogido, se le entrega igualmente.
    const self = url.searchParams.get('self') ?? ''
    // Cada mod dice qué acciones sabe hacer (?can=…); uno antiguo no lo dice y solo
    // recibe las de siempre, así no se pierde lo que no entiende.
    const can = new Set((url.searchParams.get('can') ?? 'archive,stop,delete').split(','))
    const now = Date.now()
    const out = []
    const keep = []
    for (const a of actions) {
      const age = now - Number(String(a.id).split('-')[0])
      if (can.has(a.action) && (a.sessionId !== self || age > 8_000)) out.push(a)
      else keep.push(a)
    }
    actions = keep
    return send(res, 200, JSON.stringify(out))
  }

  if (req.method === 'POST' && url.pathname === '/api/action-result') {
    if (req.headers['x-oficina'] !== '1') return send(res, 403, '{"error":"forbidden"}')
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 10_000) return send(res, 413, '{"error":"too large"}')
    }
    try {
      const r = JSON.parse(body)
      const data = JSON.stringify({
        action: String(r.action ?? ''),
        sessionId: String(r.sessionId ?? ''),
        ok: Boolean(r.ok),
        pending: Boolean(r.pending),
        message: String(r.message ?? '').slice(0, 500),
      })
      for (const c of clients) c.write(`event: result\ndata: ${data}\n\n`)
      return send(res, 204, '')
    } catch {
      return send(res, 400, '{"error":"bad json"}')
    }
  }

  // Ventana compacta propia, siempre encima (Windows). No depende del PiP del
  // navegador, que solo admite una ventana a la vez.
  if (req.method === 'POST' && url.pathname === '/api/pin') {
    if (req.headers['x-oficina'] !== '1') return send(res, 403, '{"error":"forbidden"}')
    if (process.platform !== 'win32') return send(res, 501, '{"error":"windows only"}')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'pin.ps1'), '-Url', `http://${HOST}:${PORT}/?mini`],
      { windowsHide: true },
    )
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.on('error', () => send(res, 500, '{"error":"spawn"}'))
    child.on('close', code => send(res, code === 0 && out.includes('ok') ? 204 : 500, code === 0 ? '' : '{"error":"pin"}'))
    return
  }

  // Ajusta el alto de la ventana compacta cuando la página no puede hacerlo sola.
  if (req.method === 'POST' && url.pathname === '/api/resize') {
    if (req.headers['x-oficina'] !== '1') return send(res, 403, '{"error":"forbidden"}')
    if (process.platform !== 'win32') return send(res, 501, '{"error":"windows only"}')
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 200) return send(res, 413, '{"error":"too large"}')
    }
    let height = 0
    try {
      height = Math.round(Number(JSON.parse(body).height))
    } catch {
      return send(res, 400, '{"error":"bad json"}')
    }
    if (!Number.isFinite(height) || height < 150 || height > 4000) return send(res, 400, '{"error":"bad height"}')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'pin.ps1'), '-Height', String(height)],
      { windowsHide: true },
    )
    child.on('error', () => send(res, 500, '{"error":"spawn"}'))
    child.on('close', code => send(res, code === 0 ? 204 : 500, code === 0 ? '' : '{"error":"resize"}'))
    return
  }

  // Solo enlaces locales de sesión o el acceso fijo al nuevo chat de Claude.
  if (req.method === 'POST' && url.pathname === '/api/open') {
    if (req.headers['x-oficina'] !== '1') return send(res, 403, '{"error":"forbidden"}')
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 2_000) return send(res, 413, '{"error":"too large"}')
    }
    let link = ''
    try {
      link = String(JSON.parse(body).link ?? '')
    } catch {
      return send(res, 400, '{"error":"bad json"}')
    }
    const codexId = link.slice('codex://threads/'.length)
    const isCodexLink = isCodexId(codexId) && link === codexLink(codexId)
    if (!SESSION_LINK.test(link) && !isCodexLink && link !== NEW_CHAT) {
      return send(res, 400, '{"error":"not a session link"}')
    }
    const [cmd, args] =
      process.platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', link]]
        : process.platform === 'darwin'
          ? ['open', [link]]
          : ['xdg-open', [link]]
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
    return send(res, 204, '')
  }

  send(res, 404, '{"error":"not found"}')
})

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[oficina] ya hay un servidor en ${HOST}:${PORT}`)
    process.exit(0)
  }
  throw err
})

server.listen(PORT, HOST, () => console.log(`[oficina] http://${HOST}:${server.address().port}`))
