import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { UtilityProcess } from 'electron'
import type { DesktopAppPaths } from './app-paths.js'

export interface DesktopGatewayConfig {
  wsUrl: string
  authToken?: string
  authPassword?: string
  runtimeRoot: string
  crawclawStateDir: string
  nodePath?: string
  locale?: string
}

export interface BackendLaunchResult {
  url: string
  port: number
  stop(): Promise<void>
}

export async function startAdminBackend(params: {
  adminRoot: string
  paths: DesktopAppPaths
  gateway: DesktopGatewayConfig
}): Promise<BackendLaunchResult> {
  const port = await findFreeLoopbackPort()
  const entryPoint = join(params.adminRoot, 'server', 'index.js')
  await access(entryPoint)

  let exitCode: number | null | undefined
  const { utilityProcess } = await import('electron')
  const child = utilityProcess.fork(entryPoint, [], {
    cwd: params.adminRoot,
    env: buildBackendEnv(params.paths, params.gateway, port),
    stdio: 'inherit',
  })
  child.once('exit', (code) => {
    exitCode = code
  })

  const url = `http://127.0.0.1:${port}`
  try {
    await waitForBackendHealth(url, () => exitCode)
  } catch (error) {
    child.kill()
    throw error
  }

  return {
    url,
    port,
    stop: () => stopUtilityProcess(child, () => exitCode),
  }
}

export function buildBackendEnv(
  paths: DesktopAppPaths,
  gateway: DesktopGatewayConfig,
  port: number,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
    CRAWCLAW_ADMIN_DESKTOP_LOCAL: '1',
    CRAWCLAW_ADMIN_BIND_HOST: '127.0.0.1',
    CRAWCLAW_ADMIN_PORT: String(port),
    CRAWCLAW_ADMIN_STATE_DIR: paths.stateDir,
    CRAWCLAW_ADMIN_CONFIG_PATH: paths.backendConfigPath,
    CRAWCLAW_ADMIN_DATA_DIR: paths.dataDir,
    CRAWCLAW_ADMIN_BACKUP_DIR: paths.backupDir,
    CRAWCLAW_ADMIN_LOG_DIR: paths.logDir,
    CRAWCLAW_ADMIN_SESSION_SECRET: randomUUID(),
    CRAWCLAW_DESKTOP_RUNTIME_ROOT: gateway.runtimeRoot,
    CRAWCLAW_DESKTOP_NODE_PATH: gateway.nodePath ?? '',
    CRAWCLAW_STATE_DIR: gateway.crawclawStateDir,
    CRAWCLAW_WS_URL: gateway.wsUrl,
    CRAWCLAW_AUTH_TOKEN: gateway.authToken ?? '',
    CRAWCLAW_AUTH_PASSWORD: gateway.authPassword ?? '',
    ELECTRON_RUN_AS_NODE: gateway.nodePath ? '1' : undefined,
    HERMES_WEB_URL: undefined,
    HERMES_API_URL: undefined,
    HERMES_API_KEY: undefined,
  }

  setOptionalEnv(env, 'CRAWCLAW_LOCALE', gateway.locale)

  return env
}

function setOptionalEnv(env: NodeJS.ProcessEnv, key: string, value: string | undefined): void {
  if (value?.trim()) {
    env[key] = value
  }
}

async function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to resolve a loopback port for the admin backend'))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function waitForBackendHealth(
  url: string,
  getExitCode: () => number | null | undefined
): Promise<void> {
  const deadline = Date.now() + 60_000
  const healthUrl = `${url}/api/health`

  while (Date.now() < deadline) {
    const exitCode = getExitCode()
    if (exitCode !== undefined) {
      throw new Error(`Admin backend exited before becoming healthy with code ${String(exitCode)}`)
    }

    try {
      const response = await fetch(healthUrl)
      if (response.ok) {
        return
      }
    } catch {
      // The backend may still be starting.
    }

    await delay(250)
  }

  throw new Error(`Timed out waiting for admin backend health at ${healthUrl}`)
}

async function stopUtilityProcess(
  child: UtilityProcess,
  getExitCode: () => number | null | undefined
): Promise<void> {
  if (getExitCode() !== undefined) {
    return
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill()
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
