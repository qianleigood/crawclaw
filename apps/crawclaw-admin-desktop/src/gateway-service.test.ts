import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runGatewayServiceBootstrap } from './gateway-service.js'

void test('runGatewayServiceBootstrap installs and starts the bundled Gateway service', () => {
  const calls: unknown[] = []

  runGatewayServiceBootstrap({
    nodePath: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/bin/node',
    runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
    stateDir: '/Users/test/.crawclaw',
    authToken: 'desktop-token',
    baseEnv: {},
    spawnSyncImpl(file, args, options) {
      calls.push({ file, args, cwd: options?.cwd, env: options?.env })
      return { status: 0, signal: null, stdout: '{"ok":true}\n', stderr: '' }
    },
  })

  assert.deepEqual(calls, [
    {
      file: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/bin/node',
      args: [
        '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/crawclaw.mjs',
        'gateway',
        'install',
        '--force',
        '--runtime',
        'node',
        '--runtime-entry',
        '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/crawclaw.mjs',
        '--token',
        'desktop-token',
        '--json',
      ],
      cwd: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        CRAWCLAW_STATE_DIR: '/Users/test/.crawclaw',
        CRAWCLAW_DESKTOP_RUNTIME_ROOT:
          '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
        CRAWCLAW_PLUGIN_RUNTIMES_DIR:
          '/Users/test/.crawclaw/runtimes:/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/runtimes',
        CRAWCLAW_GATEWAY_TOKEN: 'desktop-token',
      },
    },
    {
      file: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/bin/node',
      args: [
        '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/crawclaw.mjs',
        'gateway',
        'start',
        '--json',
      ],
      cwd: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        CRAWCLAW_STATE_DIR: '/Users/test/.crawclaw',
        CRAWCLAW_DESKTOP_RUNTIME_ROOT:
          '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
        CRAWCLAW_PLUGIN_RUNTIMES_DIR:
          '/Users/test/.crawclaw/runtimes:/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/runtimes',
        CRAWCLAW_GATEWAY_TOKEN: 'desktop-token',
      },
    },
  ])
})
