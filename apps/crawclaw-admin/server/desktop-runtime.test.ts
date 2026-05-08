import { describe, expect, it } from 'vitest'
import {
  buildDesktopRuntimeActionCommand,
  buildDesktopRuntimeCommand,
  buildDesktopRuntimeEnv,
  parseDesktopRuntimeJson,
  runDesktopRuntimeAction,
} from './desktop-runtime.js'

describe('desktop runtime control', () => {
  it('builds commands against the embedded CrawClaw runtime entrypoint', () => {
    const command = buildDesktopRuntimeCommand({
      runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      nodePath: '/usr/local/bin/node',
      args: ['gateway', 'status', '--json'],
    })

    expect(command).toEqual({
      file: '/usr/local/bin/node',
      args: [
        '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/crawclaw.mjs',
        'gateway',
        'status',
        '--json',
      ],
      cwd: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
    })
  })

  it('uses ~/.crawclaw as the managed runtime state dir instead of Electron userData', () => {
    const env = buildDesktopRuntimeEnv({
      baseEnv: { HOME: '/Users/ada', CRAWCLAW_STATE_DIR: '/Users/ada/.crawclaw' },
      runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      authToken: 'desktop-token',
    })

    expect(env.CRAWCLAW_STATE_DIR).toBe('/Users/ada/.crawclaw')
    expect(env.CRAWCLAW_CONFIG_PATH).toBeUndefined()
    expect(env.CRAWCLAW_GATEWAY_TOKEN).toBe('desktop-token')
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.CRAWCLAW_DESKTOP_RUNTIME_ROOT).toBe('/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw')
    expect(env.CRAWCLAW_PLUGIN_RUNTIMES_DIR).toBe('/Users/ada/.crawclaw/runtimes:/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/runtimes')
  })

  it('builds service install commands against the embedded runtime entrypoint', () => {
    const command = buildDesktopRuntimeActionCommand({
      runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      nodePath: '/usr/local/bin/node',
      action: 'bootstrap',
      authToken: 'desktop-token',
    })

    expect(command.args).toEqual([
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
    ])
  })

  it('runs desktop runtime actions through the embedded runtime command', () => {
    const calls: unknown[] = []
    const result = runDesktopRuntimeAction({
      runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      nodePath: '/usr/local/bin/node',
      action: 'status',
      baseEnv: { HOME: '/Users/ada' },
      spawnSyncImpl(file, args, options) {
        calls.push({ file, args, cwd: options?.cwd, env: options?.env })
        return { status: 0, signal: null, stdout: '{"ok":true,"service":"running"}\n', stderr: '' }
      },
    })

    expect(result).toEqual({ ok: true, service: 'running' })
    expect(calls).toEqual([
      expect.objectContaining({
        file: '/usr/local/bin/node',
        args: [
          '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/crawclaw.mjs',
          'gateway',
          'status',
          '--json',
        ],
        cwd: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      }),
    ])
  })

  it('parses json output from desktop runtime commands', () => {
    expect(parseDesktopRuntimeJson('noise\n{"ok":true,"state":"running"}\n')).toEqual({
      ok: true,
      state: 'running',
    })
  })

  it('parses pretty json output from desktop runtime commands', () => {
    expect(parseDesktopRuntimeJson([
      '[gateway] status snapshot',
      '{',
      '  "service": {',
      '    "runtime": {',
      '      "status": "running",',
      '      "detail": "brace in string: }"',
      '    }',
      '  }',
      '}',
      '[gateway] done',
    ].join('\n'))).toEqual({
      service: {
        runtime: {
          status: 'running',
          detail: 'brace in string: }',
        },
      },
    })
  })
})
