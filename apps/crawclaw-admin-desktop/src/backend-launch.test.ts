import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBackendEnv } from './backend-launch.js'
import type { DesktopAppPaths } from './app-paths.js'

const paths: DesktopAppPaths = {
  stateDir: '/desktop/user-data',
  configPath: '/desktop/user-data/config.json',
  backendConfigPath: '/desktop/user-data/admin.env',
  dataDir: '/desktop/user-data/data',
  backupDir: '/desktop/user-data/backups',
  logDir: '/desktop/user-data/logs',
  runtimeDir: '/desktop/user-data/runtime',
}

void test('buildBackendEnv starts admin backend in desktop-local mode with embedded runtime and CrawClaw state dir', () => {
  const env = buildBackendEnv(paths, {
    wsUrl: 'ws://127.0.0.1:18789',
    authToken: 'desktop-token',
    locale: 'zh-CN',
    runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
    nodePath: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/bin/node',
    crawclawStateDir: '/Users/test/.crawclaw',
  }, 51234)

  assert.equal(env.CRAWCLAW_ADMIN_RUNTIME_MODE, 'desktop')
  assert.equal(env.CRAWCLAW_ADMIN_DESKTOP_LOCAL, '1')
  assert.equal(env.CRAWCLAW_DESKTOP_RUNTIME_ROOT, '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw')
  assert.equal(env.CRAWCLAW_DESKTOP_NODE_PATH, '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/bin/node')
  assert.equal(env.CRAWCLAW_PLUGIN_RUNTIMES_DIR, '/Users/test/.crawclaw/runtimes:/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/runtimes')
  assert.equal(env.CRAWCLAW_N8N_BIN, undefined)
  assert.equal(env.CRAWCLAW_STATE_DIR, '/Users/test/.crawclaw')
  assert.equal(env.CRAWCLAW_WS_URL, 'ws://127.0.0.1:18789')
  assert.equal(env.CRAWCLAW_AUTH_TOKEN, 'desktop-token')
  assert.equal(env.CRAWCLAW_AUTH_PASSWORD, '')
})
