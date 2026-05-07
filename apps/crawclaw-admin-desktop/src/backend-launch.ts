import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { DesktopAppPaths } from './app-paths.js'

export interface DesktopGatewayConfig {
  wsUrl: string
  authToken?: string
  authPassword?: string
  locale?: string
  hermesWebUrl?: string
  hermesApiUrl?: string
  hermesApiKey?: string
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

function buildBackendEnv(
  paths: DesktopAppPaths,
  gateway: DesktopGatewayConfig,
  port: number
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CRAWCLAW_ADMIN_RUNTIME_MODE: 'desktop',
    CRAWCLAW_ADMIN_BIND_HOST: '127.0.0.1',
    CRAWCLAW_ADMIN_PORT: String(port),
    CRAWCLAW_ADMIN_STATE_DIR: paths.stateDir,
    CRAWCLAW_ADMIN_CONFIG_PATH: paths.backendConfigPath,
    CRAWCLAW_ADMIN_DATA_DIR: paths.dataDir,
    CRAWCLAW_ADMIN_BACKUP_DIR: paths.backupDir,
    CRAWCLAW_ADMIN_LOG_DIR: paths.logDir,
    CRAWCLAW_ADMIN_SESSION_SECRET: randomUUID(),
    CRAWCLAW_WS_URL: gateway.wsUrl,
    CRAWCLAW_AUTH_TOKEN: gateway.authToken ?? '',
    CRAWCLAW_AUTH_PASSWORD: gateway.authPassword ?? '',
  }

  setOptionalEnv(env, 'CRAWCLAW_LOCALE', gateway.locale)
  setOptionalEnv(env, 'HERMES_WEB_URL', gateway.hermesWebUrl)
  setOptionalEnv(env, 'HERMES_API_URL', gateway.hermesApiUrl)
  setOptionalEnv(env, 'HERMES_API_KEY', gateway.hermesApiKey)

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
  const deadline = Date.now() + 15_000
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
