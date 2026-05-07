import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDesktopCapabilities, desktopServerPlatform } from './desktop-capabilities.js'

const tempDirs: string[] = []

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'crawclaw-admin-capabilities-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      chmodSync(dir, 0o700)
    } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('buildDesktopCapabilities', () => {
  it('reports terminal as available on supported desktop platforms', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const capabilities = buildDesktopCapabilities({ platform })

      expect(capabilities.terminal).toMatchObject({ available: true, platform })
    }
  })

  it('reports files and backup from writable runtime paths', () => {
    const stateDir = makeTempDir()
    const capabilities = buildDesktopCapabilities({
      platform: 'linux',
      paths: {
        dataDir: join(stateDir, 'data'),
        backupDir: join(stateDir, 'backups'),
      },
    })

    expect(capabilities.files.available).toBe(true)
    expect(capabilities.backup.available).toBe(true)
  })

  it('reports nested runtime paths as available when their existing ancestor is writable', () => {
    const stateDir = makeTempDir()
    const capabilities = buildDesktopCapabilities({
      platform: 'linux',
      paths: {
        dataDir: join(stateDir, 'missing-parent', 'data'),
        backupDir: join(stateDir, 'missing-parent', 'backups'),
      },
    })

    expect(capabilities.files.available).toBe(true)
    expect(capabilities.backup.available).toBe(true)
  })

  it('marks files and backup unavailable when runtime paths cannot be checked', () => {
    const capabilities = buildDesktopCapabilities({
      platform: 'linux',
      paths: {},
    })

    expect(capabilities.files.available).toBe(false)
    expect(capabilities.files.reason).toBe('Runtime data path is not configured.')
    expect(capabilities.backup.available).toBe(false)
    expect(capabilities.backup.reason).toBe('Runtime backup path is not configured.')
  })

  it('does not report runtime paths backed by existing files as writable directories', () => {
    const stateDir = makeTempDir()
    const dataFile = join(stateDir, 'data-file')
    const backupFile = join(stateDir, 'backup-file')
    writeFileSync(dataFile, '')
    writeFileSync(backupFile, '')

    const capabilities = buildDesktopCapabilities({
      platform: 'linux',
      paths: {
        dataDir: dataFile,
        backupDir: backupFile,
      },
    })

    expect(capabilities.files.available).toBe(false)
    expect(capabilities.backup.available).toBe(false)
  })

  it('reports remote desktop and input only for platforms backed by the server', () => {
    const linux = buildDesktopCapabilities({ platform: 'linux' })
    const windows = buildDesktopCapabilities({ platform: 'win32' })
    const mac = buildDesktopCapabilities({ platform: 'darwin' })

    expect(linux.remoteDesktop.available).toBe(true)
    expect(linux.desktopInput.available).toBe(true)
    expect(windows.remoteDesktop.available).toBe(true)
    expect(windows.desktopInput.available).toBe(false)
    expect(mac.remoteDesktop.available).toBe(false)
    expect(mac.remoteDesktop.reason).toBe('Remote desktop capture is not implemented for this platform.')
  })

  it('preserves unsupported platforms as unavailable instead of treating them as Linux', () => {
    const capabilities = buildDesktopCapabilities({ platform: 'freebsd' })

    expect(capabilities.remoteDesktop).toMatchObject({
      available: false,
      platform: 'freebsd',
    })
    expect(capabilities.desktopInput).toMatchObject({
      available: false,
      platform: 'freebsd',
    })
  })

  it('uses the same server platform model as the desktop create route', () => {
    expect(desktopServerPlatform('linux')).toBe('linux')
    expect(desktopServerPlatform('win32')).toBe('windows')
    expect(desktopServerPlatform('darwin')).toBe(null)
  })

  it('reports Hermes CLI and desktop update from env and runtime mode', () => {
    const web = buildDesktopCapabilities({
      platform: 'linux',
      runtimeMode: 'web',
      env: {},
    })
    const desktop = buildDesktopCapabilities({
      platform: 'linux',
      runtimeMode: 'desktop',
      env: { HERMES_CLI_PATH: '/opt/hermes/bin/hermes' },
    })

    expect(web.hermesCli.available).toBe(false)
    expect(web.hermesCli.reason).toBe('Set HERMES_CLI_PATH to enable Hermes CLI.')
    expect(web.desktopUpdate.available).toBe(false)
    expect(desktop.hermesCli.available).toBe(true)
    expect(desktop.desktopUpdate.available).toBe(true)
  })
})
