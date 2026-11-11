import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

let worker
let nextId = 0
const pending = new Map()
const script = fileURLToPath(new URL('./pin.ps1', import.meta.url))

export function windowCommand(command) {
  if (process.platform !== 'win32') return Promise.resolve(false)
  if (!worker) {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ControlServer'], { windowsHide: true })
    worker = child
    const lines = createInterface({ input: child.stdout })
    child.stderr.resume()
    lines.on('line', line => {
      try {
        const result = JSON.parse(line)
        pending.get(result.id)?.(result.ok === true)
      } catch { /* PowerShell puede enviar diagnósticos antes de iniciar el control. */ }
    })
    const failed = () => {
      if (worker !== child) return
      worker = undefined
      lines.close()
      for (const finish of [...pending.values()]) finish(false)
    }
    child.on('error', failed)
    child.on('exit', failed)
    child.stdin.on('error', failed)
  }
  return new Promise(resolve => {
    const id = ++nextId
    const timer = setTimeout(() => finish(false), 20_000)
    function finish(ok) {
      clearTimeout(timer)
      pending.delete(id)
      resolve(ok)
    }
    pending.set(id, finish)
    worker.stdin.write(JSON.stringify({ id, ...command }) + '\n')
  })
}

process.once('exit', () => worker?.kill())
