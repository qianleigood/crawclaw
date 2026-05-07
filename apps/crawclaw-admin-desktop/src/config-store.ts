import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const DEFAULT_DESKTOP_PROFILE_ID = 'default'
export const DEFAULT_GATEWAY_WS_URL = 'ws://localhost:18789'

const SENSITIVE_CONFIG_KEYS = new Set([
  'token',
  'password',
  'gatewayToken',
  'gatewayPassword',
  'authToken',
  'authPassword',
  'CRAWCLAW_AUTH_TOKEN',
  'CRAWCLAW_AUTH_PASSWORD',
  'HERMES_API_KEY',
])

export interface DesktopConfig {
  activeProfileId: string
  gatewayWsUrl: string
  locale?: string
  theme?: string
  hermesWebUrl?: string
  hermesApiUrl?: string
}

export function defaultDesktopConfig(): DesktopConfig {
  return {
    activeProfileId: DEFAULT_DESKTOP_PROFILE_ID,
    gatewayWsUrl: DEFAULT_GATEWAY_WS_URL,
  }
}

export async function loadDesktopConfig(configPath: string): Promise<DesktopConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf-8')) as unknown
    return normalizeDesktopConfig(parsed)
  } catch (error) {
    if (isMissingFileError(error)) {
      return defaultDesktopConfig()
    }
    throw error
  }
}

export async function saveDesktopConfig(configPath: string, config: DesktopConfig): Promise<void> {
  const sanitized = sanitizeDesktopConfig(config)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf-8')
}

export function sanitizeDesktopConfig(config: DesktopConfig): DesktopConfig {
  const source = config as DesktopConfig & Record<string, unknown>
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(source)) {
    if (SENSITIVE_CONFIG_KEYS.has(key) || value === undefined) {
      continue
    }
    sanitized[key] = value
  }

  return normalizeDesktopConfig(sanitized)
}

function normalizeDesktopConfig(source: unknown): DesktopConfig {
  if (!source || typeof source !== 'object') {
    return defaultDesktopConfig()
  }

  const record = source as Record<string, unknown>
  const config: DesktopConfig = {
    activeProfileId: readString(record.activeProfileId, DEFAULT_DESKTOP_PROFILE_ID),
    gatewayWsUrl: readString(record.gatewayWsUrl, DEFAULT_GATEWAY_WS_URL),
  }

  setOptionalString(config, 'locale', record.locale)
  setOptionalString(config, 'theme', record.theme)
  setOptionalString(config, 'hermesWebUrl', record.hermesWebUrl)
  setOptionalString(config, 'hermesApiUrl', record.hermesApiUrl)

  return config
}

function setOptionalString<T extends keyof DesktopConfig>(
  target: DesktopConfig,
  key: T,
  value: unknown
): void {
  if (typeof value === 'string' && value.trim()) {
    target[key] = value as DesktopConfig[T]
  }
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
