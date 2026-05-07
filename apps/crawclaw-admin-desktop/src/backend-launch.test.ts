import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBackendEnv, type DesktopGatewayConfig } from './backend-launch.js'
import type { DesktopAppPaths } from './app-paths.js'

const paths: DesktopAppPaths = {
  stateDir: '/Users/test/Library/Application Support/CrawClaw Desktop',
  configPath: '/Users/test/Library/Application Support/CrawClaw Desktop/config.json',
  backendConfigPath: '/Users/test/Library/Application Support/CrawClaw Desktop/admin.env',
  dataDir: '/Users/test/Library/Application Support/CrawClaw Desktop/data',
  backupDir: '/Users/test/Library/Application Support/CrawClaw Desktop/backups',
  logDir: '/Users/test/Library/Application Support/CrawClaw Desktop/logs',
  runtimeDir: '/Users/test/Library/Application Support/CrawClaw Desktop/runtime',
}

void test('desktop backend env enters local runtime mode without remote Gateway profiles', () => {
  const gateway: DesktopGatewayConfig = {
    wsUrl: 'ws://127.0.0.1:18789',
    authToken: 'desktop-token',
    authPassword: undefined,
    runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
    crawclawStateDir: '/Users/test/.crawclaw',
    nodePath: '/Applications/CrawClaw Desktop.app/Contents/MacOS/CrawClaw Desktop',
    locale: 'zh-CN',
  }

  const env = buildBackendEnv(paths, gateway, 4001, {
    CRAWCLAW_WS_URL: 'ws://remote.example.test:18789',
    CRAWCLAW_AUTH_PASSWORD: 'remote-password',
    HERMES_WEB_URL: 'http://localhost:9119',
  })

  assert.equal(env.CRAWCLAW_ADMIN_RUNTIME_MODE, 'desktop')
  assert.equal(env.CRAWCLAW_ADMIN_DESKTOP_LOCAL, '1')
  assert.equal(env.CRAWCLAW_DESKTOP_RUNTIME_ROOT, gateway.runtimeRoot)
  assert.equal(env.CRAWCLAW_DESKTOP_NODE_PATH, gateway.nodePath)
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(env.CRAWCLAW_STATE_DIR, '/Users/test/.crawclaw')
  assert.equal(env.CRAWCLAW_WS_URL, 'ws://127.0.0.1:18789')
  assert.equal(env.CRAWCLAW_AUTH_TOKEN, 'desktop-token')
  assert.equal(env.CRAWCLAW_AUTH_PASSWORD, '')
  assert.equal(env.HERMES_WEB_URL, undefined)
})
