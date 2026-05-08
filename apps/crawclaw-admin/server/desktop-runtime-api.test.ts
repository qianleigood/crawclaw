import { describe, expect, it } from 'vitest'
import {
  listDesktopOptionalRuntimes,
  runDesktopRuntimeApiAction,
} from './desktop-runtime-api.js'

describe('desktop runtime API', () => {
  it('rejects runtime actions outside desktop-local mode', () => {
    expect(() =>
      runDesktopRuntimeApiAction({
        envConfig: { desktopLocal: false },
        action: 'status',
        baseEnv: {},
        nodePath: '/usr/local/bin/node',
        runAction() {
          return {}
        },
      }),
    ).toThrow(/desktop-local mode/)
  })

  it('passes desktop-local runtime credentials through the embedded runtime command layer', () => {
    const calls: unknown[] = []
    const result = runDesktopRuntimeApiAction({
      envConfig: {
        desktopLocal: true,
        CRAWCLAW_DESKTOP_RUNTIME_ROOT: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
        CRAWCLAW_AUTH_TOKEN: 'desktop-token',
      },
      action: 'logs.tail',
      body: { sinceMs: 1000 },
      baseEnv: { HOME: '/Users/ada' },
      nodePath: '/usr/local/bin/node',
      runAction(params) {
        calls.push(params)
        return { ok: true, lines: [] }
      },
    })

    expect(result).toEqual({ ok: true, lines: [] })
    expect(calls).toEqual([
      expect.objectContaining({
        runtimeRoot: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
        authToken: 'desktop-token',
        action: 'logs.tail',
        logsParams: { sinceMs: 1000 },
      }),
    ])
  })

  it('maps desktop optional runtime status from runtime list output', () => {
    const runtimes = listDesktopOptionalRuntimes({
      envConfig: {
        desktopLocal: true,
        CRAWCLAW_DESKTOP_RUNTIME_ROOT: '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw',
      },
      baseEnv: { HOME: '/Users/ada' },
      nodePath: '/usr/local/bin/node',
      runAction() {
        return {
          manifest: {
            plugins: {
              n8n: { state: 'healthy', version: '2.18.5' },
              'qwen3-tts': { state: 'unavailable', reason: 'missing-python' },
            },
          },
        }
      },
    })

    expect(runtimes.map((runtime) => ({ id: runtime.id, installed: runtime.installed, state: runtime.state }))).toEqual([
      { id: 'n8n', installed: true, state: 'healthy' },
      { id: 'skill-openai-whisper', installed: false, state: 'not-installed' },
      { id: 'qwen3-tts', installed: false, state: 'unavailable' },
    ])
  })
})
