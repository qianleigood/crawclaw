import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootstrapLocalGatewayConfig } from './gateway-bootstrap.js'

void test('bootstrapLocalGatewayConfig creates local gateway config without desktop config secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crawclaw-desktop-bootstrap-'))
  try {
    const stateDir = join(dir, '.crawclaw')
    const result = await bootstrapLocalGatewayConfig({
      stateDir,
      tokenFactory: () => 'desktop-token',
    })

    assert.equal(result.changed, true)
    assert.equal(result.port, 18789)
    assert.equal(result.wsUrl, 'ws://127.0.0.1:18789')
    assert.equal(result.authToken, 'desktop-token')

    const raw = await readFile(join(stateDir, 'crawclaw.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    assert.deepEqual(parsed.gateway, {
      mode: 'local',
      bind: 'loopback',
      port: 18789,
      reload: { mode: 'hybrid' },
      auth: { mode: 'token', token: 'desktop-token' },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

void test('bootstrapLocalGatewayConfig preserves existing user gateway values and only fills missing desktop defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crawclaw-desktop-bootstrap-existing-'))
  try {
    const stateDir = join(dir, '.crawclaw')
    const configPath = join(stateDir, 'crawclaw.json')
    await bootstrapLocalGatewayConfig({
      stateDir,
      initialConfig: {
        gateway: {
          mode: 'local',
          bind: 'custom',
          customBindHost: '127.0.0.2',
          port: 19001,
          auth: { mode: 'password', password: 'user-password' },
        },
      },
      tokenFactory: () => 'unused-token',
    })

    const parsed = JSON.parse(await readFile(configPath, 'utf-8'))
    assert.equal(parsed.gateway.bind, 'custom')
    assert.equal(parsed.gateway.customBindHost, '127.0.0.2')
    assert.equal(parsed.gateway.port, 19001)
    assert.deepEqual(parsed.gateway.auth, { mode: 'password', password: 'user-password' })
    assert.deepEqual(parsed.gateway.reload, { mode: 'hybrid' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

void test('bootstrapLocalGatewayConfig returns existing password auth material for the local backend', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crawclaw-desktop-bootstrap-password-'))
  try {
    const stateDir = join(dir, '.crawclaw')
    const result = await bootstrapLocalGatewayConfig({
      stateDir,
      initialConfig: {
        gateway: {
          auth: { mode: 'password', password: 'user-password' },
        },
      },
    })

    assert.equal(result.authToken, undefined)
    assert.equal(result.authPassword, 'user-password')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
