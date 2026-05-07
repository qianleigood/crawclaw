import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAdminRuntimeConfig, resolveCrawClawStateDir } from './runtime-config.js'
import { N8nService } from './n8n-service.js'

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
    const configPath = join(makeTempDir(), 'config.json')
    const dataDir = join(makeTempDir(), 'data')
    const backupDir = join(makeTempDir(), 'backups')

    const config = loadAdminRuntimeConfig(
      {
        CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
        CRAWCLAW_ADMIN_PORT: '5123',
        CRAWCLAW_ADMIN_BIND_HOST: '127.0.0.2',
        CRAWCLAW_ADMIN_STATE_DIR: '/tmp/admin-state',
        CRAWCLAW_ADMIN_CONFIG_PATH: configPath,
        CRAWCLAW_ADMIN_DATA_DIR: dataDir,
        CRAWCLAW_ADMIN_BACKUP_DIR: backupDir,
        CRAWCLAW_WS_URL: 'ws://desktop-gateway:18789',
      },
      { envPath: missingEnvPath, platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(existsSync(missingEnvPath)).toBe(false)
    expect(config.paths.runtimeMode).toBe('desktop')
    expect(config.paths.stateDir).toBe('/tmp/admin-state')
    expect(config.paths.configPath).toBe(configPath)
    expect(config.paths.dataDir).toBe(dataDir)
    expect(config.paths.backupDir).toBe(backupDir)
    expect(config.port).toBe(5123)
    expect(config.bindHost).toBe('127.0.0.2')
    expect(config.crawclawWsUrl).toBe('ws://desktop-gateway:18789')
  })

  it('reads desktop persisted config values from CRAWCLAW_ADMIN_CONFIG_PATH', () => {
    const configPath = writeEnvFile([
      'CRAWCLAW_WS_URL=ws://persisted-gateway:18789',
      'CRAWCLAW_AUTH_TOKEN=persisted-token',
      'AUTH_USERNAME=persisted-admin',
    ].join('\n'))

    const config = loadAdminRuntimeConfig(
      {
        CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
        CRAWCLAW_ADMIN_CONFIG_PATH: configPath,
        CRAWCLAW_WS_URL: 'ws://stale-process-env:18789',
        CRAWCLAW_AUTH_TOKEN: 'stale-token',
      },
      { platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(config.crawclawWsUrl).toBe('ws://persisted-gateway:18789')
    expect(config.crawclawAuthToken).toBe('persisted-token')
    expect(config.authUsername).toBe('persisted-admin')
  })

  it('maps the desktop admin state dir to the managed CrawClaw runtime state dir', () => {
    const stateDir = join(makeTempDir(), 'desktop-state')
    const config = loadAdminRuntimeConfig(
      {
        CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
        CRAWCLAW_ADMIN_STATE_DIR: stateDir,
      },
      { platform: 'linux', homeDir: '/tmp/home' }
    )
    const service = new N8nService(config)

    expect(config.CRAWCLAW_STATE_DIR).toBe(stateDir)
    expect(service.resolveUserFolder()).toBe(join(stateDir, 'n8n'))
  })

  it('preserves the process CrawClaw state dir in web mode when .env omits it', () => {
    const envPath = writeEnvFile('PORT=4123')
    const stateDir = join(makeTempDir(), 'web-state')

    const config = loadAdminRuntimeConfig(
      {
        HOME: '/tmp/home',
        CRAWCLAW_STATE_DIR: stateDir,
      },
      { envPath, platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(config.CRAWCLAW_STATE_DIR).toBe(stateDir)
  })

  it('resolves backup restore target from the desktop Admin state dir', () => {
    const stateDir = join(makeTempDir(), 'desktop-state')
    const config = loadAdminRuntimeConfig(
      {
        CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
        CRAWCLAW_ADMIN_STATE_DIR: stateDir,
      },
      { platform: 'linux', homeDir: '/tmp/home' }
    )

    expect(resolveCrawClawStateDir(config, { homeDir: '/tmp/home' })).toBe(stateDir)
  })

  it('stores the SQLite database under CRAWCLAW_ADMIN_DATA_DIR in desktop mode', async () => {
    const originalDataDir = process.env.CRAWCLAW_ADMIN_DATA_DIR
    const dataDir = join(makeTempDir(), 'desktop-data')
    process.env.CRAWCLAW_ADMIN_DATA_DIR = dataDir
    vi.doMock('better-sqlite3', () => ({
      default: class FakeDatabase {
        name: string

        constructor(name: string) {
          this.name = name
          writeFileSync(name, '')
        }

        pragma() {}

        exec() {}

        prepare() {
          return {
            all: () => [],
            get: () => ({ count: 0 }),
            run: () => {},
          }
        }

        close() {}
      },
    }))

    try {
      const databaseUrl = new URL('./database.js', import.meta.url)
      databaseUrl.search = `?desktop-data-dir-${Date.now()}`
      const databaseModule = await import(databaseUrl.href)
      const database = databaseModule.default
      try {
        expect(database.name).toBe(join(dataDir, 'wizard.db'))
        expect(existsSync(join(dataDir, 'wizard.db'))).toBe(true)
      } finally {
        database.close()
      }
    } finally {
      if (originalDataDir === undefined) {
        delete process.env.CRAWCLAW_ADMIN_DATA_DIR
      } else {
        process.env.CRAWCLAW_ADMIN_DATA_DIR = originalDataDir
      }
      vi.doUnmock('better-sqlite3')
      vi.resetModules()
    }
  })

  it('stores the SQLite database under the default desktop state data dir', async () => {
    const originalRuntimeMode = process.env.CRAWCLAW_ADMIN_RUNTIME_MODE
    const originalStateDir = process.env.CRAWCLAW_ADMIN_STATE_DIR
    const originalDataDir = process.env.CRAWCLAW_ADMIN_DATA_DIR
    const stateDir = join(makeTempDir(), 'desktop-state')
    process.env.CRAWCLAW_ADMIN_RUNTIME_MODE = 'desktop'
    process.env.CRAWCLAW_ADMIN_STATE_DIR = stateDir
    delete process.env.CRAWCLAW_ADMIN_DATA_DIR
    vi.doMock('better-sqlite3', () => ({
      default: class FakeDatabase {
        name: string

        constructor(name: string) {
          this.name = name
          writeFileSync(name, '')
        }

        pragma() {}

        exec() {}

        prepare() {
          return {
            all: () => [],
            get: () => ({ count: 0 }),
            run: () => {},
          }
        }

        close() {}
      },
    }))

    try {
      const databaseUrl = new URL('./database.js', import.meta.url)
      databaseUrl.search = `?desktop-state-dir-${Date.now()}`
      const databaseModule = await import(databaseUrl.href)
      const database = databaseModule.default
      try {
        expect(database.name).toBe(join(stateDir, 'data', 'wizard.db'))
        expect(existsSync(join(stateDir, 'data', 'wizard.db'))).toBe(true)
      } finally {
        database.close()
      }
    } finally {
      if (originalRuntimeMode === undefined) {
        delete process.env.CRAWCLAW_ADMIN_RUNTIME_MODE
      } else {
        process.env.CRAWCLAW_ADMIN_RUNTIME_MODE = originalRuntimeMode
      }
      if (originalStateDir === undefined) {
        delete process.env.CRAWCLAW_ADMIN_STATE_DIR
      } else {
        process.env.CRAWCLAW_ADMIN_STATE_DIR = originalStateDir
      }
      if (originalDataDir === undefined) {
        delete process.env.CRAWCLAW_ADMIN_DATA_DIR
      } else {
        process.env.CRAWCLAW_ADMIN_DATA_DIR = originalDataDir
      }
      vi.doUnmock('better-sqlite3')
      vi.resetModules()
    }
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
