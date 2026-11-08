import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Desk, Office, View } from '../types'

const PANE = 'oficina'
const TITLE = 'Oficina'
const LIST_TOOL = 'mcp__ccd_session_mgmt__list_sessions'
const POLL_MS = 15_000
// Alto a propósito: cada sesión con el mod envía su lista, y si se cortara en pocas
// las tarjetas aparecerían y desaparecerían según qué sesión enviara la última.
const MAX_DESKS = 40

const office = atom(
  { plugin: 'oficina-agentes', key: 'office' } as const,
  { desks: [], updatedAt: 0 } as Office,
  { shape: 'office-2' },
)

// Lo que el panel recuerda: filtro, decoración por proyecto, avisos y confirmación abierta.
const view = atom(
  { plugin: 'oficina-agentes', key: 'view' } as const,
  { filter: '', themes: {}, notify: false } as View,
  { shape: 'view-1' },
)

// ---------- datos ----------

type RawSession = {
  sessionId?: string
  title?: string
  cwd?: string
  isRunning?: boolean
  isArchived?: boolean
  pinned?: boolean
  link?: string
  prNumber?: number
  prState?: string
  lastActivityAt?: string
  group?: { name?: string } | null
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(toText).join('\n')
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.text === 'string') return v.text
    if (v.content !== undefined) return toText(v.content)
    if (v.result !== undefined) return toText(v.result)
  }
  return JSON.stringify(value ?? '')
}

function parseSessions(text: string): RawSession[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < start) return []
  const parsed: unknown = JSON.parse(text.slice(start, end + 1))
  return Array.isArray(parsed) ? (parsed as RawSession[]) : []
}

function projectOf(cwd: string | undefined): string {
  if (!cwd) return '?'
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? '?'
}

// ---------- dibujo ----------
// Mismo dibujo que la página del navegador (oficina-server/index.html).

const SHIRTS = ['#e4572e', '#29335c', '#f3a712', '#669bbc', '#8f2d56', '#2a9d8f', '#7b2cbf', '#d62828']
const HAIRS = ['#2b1d14', '#6b3e26', '#d9a441', '#1b1b1b', '#a23b2a', '#5c5c5c']
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']
// Decoración por departamento (carpeta): suelo A, suelo B, alfombra.
const THEMES = [
  ['#d8c3a5', '#cdb594', '#e9dfcf'], // madera
  ['#9bb1d4', '#8aa2c8', '#dfe7f3'], // moqueta azul
  ['#a7c4a0', '#98b891', '#eef3e2'], // jardín
  ['#e6e6ea', '#d9d9df', '#f7f1e3'], // mármol
  ['#5a5f7d', '#4f5470', '#7d81a0'], // noche
  ['#e8b4bc', '#dfa3ad', '#f8e1e4'], // rosa
  ['#e9d8a6', '#dccb93', '#f5ecd0'], // arena
  ['#b8e0d2', '#a6d4c4', '#e8f6f0'], // menta
] as const

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return Math.abs(h)
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const CARD_W = 160
const CARD_H = 112
const P = 4 // tamaño de un píxel del personaje

function px(x: number, y: number, w: number, h: number, fill: string, extra = ''): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`
}

function themeOf(project: string, themes: Record<string, number>): number {
  const saved = themes[project]
  return saved !== undefined && Number.isInteger(saved) && saved >= 0 && saved < THEMES.length
    ? saved
    : hash(project) % THEMES.length
}

// Bajo el dibujo, el bloque de datos de la tarjeta del navegador (.info): título,
// proyecto · PR · grupo y estado, con sus colores y su letra monoespaciada.
const INFO_H = 50
const CARD_TOTAL_H = CARD_H + INFO_H
const UI = { panel: '#262836', ink: '#f2efe9', dim: '#a3a7b8', work: '#5fd38d', rest: '#8d93a8' }
const MONO = "ui-monospace, 'Cascadia Mono', Consolas, monospace"

type CardInfo = { meta: string; status: string }

function xml(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

function drawInfo(d: Desk, info: CardInfo): string {
  const y = CARD_H
  const color = d.isRunning ? UI.work : UI.rest
  const pulse = d.isRunning
    ? `<circle cx="11" cy="${y + 40}" r="2.6" fill="none" stroke="${UI.work}" stroke-width="1"><animate attributeName="r" values="2.6;6" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="1.4s" repeatCount="indefinite"/></circle>`
    : ''
  return [
    `<clipPath id="ci"><rect x="7" y="${y}" width="${CARD_W - 14}" height="${INFO_H}"/></clipPath>`,
    px(0, y, CARD_W, INFO_H, UI.panel),
    `<g clip-path="url(#ci)" font-family="${MONO}" shape-rendering="auto">`,
    `<text x="8" y="${y + 15}" font-size="9.5" font-weight="700" fill="${UI.ink}">${xml(cut(d.title, 25))}</text>`,
    `<text x="8" y="${y + 28}" font-size="8" fill="${UI.dim}">${xml(cut(info.meta, 31))}</text>`,
    `<circle cx="11" cy="${y + 40}" r="2.6" fill="${color}"/>${pulse}`,
    `<text x="18" y="${y + 43}" font-size="8" fill="${d.isRunning ? UI.work : UI.ink}">${xml(cut(info.status, 29))}</text>`,
    '</g>',
  ].join('')
}

function drawCard(d: Desk, theme: number, info: CardInfo): string {
  const w = 320
  const h = Math.round((w * CARD_TOTAL_H) / CARD_W)
  const [fa, fb, rug] = THEMES[theme] ?? THEMES[0]
  const seed = hash(d.id)
  const shirt = SHIRTS[hash(d.project) % SHIRTS.length] as string
  const hair = HAIRS[seed % HAIRS.length] as string
  const skin = SKINS[(seed >> 3) % SKINS.length] as string
  const delay = ((seed % 7) / 10).toFixed(1)
  const on = d.isRunning
  const W = CARD_W
  const o: string[] = []
  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${CARD_TOTAL_H}" width="${w}" height="${h}" shape-rendering="crispEdges">`,
  )
  o.push(
    `<defs><pattern id="f${theme}" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="${fa}"/><rect width="16" height="16" fill="${fb}"/><rect x="16" y="16" width="16" height="16" fill="${fb}"/></pattern></defs>`,
  )
  o.push(px(0, 0, W, CARD_H, `url(#f${theme})`))
  o.push(px(12, 18, W - 24, 92, rug, ' rx="6"'))
  o.push(px(34, 44, 36, 34, '#4a4e69', ' rx="4"'))
  const cx = 38
  const cy = 30
  o.push(
    `<g>${
      on
        ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="0.6s" begin="${delay}s" repeatCount="indefinite"/>`
        : '<animateTransform attributeName="transform" type="rotate" values="-4 52 58;-7 52 58;-4 52 58" dur="3s" repeatCount="indefinite"/>'
    }`,
  )
  o.push(px(cx + P * 2, cy, P * 3, P, hair), px(cx + P, cy + P, P * 5, P, hair), px(cx + P, cy + P * 2, P * 5, P * 3, skin))
  if (on) o.push(px(cx + P * 2, cy + P * 3, P, P, '#1b1b1b'), px(cx + P * 4, cy + P * 3, P, P, '#1b1b1b'))
  else o.push(px(cx + P * 2, cy + P * 3 + 2, P, 2, '#1b1b1b'), px(cx + P * 4, cy + P * 3 + 2, P, 2, '#1b1b1b'))
  o.push(px(cx, cy + P * 5, P * 7, P * 3, shirt), '</g>')
  o.push(
    px(18, 66, W - 36, 12, '#a0703c'),
    px(18, 78, W - 36, 4, '#7a5229'),
    px(24, 82, 6, 26, '#7a5229'),
    px(W - 30, 82, 6, 26, '#7a5229'),
  )
  const hand = (x: number, b: string) =>
    `<rect x="${x}" y="62" width="${P * 2}" height="${P}" fill="${skin}">${
      on ? `<animate attributeName="y" values="62;58;62" dur="0.25s" begin="${b}" repeatCount="indefinite"/>` : ''
    }</rect>`
  o.push(hand(cx + 2, '0s'), hand(cx + P * 5 - 2, '0.12s'))
  o.push(px(84, 30, 44, 32, '#22223b', ' rx="2"'))
  if (on) {
    o.push(
      '<rect x="87" y="33" width="38" height="24" fill="#7fd6ff"><animate attributeName="opacity" values="1;0.75;1" dur="1.4s" repeatCount="indefinite"/></rect>',
    )
    for (let i = 0; i < 3; i++)
      o.push(
        `<rect x="90" y="${37 + i * 6}" width="10" height="2" fill="#1d3557"><animate attributeName="width" values="4;${20 + i * 5};4" dur="${1 + i * 0.3}s" repeatCount="indefinite"/></rect>`,
      )
    o.push(px(18, 4, 34, 18, '#fff', ' rx="5" stroke="#22223b" stroke-width="1.5"'))
    for (let i = 0; i < 3; i++)
      o.push(
        `<rect x="${25 + i * 8}" y="12" width="4" height="4" fill="#22223b"><animate attributeName="opacity" values="0.2;1;0.2" dur="1s" begin="${i * 0.2}s" repeatCount="indefinite"/></rect>`,
      )
  } else {
    o.push(px(87, 33, 38, 24, '#2b3440'))
    o.push(
      '<text x="66" y="30" font-family="monospace" font-size="13" font-weight="bold" fill="#6c7a89">z<animate attributeName="y" values="34;14" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="2.4s" repeatCount="indefinite"/></text>',
    )
  }
  o.push(px(102, 62, 8, 4, '#22223b'))
  if (seed % 3 === 0) o.push(px(W - 26, 50, 10, 16, '#bc6c25'), px(W - 30, 38, 18, 14, '#40916c', ' rx="6"'))
  o.push(drawInfo(d, info))
  o.push('</svg>')
  return o.join('')
}

function ago(iso: string | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  const days = Math.round(s / 86400)
  return days === 1 ? 'ayer' : `hace ${days} días`
}

// ---------- hooks ----------

let selfRunning = false
let selfId = 'self'
let started = false

async function refresh($: Engine) {
  try {
    const ran = await $.tool.call({ tool: LIST_TOOL, limit: MAX_DESKS - 1 } as never)
    if ('deny' in ran && ran.deny) throw new Error(ran.deny)
    const sessions = parseSessions(toText((ran as { result?: unknown }).result))
    pinnedIds = new Set(sessions.filter(s => s.pinned && s.sessionId).map(s => s.sessionId as string))
    const desks: Desk[] = [
      await selfDesk($),
      ...sessions
        .filter(s => s.sessionId && !s.isArchived)
        .slice(0, MAX_DESKS - 1)
        .map(s => ({
          id: s.sessionId as string,
          title: s.title?.trim() || 'Sin título',
          project: projectOf(s.cwd),
          isRunning: Boolean(s.isRunning),
          isSelf: false,
          link: s.link,
          pr: s.prNumber ? `#${s.prNumber}` : undefined,
          lastActivityAt: s.lastActivityAt,
          group: s.group?.name,
          pinned: Boolean(s.pinned),
        })),
    ]
    await markOnScreen($, desks)
    await addActivity($, desks)
    await update($, office, () => ({ desks, updatedAt: Date.now() }))
    await announceFinished($, desks)
    await pushToServer($, desks, await listGroups($))
    await retryPendingArchives($)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, office, prev => ({ ...prev, error: message, updatedAt: Date.now() }))
  }
}

const wasRunning = new Map<string, boolean>()

// Igual que «Avisarme cuando una termine» de la página del navegador.
async function announceFinished($: Engine, desks: Desk[]) {
  const { notify } = await read($, view)
  for (const d of desks) {
    const before = wasRunning.get(d.id)
    wasRunning.set(d.id, d.isRunning)
    if (!notify || d.isSelf || before !== true || d.isRunning) continue
    const text = `«${d.title}» ha terminado`
    $.ui.toast(text)
    try {
      await $.ui.notify(text, { title: TITLE })
    } catch {
      // sin canal de avisos: basta con el toast
    }
  }
}

const SERVER = 'http://127.0.0.1:3210'
const BROWSER_TOOL = 'mcp__Claude_Browser__preview_start'
let lastStartTry = 0

async function startServer($: Engine) {
  const now = Date.now()
  if (now - lastStartTry < 60_000) return
  lastStartTry = now
  // El servidor viaja dentro del plugin (server/), así funciona en cualquier instalación.
  const root = $.plugin.root
  const isWindows = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\')
  const serverPath = `${root}${isWindows ? '\\' : '/'}server${isWindows ? '\\' : '/'}server.mjs`
  try {
    if (isWindows) {
      const quoted = serverPath.replace(/'/g, "''")
      const script = `Start-Process -WindowStyle Hidden -FilePath node -ArgumentList ('"' + '${quoted}' + '"')`
      await $.process.run(['powershell.exe', '-NoProfile', '-Command', script], { timeoutMs: 15_000 })
    } else {
      await $.process.run(['sh', '-c', 'nohup node "$0" >/dev/null 2>&1 &', serverPath], { timeoutMs: 15_000 })
    }
  } catch {
    // sin servidor: la oficina sigue en el panel de Claude
  }
}

async function pushToServer($: Engine, desks: Desk[], groups?: Group[]) {
  try {
    const res = await $.http.fetch(`${SERVER}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-oficina': '1' },
      body: JSON.stringify(groups ? { desks, groups } : { desks }),
    })
    if (res.ok) return
  } catch {
    // el servidor no responde
  }
  await startServer($)
}

type Action = 'archive' | 'stop' | 'delete'
type SidebarAction = 'pin' | 'unpin' | 'rename' | 'move' | 'unread'
type QueuedAction = {
  id: string
  action: Action | SidebarAction
  sessionId: string
  title?: string
  groupId?: string | null
}

// Lo mismo que la barra lateral de la app: fijar, renombrar, mover de grupo, marcar no leída.
const SIDEBAR_TOOLS: Record<SidebarAction, string> = {
  pin: 'mcp__ccd_sidebar__set_pinned',
  unpin: 'mcp__ccd_sidebar__set_pinned',
  rename: 'mcp__ccd_session_mgmt__set_session_title',
  move: 'mcp__ccd_sidebar__move_sessions',
  unread: 'mcp__ccd_sidebar__set_unread',
}

async function runSidebarAction($: Engine, item: QueuedAction): Promise<ActionResult> {
  const action = item.action as SidebarAction
  const tool = SIDEBAR_TOOLS[action]
  const id = item.sessionId
  const input =
    action === 'pin' || action === 'unpin'
      ? { tool, session_id: id, pinned: action === 'pin' }
      : action === 'rename'
        ? { tool, session_id: id, title: String(item.title ?? '').slice(0, 120) }
        : action === 'move'
          ? { tool, session_ids: [id], group_id: item.groupId ?? null }
          : { tool, session_id: id, unread: true }
  try {
    const ran = await $.tool.call(input as never)
    if ('deny' in ran && ran.deny) return { ok: false, message: ran.deny }
    return { ok: !(ran as { isError?: boolean }).isError, message: toText((ran as { result?: unknown }).result).slice(0, 400) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

type Group = { id: string; name: string }

// Grupos de la barra lateral, para «Mover a» en la página.
async function listGroups($: Engine): Promise<Group[] | undefined> {
  try {
    const ran = await $.tool.call({ tool: 'mcp__ccd_sidebar__list_groups' } as never)
    if ('deny' in ran && ran.deny) return undefined
    const text = toText((ran as { result?: unknown }).result)
    const parsed: unknown = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    return Array.isArray(parsed)
      ? (parsed as { id?: unknown; name?: unknown }[])
          .filter(g => typeof g.id === 'string' && typeof g.name === 'string')
          .map(g => ({ id: g.id as string, name: g.name as string }))
      : undefined
  } catch {
    return undefined
  }
}

const ACTION_TOOLS = {
  archive: 'mcp__ccd_session_mgmt__archive_session',
  stop: 'mcp__ccd_session_mgmt__stop_session',
  delete: 'mcp__ccd_session_mgmt__delete_session',
} as const

const ACTION_LABEL: Record<Action, string> = { stop: 'Detener', archive: 'Archivar', delete: 'Eliminar' }
const ACTION_ORDER: Action[] = ['stop', 'archive', 'delete']

// Orden estable: cada tarjeta conserva su sitio entre refrescos (antes se reordenaban al cambiar de
// estado o de actividad y las filas «bailaban»). Las que aparecen después entran arriba.
const deskOrder = new Map<string, number>()
let nextTop = 0
function stableOrder(list: Desk[]): Desk[] {
  const byActivity = [...list].sort(
    (a, b) => (Date.parse(a.lastActivityAt ?? '') || 0) - (Date.parse(b.lastActivityAt ?? '') || 0),
  )
  for (const d of byActivity) if (!deskOrder.has(d.id)) deskOrder.set(d.id, --nextTop)
  return [...list].sort((a, b) => (deskOrder.get(a.id) ?? 0) - (deskOrder.get(b.id) ?? 0))
}

function confirmText(action: Action, title: string): string {
  if (action === 'stop') return `¿Detener lo que está haciendo «${title}»?`
  if (action === 'archive') return `¿Archivar «${title}»?`
  return `¿Eliminar «${title}» para siempre? No se puede deshacer.`
}

// Lo usan el panel y la página del navegador (que lo encola en el servidor).
async function runAction($: Engine, action: Action, sessionId: string): Promise<{ ok: boolean; message: string }> {
  const tool = ACTION_TOOLS[action]
  if (!tool || !/^local_[0-9a-f-]{36}$/.test(sessionId)) return { ok: false, message: 'Sesión no válida' }
  try {
    // Eliminar: la app siempre pide aprobación en su propia tarjeta y nunca
    // se fuerza el borrado de cambios sin guardar.
    const input =
      action === 'delete'
        ? { tool, session_ids: [sessionId], reason: 'Pedido desde la Oficina' }
        : action === 'archive'
          ? { tool, session_id: sessionId, reason: 'Pedido desde la Oficina' }
          : { tool, session_id: sessionId }
    const ran = await $.tool.call(input as never)
    if ('deny' in ran && ran.deny) return { ok: false, message: ran.deny }
    return {
      ok: !(ran as { isError?: boolean }).isError,
      message: toText((ran as { result?: unknown }).result).slice(0, 400),
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

// La app no archiva la sesión que el usuario tiene abierta en pantalla si la
// petición viene de un mod: queda pendiente y se reintenta en cada refresco
// hasta que deje de estar abierta (o pase una hora).
const IN_USE = /in use|open on screen|keeping it for the user|still working|mid-turn/i
const PENDING_MAX_MS = 60 * 60_000
const pendingArchives = new Map<string, number>()
let pinnedIds = new Set<string>()
let retrying = false

type ActionResult = { ok: boolean; message: string; pending?: boolean }

async function archiveOrWait($: Engine, sessionId: string): Promise<ActionResult> {
  const r = await runAction($, 'archive', sessionId)
  if (r.ok) {
    pendingArchives.delete(sessionId)
    return r
  }
  if (!IN_USE.test(r.message)) return r
  if (pinnedIds.has(sessionId)) {
    return { ok: false, message: 'Está fijada: quítala de fijadas en la barra lateral y vuelve a pulsar.' }
  }
  if (!pendingArchives.has(sessionId)) pendingArchives.set(sessionId, Date.now())
  return { ok: false, pending: true, message: 'Está abierta: se archivará en cuanto cambies a otra sesión.' }
}

async function reportResult($: Engine, action: Action | SidebarAction, sessionId: string, r: ActionResult) {
  try {
    await $.http.fetch(`${SERVER}/api/action-result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-oficina': '1' },
      body: JSON.stringify({ action, sessionId, ...r }),
    })
  } catch {
    // sin página abierta: basta con el toast del panel
  }
}

async function retryPendingArchives($: Engine) {
  if (retrying || pendingArchives.size === 0) return
  retrying = true
  try {
    const titles = new Map((await read($, office)).desks.map(d => [d.id, d.title]))
    for (const [sessionId, since] of [...pendingArchives]) {
      const title = titles.get(sessionId)
      if (title === undefined && Date.now() - since > PENDING_MAX_MS) {
        pendingArchives.delete(sessionId)
        continue
      }
      const r = await archiveOrWait($, sessionId)
      if (r.pending) {
        if (Date.now() - since > PENDING_MAX_MS) {
          pendingArchives.delete(sessionId)
          $.ui.toast(`Ya no se archivará «${title ?? sessionId}»: siguió abierta más de una hora.`)
        }
        continue
      }
      pendingArchives.delete(sessionId)
      $.ui.toast(
        r.ok ? `Se ha archivado «${title ?? sessionId}».` : `No se pudo archivar «${title ?? sessionId}»: ${cut(r.message, 160)}`,
      )
      await reportResult($, 'archive', sessionId, r)
    }
  } finally {
    retrying = false
  }
}

let polling = false

async function pollActions($: Engine) {
  if (polling) return
  polling = true
  try {
    // Con «self», el servidor deja las acciones sobre esta sesión para otra sesión.
    const can = [...Object.keys(ACTION_TOOLS), ...Object.keys(SIDEBAR_TOOLS)].join(',')
    const res = await $.http.fetch(`${SERVER}/api/actions?self=${encodeURIComponent(selfId)}&can=${can}`, {
      headers: { 'x-oficina': '1' },
    })
    if (!res.ok) return
    const queued = JSON.parse(res.text) as QueuedAction[]
    for (const item of queued) {
      if (item.action in SIDEBAR_TOOLS) {
        await reportResult($, item.action, item.sessionId, await runSidebarAction($, item))
        continue
      }
      const action = item.action as Action
      if (!ACTION_TOOLS[action]) continue
      const r = action === 'archive' ? await archiveOrWait($, item.sessionId) : await runAction($, action, item.sessionId)
      await reportResult($, action, item.sessionId, r)
    }
    if (queued.length > 0) await refresh($)
  } catch {
    // servidor caído: el siguiente refresh lo arranca
  } finally {
    polling = false
  }
}

async function openUrl($: Engine, url: string): Promise<boolean> {
  const tries: string[][] = [
    ['rundll32.exe', 'url.dll,FileProtocolHandler', url],
    ['open', url],
    ['xdg-open', url],
  ]
  for (const argv of tries) {
    try {
      const ran = await $.process.run(argv, { timeoutMs: 10_000 })
      if (ran.exitCode === 0) return true
    } catch {
      // probar el siguiente
    }
  }
  return false
}

async function openFloating($: Engine) {
  await startServer($)
  // Primero la ventana compacta fijada encima (Windows); si no, la página en el navegador.
  try {
    const res = await $.http.fetch(`${SERVER}/api/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-oficina': '1' },
      body: '{}',
    })
    if (res.ok) return
  } catch {
    // servidor aún arrancando o no es Windows
  }
  if (!(await openUrl($, SERVER))) $.ui.toast('No pude abrir el navegador')
}

async function openSession($: Engine, desk: Desk) {
  if (!desk.link) {
    $.ui.toast(`No tengo enlace para «${desk.title}»`)
    return
  }
  if (await openUrl($, desk.link)) return
  $.ui.toast(`No pude abrir «${desk.title}»`)
}

const GET_TOOL = 'mcp__ccd_session_mgmt__get_session'

function parseObject(text: string): RawSession | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as RawSession
  } catch {
    return null
  }
}

// La app excluye de list_sessions a la sesión que pregunta: se piden sus datos aparte.
async function selfDesk($: Engine): Promise<Desk> {
  let raw: RawSession | null = null
  try {
    const ran = await $.tool.call({ tool: GET_TOOL, session_id: 'self' } as never)
    if (!('deny' in ran && ran.deny)) raw = parseObject(toText((ran as { result?: unknown }).result))
  } catch {
    raw = null
  }
  if (raw?.sessionId) selfId = raw.sessionId
  return {
    id: selfId,
    title: raw?.title?.trim() || 'Sin título',
    project: projectOf(raw?.cwd ?? (await $.session.root())),
    isRunning: selfRunning || Boolean(raw?.isRunning),
    isSelf: true,
    link: raw?.link,
    pr: raw?.prNumber ? `#${raw.prNumber}` : undefined,
    lastActivityAt: raw?.lastActivityAt,
    group: raw?.group?.name ?? undefined,
    pinned: Boolean(raw?.pinned),
  }
}

// ---------- en pantalla y última actividad ----------

const LAYOUT_TOOL = 'mcp__ccd_window__get_window_layout'
const EVENTS_TOOL = 'mcp__ccd_session_mgmt__list_events'

type Layout = {
  main_window?: { panes?: { session_id?: string; focused?: boolean }[] }
  popout_windows?: { sessions?: (string | { session_id?: string })[] }
}

// Qué sesiones tiene abiertas la ventana de la app, y cuál con el foco.
async function markOnScreen($: Engine, desks: Desk[]) {
  try {
    const ran = await $.tool.call({ tool: LAYOUT_TOOL } as never)
    if ('deny' in ran && ran.deny) return
    const text = toText((ran as { result?: unknown }).result)
    const start = text.indexOf('{')
    const layout = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)) as Layout
    const open = new Set<string>()
    let focused = ''
    for (const pane of layout.main_window?.panes ?? []) {
      if (!pane.session_id) continue
      open.add(pane.session_id)
      if (pane.focused) focused = pane.session_id
    }
    for (const s of layout.popout_windows?.sessions ?? []) {
      const id = typeof s === 'string' ? s : s.session_id
      if (id) open.add(id)
    }
    for (const d of desks) {
      d.onScreen = open.has(d.id)
      d.focused = d.id === focused
    }
  } catch {
    // sin datos de ventana: sin resaltado
  }
}

// Herramientas internas de la app que no dicen nada de lo que hace la sesión.
const QUIET_TOOL = /^mcp__ccd_(turn|view|window|sidebar)__|^(ToolSearch|TodoWrite|TaskCreate|TaskUpdate)$/

// Del texto de list_events: la última herramienta o el último texto, lo más reciente.
function parseActivity(text: string, isRunning: boolean): Desk['activity'] {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim()
    const called = /^\[assistant\] \(called ([^\s)]+)/.exec(line)
    if (called?.[1]) {
      if (QUIET_TOOL.test(called[1])) continue
      if (isRunning) return { kind: 'tool', tool: called[1] }
      continue
    }
    if (line.startsWith('[assistant] ')) {
      const clean = line
        .slice(12)
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#>]/g, '')
        .trim()
      if (!clean) continue
      const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean
      return { kind: 'text', text: sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence }
    }
  }
  return undefined
}

const activityCache = new Map<string, { key: string; activity: Desk['activity'] }>()

// Pide la conversación reciente solo de las sesiones con actividad nueva.
async function addActivity($: Engine, desks: Desk[]) {
  let calls = 0
  for (const d of desks) {
    if (d.isSelf) continue
    const key = `${d.lastActivityAt ?? ''}|${d.isRunning}`
    const cached = activityCache.get(d.id)
    if (cached && (cached.key === key || calls >= 8)) {
      d.activity = cached.activity
      continue
    }
    if (calls >= 8) continue
    calls++
    try {
      const ran = await $.tool.call({ tool: EVENTS_TOOL, session_id: d.id, limit: 8 } as never)
      if ('deny' in ran && ran.deny) continue
      const activity = parseActivity(toText((ran as { result?: unknown }).result), d.isRunning)
      activityCache.set(d.id, { key, activity })
      d.activity = activity
    } catch {
      // sin actividad para esta sesión
    }
  }
}

// ---------- permisos: aviso único al instalar ----------

const PERMISSION_TOOLS = [
  'mcp__ccd_session_mgmt__stop_session',
  'mcp__ccd_session_mgmt__archive_session',
  'mcp__ccd_sidebar__set_pinned',
  'mcp__ccd_session_mgmt__set_session_title',
  'mcp__ccd_sidebar__move_sessions',
  'mcp__ccd_sidebar__set_unread',
] as const
const SETUP_KEY = 'setup-notice-v2'

const SETUP_TEXT = [
  'Oficina: para detener, archivar, fijar, renombrar y mover sesiones desde la oficina sin que te pregunte cada vez',
  '(y para que funcione en modo automático), añade estas reglas a "permissions.allow"',
  'en ~/.claude/settings.json:',
  '',
  ...PERMISSION_TOOLS.map(t => `  ${t}`),
  '',
  'Eliminar una sesión siempre pide tu aprobación, tengas las reglas o no.',
  'Puedes volver a ver este aviso con /oficina-permisos.',
].join('\n')

// Herramientas cuyo permiso aún no está concedido (vacío si ya está todo).
async function missingPermissions($: Engine): Promise<string[]> {
  const missing: string[] = []
  for (const tool of PERMISSION_TOOLS) {
    try {
      const verdict = await $.tool.check({ tool, session_id: 'local_00000000-0000-0000-0000-000000000000' } as never)
      if ((verdict as { decision?: string }).decision !== 'allow') missing.push(tool)
    } catch {
      missing.push(tool)
    }
  }
  return missing
}

async function setupNotice($: Engine) {
  try {
    if (await $.store.get(SETUP_KEY)) return
    const missing = await missingPermissions($)
    await $.store.set(SETUP_KEY, { shownAt: Date.now(), missing })
    if (missing.length === 0) return
    $.ui.log(SETUP_TEXT)
    $.ui.toast('Oficina: revisa los permisos que necesita (arriba en el chat)', { timeoutMs: 8000 })
  } catch {
    // sin almacenamiento o sin interfaz: no es crítico
  }
}

async function setSelf($: Engine, running: boolean) {
  selfRunning = running
  await update($, office, prev => ({
    ...prev,
    desks: prev.desks.map(d => (d.isSelf ? { ...d, isRunning: running } : d)),
  }))
}

async function act($: Engine, action: Action, desk: Desk) {
  await update($, view, v => ({ ...v, confirming: undefined }))
  const { ok, message, pending }: ActionResult =
    action === 'archive' ? await archiveOrWait($, desk.id) : await runAction($, action, desk.id)
  if (pending) $.ui.toast(`«${desk.title}» ${message.charAt(0).toLowerCase()}${message.slice(1)}`)
  else if (ok) $.ui.toast(action === 'archive' ? `Se ha archivado «${desk.title}».` : `${ACTION_LABEL[action]}: hecho.`)
  else $.ui.toast(`No se pudo ${ACTION_LABEL[action].toLowerCase()} «${desk.title}»: ${cut(message, 160)}`)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    selfId = await $.session.id()
    // Sin abrir nada solo: la oficina se abre cuando se pide.
    await $.command.register({
      name: 'oficina',
      description: 'Abre la oficina de sesiones en el navegador (con ventana flotante)',
    })
    await $.command.register({
      name: 'oficina-panel',
      description: 'Abre la oficina de sesiones junto al chat, en el navegador de Claude',
    })
    await $.command.register({
      name: 'oficina-permisos',
      description: 'Muestra qué permisos necesita la Oficina y si ya los tienes',
    })
    void setupNotice($)
    if (!started) {
      started = true
      void refresh($)
      $.clock.every(POLL_MS, () => void refresh($))
      $.clock.every(2_000, () => void pollActions($))
    }
    return result
  })

  on('command.run', { command: 'oficina' }, async $ => {
    await refresh($)
    await openFloating($)
    return { text: 'Oficina abierta en el navegador: pulsa «Flotar» para dejarla siempre encima.' }
  })

  // El panel propio de un mod solo admite los componentes de la app (sus botones,
  // su letra), así que nunca queda igual que la página. Se abre la página real en
  // el navegador integrado de Claude, junto al chat; si no se puede, el panel simple.
  on('command.run', { command: 'oficina-permisos' }, async $ => {
    const missing = await missingPermissions($)
    if (missing.length === 0) {
      return { text: 'Oficina: ya tienes los permisos para detener y archivar. Eliminar siempre te pedirá aprobación.' }
    }
    return { text: `${SETUP_TEXT}\n\nTe faltan: ${missing.join(', ')}` }
  })

  on('command.run', { command: 'oficina-panel' }, async $ => {
    await refresh($)
    let why = ''
    // El modo automático puede no dar veredicto a la primera y pide repetir una vez tal cual.
    for (let attempt = 0; attempt < 2; attempt++) {
      why = ''
      try {
        const ran = await $.tool.call({ tool: BROWSER_TOOL, url: SERVER } as never)
        if ('deny' in ran && ran.deny) why = ran.deny
        else if ((ran as { isError?: boolean }).isError) why = toText((ran as { result?: unknown }).result)
      } catch (err) {
        why = err instanceof Error ? err.message : String(err)
      }
      if (!why || !/again once|no verdict/i.test(why)) break
    }
    if (!why) return { text: 'Oficina abierta junto al chat, en el navegador de Claude.' }
    await $.ui.open({ id: PANE, title: TITLE })
    return {
      text:
        `No pude abrir la oficina en el navegador de Claude. Te muestro el panel simple.\n` +
        `Motivo: ${cut(why, 600)}\n` +
        `Puedes abrirla tú en el navegador de Claude con la dirección ${SERVER}: la pestaña se queda abierta.`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    await setSelf($, true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await setSelf($, false)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const state = await read($, office)
    const v = await read($, view)
    const all = state.desks
    const working = all.filter(d => d.isRunning).length
    const resting = all.length - working

    const projects = [...new Set(all.map(d => d.project))].sort()
    const filter = v.filter && projects.includes(v.filter) ? v.filter : ''
    const desks = stableOrder(all).filter(d => !filter || d.project === filter)

    // Rejilla como la del navegador: tarjetas de ~190 px, dos o tres por fila si caben.
    const bodyCols = (e.props as { bodyColumns?: number } | undefined)?.bodyColumns ?? e.viewport?.columns ?? 60
    const perRow = bodyCols >= 96 ? 3 : bodyCols >= 50 ? 2 : 1
    const cardWidth = perRow === 3 ? '32%' : perRow === 2 ? '48%' : '100%'

    const setFilter = (p: string) => void update($, view, prev => ({ ...prev, filter: p }))
    const cycleTheme = (p: string) =>
      void update($, view, prev => ({
        ...prev,
        themes: { ...prev.themes, [p]: (themeOf(p, prev.themes) + 1) % THEMES.length },
      }))
    const ask = (id: string, action: Action) => void update($, view, prev => ({ ...prev, confirming: { id, action } }))
    // Botón que no aplica ahora: no se esconde (la tarjeta cambiaría de forma), explica por qué.
    const explain = (d: Desk, action: Action) =>
      $.ui.toast(
        d.isSelf
          ? 'Esta es la sesión en la que estás: no se puede gestionar desde aquí.'
          : action === 'stop'
            ? `«${cut(d.title, 40)}» no está trabajando: no hay nada que detener.`
            : `Detén «${cut(d.title, 40)}» antes de ${action === 'archive' ? 'archivarla' : 'eliminarla'}.`,
      )
    const cancel = () => void update($, view, prev => ({ ...prev, confirming: undefined }))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" gap={2} alignItems="center">
          <Text color={UI.dim}>
            <Text bold color={UI.work}>
              {working} trabajando
            </Text>{' '}
            · {resting} en pausa
          </Text>
          <Button
            key="notify"
            plain
            onPress={() => void update($, view, prev => ({ ...prev, notify: !prev.notify }))}
          >
            {v.notify ? '☑ Avisarme cuando una termine' : '☐ Avisarme cuando una termine'}
          </Button>
          <Button key="refresh" onPress={() => void refresh($)}>
            Actualizar
          </Button>
          <Button key="float" onPress={() => void openFloating($)}>
            Flotar
          </Button>
        </Box>

        {projects.length > 1 && (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button key="chip-all" variant={filter === '' ? 'primary' : undefined} onPress={() => setFilter('')}>
              Todos
            </Button>
            {projects.map(p => (
              <Button
                key={`chip-${p}`}
                variant={filter === p ? 'primary' : undefined}
                onPress={() => setFilter(p)}
              >
                {p}
              </Button>
            ))}
            {filter !== '' && (
              <Button key="deco" onPress={() => cycleTheme(filter)}>
                🎨 Cambiar decoración
              </Button>
            )}
          </Box>
        )}

        {state.error && <Text color="red">No pude leer las sesiones: {state.error}</Text>}
        {desks.length === 0 && <Text dimColor>Esperando a que Claude envíe tus sesiones…</Text>}

        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {desks.map(d => {
            const conf = v.confirming?.id === d.id ? v.confirming.action : undefined
            const meta = [d.project, d.pr ? `PR ${d.pr}` : '', d.group ?? ''].filter(Boolean).join(' · ')
            const when = !d.isRunning ? ago(d.lastActivityAt) : ''
            // Siempre los mismos tres botones en el mismo sitio; los que no aplican, atenuados.
            const usable = (a: Action) => !d.isSelf && (a === 'stop' ? d.isRunning : !d.isRunning)
            const status = `${d.isSelf ? 'Esta sesión · ' : ''}${d.isRunning ? 'Trabajando' : 'En pausa'}${when ? ` · ${when}` : ''}`
            const canOpen = !d.isSelf && Boolean(d.link)
            return (
              <Box
                key={`card-${d.id}`}
                flexDirection="column"
                width={cardWidth}
                backgroundColor={UI.panel}
                borderStyle="round"
                borderColor={d.isRunning ? UI.work : '#3a3d50'}
                overflow="hidden"
              >
                {Svg && e.surface !== 'terminal' ? (
                  <Svg
                    source={drawCard(d, themeOf(d.project, v.themes), { meta, status })}
                    alt={`${d.title} · ${meta} · ${status}`}
                    isInteractive
                  />
                ) : (
                  <Box flexDirection="column">
                    <Text bold>{cut(d.title, 30)}</Text>
                    <Text dimColor>{cut(meta, 40)}</Text>
                    <Text color={d.isRunning ? UI.work : undefined} dimColor={!d.isRunning}>
                      ● {status}
                    </Text>
                  </Box>
                )}
                {conf ? (
                  <Box flexDirection="column" paddingX={1} paddingBottom={1}>
                    <Text>{confirmText(conf, cut(d.title, 40))}</Text>
                    <Box flexDirection="row" gap={1}>
                      <Button key={`yes-${d.id}`} variant="primary" onPress={() => void act($, conf, d)}>
                        {ACTION_LABEL[conf]}
                      </Button>
                      <Button key={`no-${d.id}`} onPress={cancel}>
                        Cancelar
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  <Box flexDirection="row" flexWrap="wrap" gap={1} paddingX={1} paddingBottom={1}>
                    {canOpen && (
                      <Button key={`open-${d.id}`} plain onPress={() => void openSession($, d)}>
                        ↗ Abrir
                      </Button>
                    )}
                    {ACTION_ORDER.map(a => (
                      <Button
                        key={`${a}-${d.id}`}
                        plain
                        dimColor={!usable(a)}
                        onPress={() => (usable(a) ? ask(d.id, a) : explain(d, a))}
                      >
                        {a === 'stop' ? '■ ' : a === 'archive' ? '⤓ ' : '✕ '}
                        {ACTION_LABEL[a]}
                      </Button>
                    ))}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
        <Text dimColor>Pulsa «Abrir» en una tarjeta para ir a esa sesión.</Text>
      </Box>
    )
  })
}
