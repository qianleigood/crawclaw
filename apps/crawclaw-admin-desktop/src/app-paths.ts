import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from 'electron'

export interface DesktopAppPaths {
  stateDir: string
  configPath: string
  backendConfigPath: string
  dataDir: string
  backupDir: string
  logDir: string
  runtimeDir: string
}

type ElectronAppPathResolver = Pick<App, 'getPath'>

export function resolveDesktopAppPaths(app: ElectronAppPathResolver): DesktopAppPaths {
  const stateDir = app.getPath('userData')

  return {
    stateDir,
    configPath: join(stateDir, 'config.json'),
    backendConfigPath: join(stateDir, 'admin.env'),
    dataDir: join(stateDir, 'data'),
    backupDir: join(stateDir, 'backups'),
    logDir: join(stateDir, 'logs'),
    runtimeDir: join(stateDir, 'runtime'),
  }
}

export function ensureDesktopAppPaths(paths: DesktopAppPaths): void {
  mkdirSync(paths.stateDir, { recursive: true })
  mkdirSync(paths.dataDir, { recursive: true })
  mkdirSync(paths.backupDir, { recursive: true })
  mkdirSync(paths.logDir, { recursive: true })
  mkdirSync(paths.runtimeDir, { recursive: true })
}

