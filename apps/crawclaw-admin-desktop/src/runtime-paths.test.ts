import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveCrawClawStateDir, resolveDesktopNodePath, resolveDesktopRuntimeRoot } from './runtime-paths.js'

void test('resolveDesktopRuntimeRoot uses packaged extraResources runtime path', () => {
  assert.equal(
    resolveDesktopRuntimeRoot({
      isPackaged: true,
      resourcesPath: '/Applications/CrawClaw Desktop.app/Contents/Resources',
      moduleDir: '/Applications/CrawClaw Desktop.app/Contents/Resources/app.asar/dist',
      env: {},
    }),
    '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw'
  )
})

void test('resolveDesktopRuntimeRoot uses the staged development runtime path', () => {
  assert.equal(
    resolveDesktopRuntimeRoot({
      isPackaged: false,
      resourcesPath: '/unused',
      moduleDir: '/repo/apps/crawclaw-admin-desktop/dist',
      env: {},
    }),
    '/repo/apps/crawclaw-admin-desktop/.runtime/crawclaw'
  )
})

void test('resolveCrawClawStateDir keeps CrawClaw runtime state outside Electron userData', () => {
  assert.equal(resolveCrawClawStateDir({ HOME: '/Users/ada' }), '/Users/ada/.crawclaw')
  assert.equal(
    resolveCrawClawStateDir({ CRAWCLAW_STATE_DIR: '/var/crawclaw', HOME: '/Users/ada' }),
    '/var/crawclaw'
  )
})

void test('resolveDesktopNodePath uses the bundled Node runtime', () => {
  assert.equal(
    resolveDesktopNodePath({
      runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      env: {},
      platform: 'darwin',
    }),
    '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/bin/node'
  )
})
