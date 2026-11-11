import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { projectOfThread } from '../codex/projects.mjs'

const id = '11111111-1111-1111-1111-111111111111'
const turnId = '22222222-2222-2222-2222-222222222222'
const claudeDesk = { id: `local_${id}`, title: 'Chat de Claude', isRunning: false }

test('los chats de Codex usan el proyecto registrado y agrupan las carpetas temporales', () => {
  const projects = [
    { id, name: 'Proyecto principal', roots: [{ path: 'C:\\code\\repo' }] },
    { id: turnId, name: 'Proyecto secundario', roots: [{ path: 'C:\\code\\repo\\apps\\web' }] },
  ]
  const scratch = 'C:\\Users\\demo\\Documents\\Codex\\2026-11-11\\te'
  assert.equal(projectOfThread({ cwd: scratch }, projects), '')
  assert.equal(projectOfThread({ cwd: scratch, projectId: id }, projects), 'Proyecto principal')
  assert.equal(projectOfThread({ cwd: 'C:\\CODE\\repo\\apps\\web\\src' }, projects), 'Proyecto secundario')
  assert.equal(projectOfThread({ cwd: 'C:\\code\\repo-antiguo' }, projects), 'repo-antiguo')
})

test('los hooks de Codex y las listas de Claude comparten la oficina', { timeout: 10_000 }, async t => {
  const codexHome = await mkdtemp(join(tmpdir(), 'oficina-codex-'))
  t.after(() => rm(codexHome, { recursive: true, force: true }))
  const name = 'Preparar la próxima versión'
  await writeFile(join(codexHome, 'session_index.jsonl'), [
    JSON.stringify({ id, thread_name: 'Nombre anterior' }),
    JSON.stringify({ id, thread_name: name }),
    '{"id":',
  ].join('\n'))
  const script = fileURLToPath(new URL('./server.mjs', import.meta.url))
  const envWithoutCodex = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
  const server = spawn(process.execPath, [script], {
    env: { ...envWithoutCodex, PATH: '', CODEX_HOME: codexHome, OFICINA_PORT: '0' },
  })
  t.after(() => server.kill())
  const [startup] = await once(server.stdout, 'data')
  const office = String(startup).trim().replace('[oficina] ', '')
  const env = { ...process.env, OFICINA_PORT: new URL(office).port }

  async function post(path, body, trusted = true) {
    return fetch(office + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(trusted ? { 'x-oficina': '1' } : {}) },
      body: JSON.stringify(body),
    })
  }

  async function hook(name, turn = turnId, cwd = 'C:\\code\\mi proyecto') {
    const hookScript = fileURLToPath(new URL('../codex/report.mjs', import.meta.url))
    const child = spawn(process.execPath, [hookScript], { env })
    child.stdin.end(JSON.stringify({
      hook_event_name: name,
      session_id: id,
      turn_id: turn,
      cwd,
      prompt: 'Contenido que no debe llegar a la oficina',
    }))
    const [code] = await once(child, 'close')
    assert.equal(code, 0)
  }

  const snapshot = () => fetch(office + '/api/sessions').then(res => res.json())
  await hook('SessionStart')
  let state = await snapshot()
  assert.equal(state.hasClaude, false)
  assert.equal(state.desks[0].project, 'mi proyecto')
  assert.equal(state.desks[0].title, name)
  assert.equal(state.desks[0].isRunning, false)

  assert.equal((await post('/api/sessions', { desks: [claudeDesk] })).status, 204)
  await hook('UserPromptSubmit')
  await hook('Stop', id)
  await hook('SessionStart')
  state = await snapshot()
  assert.equal(state.hasClaude, true)
  assert.deepEqual(state.desks[0], claudeDesk)
  assert.equal(state.desks[1].provider, 'codex')
  assert.equal(state.desks[1].isRunning, true)
  assert.equal(state.desks[1].link, `codex://threads/${id}`)
  assert.doesNotMatch(JSON.stringify(state), /Contenido que no debe llegar/)
  assert.equal((await post('/api/action', { action: 'archive', sessionId: id })).status, 409)
  assert.equal((await post('/api/action', { action: 'delete', sessionId: id, confirmed: true })).status, 409)

  await hook('Stop')
  assert.equal((await snapshot()).desks[1].isRunning, false)
  assert.equal((await post('/api/action', { action: 'delete', sessionId: id })).status, 400)
  assert.equal((await post('/api/action', { action: 'archive', sessionId: id }, false)).status, 403)
  assert.equal((await post('/api/action', { action: 'archive', sessionId: id })).status, 502)
  assert.equal((await snapshot()).desks[1].id, id)
  assert.equal((await post('/api/action', { action: 'delete', sessionId: claudeDesk.id })).status, 400)
  assert.equal((await post('/api/action', { action: 'archive', sessionId: claudeDesk.id })).status, 202)
  await hook('UserPromptSubmit')
  await hook('Interrupt')
  assert.equal((await snapshot()).desks[1].isRunning, false)
  await hook('SessionEnd')
  assert.deepEqual((await snapshot()).desks, [claudeDesk])
  await hook('SessionStart', turnId, 'C:\\Users\\demo\\Documents\\Codex\\2026-11-11\\te')
  assert.equal((await snapshot()).desks[1].project, '')
  await hook('SessionEnd')
  assert.equal((await post('/api/codex/event', { name: 'SessionStart', id: turnId, project: '' })).status, 204)
  assert.equal((await snapshot()).desks[1].title, null)

  assert.equal((await post('/api/codex/event', { name: 'SessionStart', id, project: '' }, false)).status, 403)
  assert.equal((await post('/api/codex/event', { name: 'SessionStart', id: 'bad', project: '' })).status, 400)
  assert.equal((await post('/api/action', { action: 'stop', sessionId: id })).status, 400)
  assert.equal((await post('/api/open', { link: `codex://threads/${id}?other=1` })).status, 400)
})
