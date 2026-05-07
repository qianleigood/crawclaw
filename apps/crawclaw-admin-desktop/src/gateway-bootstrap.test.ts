import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootstrapLocalGatewayConfig } from './gateway-bootstrap.js'

void test('desktop bootstrap creates a local Gateway config with online reload defaults', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'crawclaw-desktop-gateway-'))
  try {
    const result = await bootstrapLocalGatewayConfig({
      stateDir,
      tokenFactory: () => 'desktop-token',
    })
    const raw = await readFile(join(stateDir, 'crawclaw.json'), 'utf-8')
    const config = JSON.parse(raw) as Record<string, unknown>

    assert.equal(result.port, 18789)
    assert.equal(result.wsUrl, 'ws://127.0.0.1:18789')
    assert.equal(result.authToken, 'desktop-token')
    assert.deepEqual(config, {
      gateway: {
        mode: 'local',
        bind: 'loopback',
        port: 18789,
        reload: { mode: 'hybrid' },
        auth: { mode: 'token', token: 'desktop-token' },
      },
    })
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})

void test('desktop bootstrap fills missing Gateway defaults without overwriting user config', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'crawclaw-desktop-gateway-'))
  try {
    const result = await bootstrapLocalGatewayConfig({
      stateDir,
      initialConfig: {
        gateway: {
          mode: 'local',
          bind: 'custom',
          customBindHost: '127.0.0.2',
          port: 19001,
          auth: { mode: 'password' },
        },
      },
      tokenFactory: () => 'unused-token',
    })
    const raw = await readFile(join(stateDir, 'crawclaw.json'), 'utf-8')
    const config = JSON.parse(raw) as Record<string, unknown>

    assert.equal(result.port, 19001)
    assert.equal(result.wsUrl, 'ws://127.0.0.1:19001')
    assert.equal(result.authToken, undefined)
    assert.deepEqual(config, {
      gateway: {
        mode: 'local',
        bind: 'custom',
        customBindHost: '127.0.0.2',
        port: 19001,
        auth: { mode: 'password' },
        reload: { mode: 'hybrid' },
      },
    })
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
})
