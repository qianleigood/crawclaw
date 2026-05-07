import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadDesktopConfig, saveDesktopConfig, type DesktopConfig } from './config-store.js'

void test('desktop config writes non-sensitive connection values only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crawclaw-admin-desktop-config-'))
  try {
    const configPath = join(dir, 'config.json')
    const config: DesktopConfig & Record<string, unknown> = {
      activeProfileId: 'local',
      gatewayWsUrl: 'ws://gateway.local:18789',
      locale: 'zh-CN',
      theme: 'dark',
      hermesWebUrl: 'https://hermes.example.test',
      hermesApiUrl: 'https://hermes-api.example.test',
      CRAWCLAW_AUTH_TOKEN: 'secret-token',
      CRAWCLAW_AUTH_PASSWORD: 'secret-password',
      HERMES_API_KEY: 'secret-hermes-key',
    }

    await saveDesktopConfig(configPath, config)

    const raw = await readFile(configPath, 'utf-8')
    assert.equal(raw.includes('secret-token'), false)
    assert.equal(raw.includes('secret-password'), false)
    assert.equal(raw.includes('secret-hermes-key'), false)
    assert.deepEqual(await loadDesktopConfig(configPath), {
      activeProfileId: 'local',
      gatewayWsUrl: 'ws://gateway.local:18789',
      locale: 'zh-CN',
      theme: 'dark',
      hermesWebUrl: 'https://hermes.example.test',
      hermesApiUrl: 'https://hermes-api.example.test',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
