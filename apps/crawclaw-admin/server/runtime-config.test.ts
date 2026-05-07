import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAdminRuntimeConfig } from './runtime-config.js'

const tempDirs: string[] = []
const defaultEnvRestores: Array<() => void> = []
const defaultEnvPath = fileURLToPath(new URL('../.env', import.meta.url))
const legacyPrefix = ['OPEN', 'CLAW'].join('')

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'crawclaw-admin-runtime-'))
  tempDirs.push(dir)
  return dir
}

function writeEnvFile(content: string) {
  const envPath = join(makeTempDir(), '.env')
  writeFileSync(envPath, content, 'utf-8')
  return envPath
}

function writeDefaultEnvFile(content: string) {
  const hadOriginal = existsSync(defaultEnvPath)
  const originalContent = hadOriginal ? readFileSync(defaultEnvPath, 'utf-8') : ''
  writeFileSync(defaultEnvPath, content, 'utf-8')
  defaultEnvRestores.push(() => {
    if (hadOriginal) {
      writeFileSync(defaultEnvPath, originalContent, 'utf-8')
    } else if (existsSync(defaultEnvPath)) {
      unlinkSync(defaultEnvPath)
    }
  })
}

afterEach(() => {
  while (defaultEnvRestores.length > 0) {
    defaultEnvRestores.pop()!()
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('loadAdminRuntimeConfig', () => {
  it('reads web mode values from the admin .env file', () => {
    const envPath = writeEnvFile([
      'PORT=4123',
      `${legacyPrefix}_WS_URL=ws://legacy-gateway:18789`,
      'CRAWCLAW_AUTH_TOKEN=file-token',
      'AUTH_USERNAME=admin',
      'LOG_LEVEL=DEBUG',
    ].join('\n'))

    const config = loadAdminRuntimeConfig(
      { HOME: '/tmp/home', PORT: '9999', CRAWCLAW_WS_URL: 'ws://process-env:18789' },
      { envPath, platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(config.paths.runtimeMode).toBe('web')
    expect(config.port).toBe(4123)
    expect(config.bindHost).toBe('0.0.0.0')
    expect(config.crawclawWsUrl).toBe('ws://legacy-gateway:18789')
    expect(config.crawclawAuthToken).toBe('file-token')
    expect(config.authUsername).toBe('admin')
    expect(config.logLevel).toBe('DEBUG')
  })

  it('reads web mode values from the default admin .env path', () => {
    writeDefaultEnvFile([
      'PORT=4455',
      'CRAWCLAW_WS_URL=ws://default-env-gateway:18789',
      'CRAWCLAW_AUTH_TOKEN=default-token',
    ].join('\n'))

    const config = loadAdminRuntimeConfig({
      HOME: '/tmp/home',
      PORT: '9999',
      CRAWCLAW_WS_URL: 'ws://process-env:18789',
    })

    expect(config.envPath).toBe(defaultEnvPath)
    expect(config.port).toBe(4455)
    expect(config.crawclawWsUrl).toBe('ws://default-env-gateway:18789')
    expect(config.crawclawAuthToken).toBe('default-token')
  })

  it('reads desktop mode values from CRAWCLAW_ADMIN env without requiring .env', () => {
    const missingEnvPath = join(makeTempDir(), 'missing.env')

    const config = loadAdminRuntimeConfig(
      {
        CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
        CRAWCLAW_ADMIN_PORT: '5123',
        CRAWCLAW_ADMIN_BIND_HOST: '127.0.0.2',
        CRAWCLAW_ADMIN_STATE_DIR: '/tmp/admin-state',
        CRAWCLAW_WS_URL: 'ws://desktop-gateway:18789',
      },
      { envPath: missingEnvPath, platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(existsSync(missingEnvPath)).toBe(false)
    expect(config.paths.runtimeMode).toBe('desktop')
    expect(config.paths.stateDir).toBe('/tmp/admin-state')
    expect(config.port).toBe(5123)
    expect(config.bindHost).toBe('127.0.0.2')
    expect(config.crawclawWsUrl).toBe('ws://desktop-gateway:18789')
  })

  it('defaults desktop bind host to loopback', () => {
    const config = loadAdminRuntimeConfig(
      { CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop', CRAWCLAW_ADMIN_PORT: '5222' },
      { envPath: join(makeTempDir(), 'missing.env'), platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(config.bindHost).toBe('127.0.0.1')
  })

  it('ignores non-loopback desktop bind host overrides', () => {
    const config = loadAdminRuntimeConfig(
      {
        CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
        CRAWCLAW_ADMIN_BIND_HOST: '0.0.0.0',
      },
      { envPath: join(makeTempDir(), 'missing.env'), platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(config.bindHost).toBe('127.0.0.1')
  })

  it('keeps PORT compatibility for web mode when no .env exists', () => {
    const config = loadAdminRuntimeConfig(
      { HOME: '/tmp/home', PORT: '4321' },
      { envPath: join(makeTempDir(), 'missing.env'), platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(config.paths.runtimeMode).toBe('web')
    expect(config.port).toBe(4321)
  })
})
