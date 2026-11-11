import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { callDesktopTool } from './desktop.mjs'

const caller = '11111111-1111-1111-1111-111111111111'
const target = '22222222-2222-2222-2222-222222222222'

async function fixture(t, onRequest) {
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\oficina-test-${randomUUID()}` : join(tmpdir(), `oficina-${randomUUID()}.sock`)
  const sockets = new Set()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buffer = Buffer.alloc(0)
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data])
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const size = buffer.readUInt32LE(0)
        const request = JSON.parse(buffer.subarray(4, size + 4))
        buffer = buffer.subarray(size + 4)
        onRequest(request, result => {
          const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
          const header = Buffer.alloc(4)
          header.writeUInt32LE(body.length)
          socket.write(header.subarray(0, 2))
          socket.write(Buffer.concat([header.subarray(2), body]))
        })
      }
    })
  })
  server.listen(pipe)
  await once(server, 'listening')
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close() })
  return pipe
}

test('la app propietaria recibe ambas acciones con el chat de origen y mantiene sus confirmaciones', async t => {
  const calls = []
  const pipe = await fixture(t, (request, reply) => {
    if (request.method === 'tools/list') return reply({ tools: [
      { name: 'set_thread_archived', namespace: 'codex_app' },
      { name: 'delete_thread', namespace: 'codex_app' },
    ] })
    calls.push(request.params)
    reply(request.params.tool === 'delete_thread'
      ? { success: false, contentItems: [{ type: 'inputText', text: 'Borrado cancelado por el usuario.' }] }
      : { success: true, contentItems: [] })
  })
  assert.equal((await callDesktopTool(pipe, caller, 'set_thread_archived', { threadId: target, archived: true })).success, true)
  assert.equal((await callDesktopTool(pipe, caller, 'delete_thread', { threadId: target })).success, false)
  assert.deepEqual(calls.map(call => [call.threadId, call.tool, call.arguments]), [
    [caller, 'set_thread_archived', { threadId: target, archived: true }],
    [caller, 'delete_thread', { threadId: target }],
  ])
  assert.equal(calls[1].arguments.confirmed, undefined)
})

test('una respuesta incierta no se reintenta y cancela la llamada pendiente', async t => {
  const methods = []
  const pipe = await fixture(t, (request, reply) => {
    methods.push(request.method)
    if (request.method === 'tools/list') reply({ tools: [{ name: 'delete_thread', namespace: 'codex_app' }] })
  })
  await assert.rejects(callDesktopTool(pipe, caller, 'delete_thread', { threadId: target }, 100), /Comprueba el chat/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(methods.filter(method => method === 'tools/call').length, 1)
  assert.ok(methods.includes('tools/cancel'))
})
