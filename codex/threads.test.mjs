import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
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
})
