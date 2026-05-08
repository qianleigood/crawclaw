import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type JsonObject = Record<string, unknown>

export interface BootstrapLocalGatewayConfigResult {
  changed: boolean
  port: number
  wsUrl: string
  authToken?: string
  authPassword?: string
}

export async function bootstrapLocalGatewayConfig(params: {
  stateDir: string
  configPath?: string
  initialConfig?: JsonObject
  tokenFactory?: () => string
}): Promise<BootstrapLocalGatewayConfigResult> {
  const configPath = params.configPath ?? join(params.stateDir, 'crawclaw.json')
  const config = params.initialConfig ?? await readJsonConfig(configPath)
  const gateway = readObject(config.gateway)
  let changed = false

  changed = setDefault(gateway, 'mode', 'local') || changed
  changed = setDefault(gateway, 'bind', 'loopback') || changed
  changed = setDefault(gateway, 'port', 18789) || changed

  const reload = readObject(gateway.reload)
  changed = setDefault(reload, 'mode', 'hybrid') || changed
  if (gateway.reload !== reload) {
    gateway.reload = reload
    changed = true
  }

  const auth = readObject(gateway.auth)
  if (Object.keys(auth).length === 0) {
    auth.mode = 'token'
    auth.token = params.tokenFactory?.() ?? randomBytes(24).toString('base64url')
    gateway.auth = auth
    changed = true
  }

  if (config.gateway !== gateway) {
    config.gateway = gateway
    changed = true
  }

  if (changed || params.initialConfig) {
    await mkdir(params.stateDir, { recursive: true })
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  }

  const port = readPort(gateway.port)
  const token = typeof auth.token === 'string' ? auth.token : undefined
  const password = typeof auth.password === 'string' ? auth.password : undefined
  return {
    changed,
    port,
    wsUrl: `ws://127.0.0.1:${port}`,
    ...(token ? { authToken: token } : {}),
    ...(password ? { authPassword: password } : {}),
  }
}

async function readJsonConfig(configPath: string): Promise<JsonObject> {
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf-8')) as unknown
    return readObject(parsed)
  } catch (error) {
    if (isMissingFileError(error)) {
      return {}
    }
    throw error
  }
}

function readObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function setDefault(target: JsonObject, key: string, value: unknown): boolean {
  if (target[key] !== undefined) {
    return false
  }
  target[key] = value
  return true
}

function readPort(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 18789
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
