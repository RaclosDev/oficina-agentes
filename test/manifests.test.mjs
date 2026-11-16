import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const json = async path => JSON.parse(await read(path))

test('los manifiestos comparten nombre y versión', async () => {
  const pkg = await json('package.json')
  const claude = await json('.claude-plugin/plugin.json')
  const codex = await json('.codex-plugin/plugin.json')
  const claudeMarket = await json('.claude-plugin/marketplace.json')
  const codexMarket = await json('.agents/plugins/marketplace.json')

  for (const manifest of [claude, codex]) {
    assert.equal(manifest.name, pkg.name)
    assert.equal(manifest.version, pkg.version)
    assert.equal(manifest.license, pkg.license)
  }
  for (const market of [claudeMarket, codexMarket]) {
    assert.equal(market.name, pkg.name)
    assert.deepEqual(market.plugins.map(plugin => plugin.name), [pkg.name])
  }
  assert.ok((await read('codex/threads.mjs')).includes(`version: '${pkg.version}'`))
})

test('los hooks de Codex apuntan a archivos que existen', async () => {
  const { hooks } = await json('codex/hooks.json')
  const commands = Object.values(hooks).flat().flatMap(entry => entry.hooks.map(hook => hook.command))
  assert.ok(commands.length > 0)
  for (const command of commands) {
    const [, path] = /\$\{PLUGIN_ROOT\}\/([^"]+)/.exec(command) ?? []
    assert.ok(path, command)
    await read(path)
  }
})
