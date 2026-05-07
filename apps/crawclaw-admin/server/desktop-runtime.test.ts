import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDesktopRuntimeCommand,
  buildDesktopRuntimeEnv,
  parseDesktopRuntimeJson,
} from './desktop-runtime.js'

describe('desktop-runtime helpers', () => {
  it('builds bundled CrawClaw runtime commands without using global PATH', () => {
    const runtimeRoot = '/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw'
    const command = buildDesktopRuntimeCommand({
      runtimeRoot,
      nodePath: '/usr/local/bin/node',
      args: ['gateway', 'status', '--json'],
    })

    expect(command).toEqual({
      file: '/usr/local/bin/node',
      args: [join(runtimeRoot, 'crawclaw.mjs'), 'gateway', 'status', '--json'],
      cwd: runtimeRoot,
    })
  })

  it('sets desktop runtime env without leaking admin config paths into Gateway config', () => {
    const env = buildDesktopRuntimeEnv({
      runtimeRoot: '/opt/crawclaw/runtime',
      authToken: 'desktop-token',
      baseEnv: {
        CRAWCLAW_CONFIG_PATH: '/tmp/admin.env',
        CRAWCLAW_STATE_DIR: '/Users/test/.crawclaw',
      },
    })

    expect(env.CRAWCLAW_DESKTOP_RUNTIME_ROOT).toBe('/opt/crawclaw/runtime')
    expect(env.CRAWCLAW_STATE_DIR).toBe('/Users/test/.crawclaw')
    expect(env.CRAWCLAW_GATEWAY_TOKEN).toBe('desktop-token')
    expect(env.CRAWCLAW_CONFIG_PATH).toBeUndefined()
  })

  it('parses the last JSON object from noisy runtime output', () => {
    expect(parseDesktopRuntimeJson('starting\n{"ok":false}\nnoise\n{"ok":true,"pid":123}\n')).toEqual({
      ok: true,
      pid: 123,
    })
  })
})
