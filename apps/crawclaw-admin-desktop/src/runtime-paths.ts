import { join, resolve } from 'node:path'

export function resolveDesktopRuntimeRoot(params: {
  isPackaged: boolean
  resourcesPath: string
  moduleDir: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}): string {
  const override = params.env?.CRAWCLAW_DESKTOP_RUNTIME_ROOT?.trim()
  if (override) {
    return resolve(override)
  }
  if (params.isPackaged) {
    return join(params.resourcesPath, 'runtime', 'crawclaw')
  }
  return resolve(params.moduleDir, '..', '.runtime', 'crawclaw')
}

export function resolveDesktopNodePath(params: {
  runtimeRoot: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  platform?: NodeJS.Platform
}): string {
  const override = params.env?.CRAWCLAW_DESKTOP_NODE_PATH?.trim()
  if (override) {
    return resolve(override)
  }
  return join(params.runtimeRoot, 'bin', (params.platform ?? process.platform) === 'win32' ? 'node.exe' : 'node')
}

export function resolveCrawClawStateDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  const override = env.CRAWCLAW_STATE_DIR?.trim()
  if (override) {
    return override
  }
  const home = env.CRAWCLAW_HOME?.trim() || env.HOME || env.USERPROFILE
  return home ? join(home, '.crawclaw') : resolve('.crawclaw')
}
