import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { codexEvent } from './session.mjs'

const serverPath = fileURLToPath(new URL('../server/server.mjs', import.meta.url))

function sendEvent(event) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port: Number(process.env.OFICINA_PORT ?? 3210),
      path: '/api/codex/event',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-oficina': '1' },
      signal: AbortSignal.timeout(600),
    }, res => {
      res.resume()
      resolve()
    })
    req.on('error', reject)
    req.end(JSON.stringify(event))
  })
}

async function report(event) {
  try {
    await sendEvent(event)
    return
  } catch (error) {
    if (error.code !== 'ECONNREFUSED' || event.name === 'SessionEnd') return
  }

  const server = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  server.on('error', () => {})
  server.unref()

  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(75)
    try {
      await sendEvent(event)
      return
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') return
    }
  }
}

try {
  process.stdin.setEncoding('utf8')
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const payload = JSON.parse(input)
  if (payload?.hook_event_name === 'Stop') process.stdout.write('{}')
  const event = codexEvent(payload)
  if (event) await report(event)
} catch {
  // La oficina es opcional. Si falla, el turno continúa.
}
