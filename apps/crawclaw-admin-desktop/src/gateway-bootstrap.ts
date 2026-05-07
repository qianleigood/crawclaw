import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface DesktopGatewayBootstrapOptions {
  stateDir: string
  initialConfig?: Record<string, unknown>
  tokenFactory?: () => string
}

export interface DesktopGatewayBootstrapResult {
  stateDir: string
  configPath: string
  port: number
  wsUrl: string
  authToken?: string
  changed: boolean
}

type JsonRecord = Record<string, unknown>

const DEFAULT_GATEWAY_PORT = 18789

export async function bootstrapLocalGatewayConfig(
  options: DesktopGatewayBootstrapOptions
): Promise<DesktopGatewayBootstrapResult> {
  const configPath = join(options.stateDir, 'crawclaw.json')
  await mkdir(options.stateDir, { recursive: true })

  const loaded = await readGatewayConfig(configPath, options.initialConfig)
  const gateway = ensureRecord(loaded.config, 'gateway')
  let changed = loaded.changed

  changed = setDefault(gateway, 'mode', 'local') || changed
  changed = setDefault(gateway, 'bind', 'loopback') || changed
  changed = setDefault(gateway, 'port', DEFAULT_GATEWAY_PORT) || changed

  const reload = ensureRecord(gateway, 'reload')
  changed = setDefault(reload, 'mode', 'hybrid') || changed

  const auth = ensureRecord(gateway, 'auth')
  if (!isNonEmptyString(auth.mode)) {
    const token = options.tokenFactory?.() ?? randomBytes(32).toString('hex')
    auth.mode = 'token'
    auth.token = token
    changed = true
  } else if (auth.mode === 'token' && !isNonEmptyString(auth.token)) {
    const token = options.tokenFactory?.() ?? randomBytes(32).toString('hex')
    auth.token = token
    changed = true
  }

  if (changed) {
    await writeFile(configPath, `${JSON.stringify(loaded.config, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    })
  }

  const port = readGatewayPort(gateway.port)
  const authToken = auth.mode === 'token' && isNonEmptyString(auth.token) ? auth.token : undefined
  return {
    stateDir: options.stateDir,
    configPath,
    port,
    wsUrl: `ws://127.0.0.1:${port}`,
    authToken,
    changed,
  }
}

async function readGatewayConfig(
  configPath: string,
  initialConfig?: Record<string, unknown>
): Promise<{ config: JsonRecord; changed: boolean }> {
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf-8')) as unknown
    return { config: isRecord(parsed) ? parsed : {}, changed: !isRecord(parsed) }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
    return { config: cloneRecord(initialConfig), changed: true }
  }
}

function ensureRecord(target: JsonRecord, key: string): JsonRecord {
  const value = target[key]
  if (isRecord(value)) {
    return value
  }
  const next: JsonRecord = {}
  target[key] = next
  return next
}

function setDefault(target: JsonRecord, key: string, value: string | number): boolean {
  if (target[key] !== undefined) {
    return false
  }
  target[key] = value
  return true
}

function readGatewayPort(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_GATEWAY_PORT
}

function cloneRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    return {}
  }
  return JSON.parse(JSON.stringify(value)) as JsonRecord
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
