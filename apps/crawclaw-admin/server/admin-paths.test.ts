import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAdminPaths } from './admin-paths.js'

describe('resolveAdminPaths', () => {
  it('uses Application Support for macOS state', () => {
    const paths = resolveAdminPaths(
      { HOME: '/Users/ada' },
      { platform: 'darwin', homeDir: '/Users/ada' }
    )
    const stateDir = posix.join(
      '/Users/ada',
      'Library',
      'Application Support',
      'CrawClaw Admin'
    )

    expect(paths).toEqual({
      runtimeMode: 'web',
      stateDir,
      configPath: posix.join(stateDir, 'config.json'),
      dataDir: posix.join(stateDir, 'data'),
      backupDir: posix.join(stateDir, 'backups'),
      logDir: posix.join(stateDir, 'logs'),
    })
  })

  it('uses APPDATA for Windows state', () => {
    const paths = resolveAdminPaths(
      { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\ada' },
      { platform: 'win32', homeDir: 'C:\\Users\\ada' }
    )
    const stateDir = win32.join('C:\\Users\\ada\\AppData\\Roaming', 'CrawClaw Admin')

    expect(paths).toEqual({
      runtimeMode: 'web',
      stateDir,
      configPath: win32.join(stateDir, 'config.json'),
      dataDir: win32.join(stateDir, 'data'),
      backupDir: win32.join(stateDir, 'backups'),
      logDir: win32.join(stateDir, 'logs'),
    })
  })

  it('uses XDG_CONFIG_HOME for Linux state when available', () => {
    expect(
      resolveAdminPaths(
        { HOME: '/home/ada', XDG_CONFIG_HOME: '/home/ada/.config-custom' },
        { platform: 'linux', homeDir: '/home/ada' }
      ).stateDir
    ).toBe(posix.join('/home/ada/.config-custom', 'crawclaw-admin'))
  })

  it('falls back to home config for Linux state', () => {
    expect(
      resolveAdminPaths({ HOME: '/home/ada' }, { platform: 'linux', homeDir: '/home/ada' })
        .stateDir
    ).toBe(posix.join('/home/ada', '.config', 'crawclaw-admin'))
  })

  it('honors explicit environment overrides', () => {
    expect(
      resolveAdminPaths({
        CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
        CRAWCLAW_ADMIN_STATE_DIR: '/tmp/admin-state',
        CRAWCLAW_ADMIN_CONFIG_PATH: '/tmp/admin-config.json',
        CRAWCLAW_ADMIN_DATA_DIR: '/tmp/admin-data',
        CRAWCLAW_ADMIN_BACKUP_DIR: '/tmp/admin-backups',
        CRAWCLAW_ADMIN_LOG_DIR: '/tmp/admin-logs',
      })
    ).toEqual({
      runtimeMode: 'desktop',
      stateDir: '/tmp/admin-state',
      configPath: '/tmp/admin-config.json',
      dataDir: '/tmp/admin-data',
      backupDir: '/tmp/admin-backups',
      logDir: '/tmp/admin-logs',
    })
  })
})
