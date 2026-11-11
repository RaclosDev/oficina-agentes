import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { connect } from 'node:net'
import { isCodexId } from './session.mjs'

const MAX_FRAME_BYTES = 8 * 1024 * 1024

async function desktopPipe() {
  if (process.env.CODEX_APP_TOOLS_PIPE_PATH) return process.env.CODEX_APP_TOOLS_PIPE_PATH
  if (process.platform !== 'win32') return null
  try {
    const pipes = (await readdir('\\\\.\\pipe\\')).filter(name => /^codex-app-tools-[\w-]+$/.test(name))
    // Con varias instancias no se puede deducir cuál pertenece al usuario del chat.
    return pipes.length === 1 ? `\\\\.\\pipe\\${pipes[0]}` : null
  } catch {
    return null
  }
}

export async function manageInDesktop(threadId, action, callerThreadId) {
  if (!isCodexId(callerThreadId)) return null
  const pipe = await desktopPipe()
  if (!pipe) return null
  const tool = action === 'archive' ? 'set_thread_archived' : 'delete_thread'
  try {
    const result = await callDesktopTool(pipe, callerThreadId, tool,
      action === 'archive' ? { threadId, archived: true } : { threadId })
    return result.success === true
      ? { status: 'ok' }
      : { status: 'failed', message: result.contentItems?.filter(item => item.type === 'inputText').map(item => item.text).join('\n').slice(0, 400) || 'Codex no confirmó la acción.' }
  } catch (error) {
    // No repetir por otro canal: la app puede haber ejecutado ya la operación.
    return { status: 'failed', message: error.message }
  }
}

// Protocolo del conector codex-app-tools incluido con la app: JSON-RPC con
// longitud little-endian. Se conservan sus permisos y su confirmación de borrado.
export function callDesktopTool(pipe, callerThreadId, tool, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const socket = connect(pipe)
    let buffer = Buffer.alloc(0)
    let requestId = 1
    let finished = false
    const timer = setTimeout(() => {
      send({ jsonrpc: '2.0', id: requestId, method: 'tools/cancel' })
      finish(new Error('Codex no confirmó la acción a tiempo. Comprueba el chat antes de repetirla.'))
    }, timeoutMs)

    function finish(error, result) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    function send(message) {
      if (socket.destroyed) return
      const body = Buffer.from(JSON.stringify(message))
      const header = Buffer.alloc(4)
      header.writeUInt32LE(body.length)
      socket.write(Buffer.concat([header, body]))
    }
    socket.once('connect', () => send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { threadStartKind: 'all' } }))
    socket.on('error', error => finish(error))
    socket.on('close', () => finish(new Error('Se cerró la conexión con Codex. Comprueba el chat antes de repetir la acción.')))
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      while (!finished && buffer.length >= 4) {
        const size = buffer.readUInt32LE(0)
        if (size > MAX_FRAME_BYTES) return finish(new Error('Respuesta de Codex demasiado grande.'))
        if (buffer.length < size + 4) return
        let message
        try { message = JSON.parse(buffer.subarray(4, size + 4).toString()) }
        catch { return finish(new Error('Respuesta de Codex no válida.')) }
        buffer = buffer.subarray(size + 4)
        if (message.id !== requestId) continue
        if (message.error) return finish(new Error(message.error.message || 'Codex rechazó la acción.'))
        if (requestId === 2) return finish(null, message.result)
        const definition = message.result?.tools?.find(item => item.name === tool)
        if (!definition?.namespace) return finish(new Error('Esta versión de Codex no ofrece la acción solicitada.'))
        requestId = 2
        send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
          namespace: definition.namespace, tool, arguments: args,
          callerSource: 'codex', threadId: callerThreadId,
          hostId: process.env.CODEX_APP_TOOLS_CALLER_HOST_ID,
          callId: `oficina-${randomUUID()}`, turnId: `mcp-turn-${randomUUID()}`,
        } })
      }
    })
  })
}
