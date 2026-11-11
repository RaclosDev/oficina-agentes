import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { manageCodexThread } from './threads.mjs'

test('un escritor de Codex bloquea archivar y eliminar sin declarar éxito', async t => {
  const threadId = '11111111-1111-1111-1111-111111111111'
  const requests = []
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stdin = new PassThrough()
    child.kill = () => {
      child.stdin.destroy()
      child.stdout.destroy()
    }
    child.stdin.on('data', data => {
      const request = JSON.parse(data.toString())
      requests.push(request.method)
      if (!request.id) return
      const response = request.method === 'thread/read'
        ? { result: { thread: { id: threadId, cwd: 'C:\\code\\repo', updatedAt: 1794352073, status: { type: 'notLoaded' } } } }
        : request.id === 3
          ? { error: { code: -32600, message: `thread ${threadId} already has an active writer` } }
          : { result: {} }
      queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, ...response }) + '\n'))
    })
    return child
  })
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  })

  for (const action of ['archive', 'delete']) {
    const result = await manageCodexThread(threadId, action, () => false)
    assert.equal(result.status, 'locked')
    assert.match(result.message, /already has an active writer/)
  }
  assert.deepEqual(requests, [
    'initialize', 'initialized', 'thread/read', 'thread/archive',
    'initialize', 'initialized', 'thread/read', 'thread/delete',
  ])

  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\oficina-test-${randomUUID()}` : join(tmpdir(), `oficina-${randomUUID()}.sock`)
  const nativeCalls = []
  const sockets = new Set()
  const desktop = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buffer = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const length = buffer.readUInt32LE(0)
        const request = JSON.parse(buffer.subarray(4, length + 4))
        buffer = buffer.subarray(length + 4)
        if (request.method === 'tools/call') nativeCalls.push(request.params.tool)
        const result = request.method === 'tools/list'
          ? { tools: ['set_thread_archived', 'delete_thread'].map(name => ({ name, namespace: 'codex_app' })) }
          : { success: request.params.tool !== 'delete_thread', contentItems: [{ type: 'inputText', text: 'Cancelado' }] }
        const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
        const header = Buffer.alloc(4)
        header.writeUInt32LE(body.length)
        socket.write(Buffer.concat([header, body]))
      }
    })
  })
  desktop.listen(pipe)
  await once(desktop, 'listening')
  const previousPipe = process.env.CODEX_APP_TOOLS_PIPE_PATH
  process.env.CODEX_APP_TOOLS_PIPE_PATH = pipe
  t.after(() => {
    if (previousPipe === undefined) delete process.env.CODEX_APP_TOOLS_PIPE_PATH
    else process.env.CODEX_APP_TOOLS_PIPE_PATH = previousPipe
    for (const socket of sockets) socket.destroy()
    desktop.close()
  })
  requests.length = 0
  assert.equal((await manageCodexThread(threadId, 'archive', () => false, threadId)).status, 'ok')
  assert.equal((await manageCodexThread(threadId, 'delete', () => false, threadId)).status, 'failed')
  assert.equal((await manageCodexThread(threadId, 'archive', () => true, threadId)).status, 'busy')
  assert.deepEqual(nativeCalls, ['set_thread_archived', 'delete_thread'])
  assert.ok(!requests.includes('thread/archive') && !requests.includes('thread/delete'))
})
