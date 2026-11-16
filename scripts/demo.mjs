// Arranca la oficina con sesiones de ejemplo, sin Claude ni Codex, en un puerto
// aparte para no mezclarlas con las reales. Sirve para probar la página y para
// hacer capturas: node scripts/demo.mjs [puerto]
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const port = Number(process.argv[2] ?? 3211)
const origin = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-oficina': '1' }
const uuid = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4000-8000-${String(n).repeat(12)}`
const minutesAgo = minutes => new Date(Date.now() - minutes * 60_000).toISOString()

const groups = [
  { id: 'producto', name: 'Producto' },
  { id: 'infra', name: 'Infraestructura' },
]
const claudeChats = [
  { n: 1, title: 'Migrar el login a OAuth', project: 'tienda-web', isRunning: true, pinned: true, onScreen: true, focused: true, pr: '#128', activity: { kind: 'tool', tool: 'Edit' } },
  { n: 2, title: 'Tests de la pasarela de pago', project: 'tienda-web', isRunning: true, group: 'Producto', activity: { kind: 'tool', tool: 'Bash' } },
  { n: 3, title: 'Rediseñar la página de precios', project: 'landing', isRunning: false, group: 'Producto', minutes: 4, pr: '#57', activity: { kind: 'text', text: 'He dejado la nueva tabla de precios lista para revisar.' } },
  { n: 4, title: 'Reducir el tiempo de despliegue', project: 'infra', isRunning: true, group: 'Infraestructura', activity: { kind: 'tool', tool: 'Read' } },
  { n: 5, title: 'Alertas de latencia en la API', project: 'infra', isRunning: false, group: 'Infraestructura', minutes: 38, activity: { kind: 'text', text: 'Las alertas ya avisan cuando el p95 supera los 400 ms.' } },
  { n: 6, title: 'Documentar la API pública', project: 'api', isRunning: false, minutes: 95, activity: { kind: 'text', text: 'La referencia de la API está actualizada.' } },
]
const codexChats = [
  { n: 7, title: 'Optimizar las consultas del informe', project: 'api', lastEvent: 'UserPromptSubmit' },
  { n: 8, title: 'Corregir el modo oscuro', project: 'landing', lastEvent: 'Stop' },
]

const desks = claudeChats.map(({ n, minutes = 0, ...desk }) => ({
  id: `local_${uuid(n)}`,
  isSelf: false,
  link: `claude://claude.ai/epitaxy/local_${uuid(n)}`,
  lastActivityAt: minutesAgo(minutes),
  ...desk,
}))

// Los títulos de Codex salen de su índice local: se usa uno temporal.
const codexHome = await mkdtemp(join(tmpdir(), 'oficina-demo-'))
await writeFile(
  join(codexHome, 'session_index.jsonl'),
  codexChats.map(chat => JSON.stringify({ id: uuid(chat.n), thread_name: chat.title })).join('\n') + '\n',
)

const server = spawn(process.execPath, [fileURLToPath(new URL('../server/server.mjs', import.meta.url))], {
  env: { ...process.env, OFICINA_PORT: String(port), CODEX_HOME: codexHome },
  stdio: 'inherit',
})
process.once('SIGINT', () => server.kill())
process.once('SIGTERM', () => server.kill())
server.once('exit', async code => {
  await rm(codexHome, { recursive: true, force: true })
  process.exit(code ?? 0)
})

async function post(path, body) {
  const res = await fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
}

for (let attempt = 0; ; attempt++) {
  try {
    await post('/api/sessions', { desks, groups })
    break
  } catch (error) {
    if (attempt === 40) throw error
    await delay(100)
  }
}
for (const { n, project, lastEvent } of codexChats) {
  const event = { id: uuid(n), project, turnId: uuid(9) }
  await post('/api/codex/event', { ...event, name: 'UserPromptSubmit' })
  if (lastEvent !== 'UserPromptSubmit') await post('/api/codex/event', { ...event, name: lastEvent })
}
console.log(`[oficina] datos de ejemplo en ${origin} (Ctrl+C para salir)`)
