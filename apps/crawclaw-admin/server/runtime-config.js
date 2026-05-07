import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'dotenv'
import { resolveAdminPaths } from './admin-paths.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DEFAULT_ENV_PATH = join(__dirname, '../.env')

const LEGACY_CRAWCLAW_PREFIX = ['OPEN', 'CLAW'].join('')
const CRAWCLAW_ENV_PREFIX = 'CRAWCLAW_'
const CRAWCLAW_ENV_KEYS = [
  'CRAWCLAW_WS_URL',
  'CRAWCLAW_AUTH_TOKEN',
  'CRAWCLAW_AUTH_PASSWORD',
  'CRAWCLAW_LOCALE',
  'CRAWCLAW_HOME',
  'CRAWCLAW_N8N_MANAGED',
  'CRAWCLAW_N8N_BIN',
  'CRAWCLAW_N8N_HOST',
  'CRAWCLAW_N8N_PORT',
  'CRAWCLAW_N8N_USER_FOLDER',
]

export function loadAdminRuntimeConfig(env = process.env, opts = {}) {
  const paths = resolveAdminPaths(env, opts)
  const envPath = opts.envPath || DEFAULT_ENV_PATH
  const parsed = paths.runtimeMode === 'desktop' ? env : readDotEnv(envPath, env)
  const port = Number(env.CRAWCLAW_ADMIN_PORT || parsed.PORT || 3001)
  const bindHost = resolveBindHost(paths.runtimeMode, env.CRAWCLAW_ADMIN_BIND_HOST)
  const crawclawWsUrl = readEnvValue(parsed, 'CRAWCLAW_WS_URL', 'ws://localhost:18789')
  const crawclawAuthToken = readEnvValue(parsed, 'CRAWCLAW_AUTH_TOKEN', '')
  const crawclawAuthPassword = readEnvValue(parsed, 'CRAWCLAW_AUTH_PASSWORD', '')
  const crawclawLocale = readEnvValue(parsed, 'CRAWCLAW_LOCALE', '')
  const crawclawHome = readEnvValue(parsed, 'CRAWCLAW_HOME', '')
  const crawclawN8nManaged = readEnvValue(parsed, 'CRAWCLAW_N8N_MANAGED')
  const crawclawN8nBin = readEnvValue(parsed, 'CRAWCLAW_N8N_BIN', '')
  const crawclawN8nHost = readEnvValue(parsed, 'CRAWCLAW_N8N_HOST', '')
  const crawclawN8nPort = readEnvValue(parsed, 'CRAWCLAW_N8N_PORT', '')
  const crawclawN8nUserFolder = readEnvValue(parsed, 'CRAWCLAW_N8N_USER_FOLDER', '')
  const authUsername = parsed.CRAWCLAW_ADMIN_AUTH_USERNAME || parsed.AUTH_USERNAME || ''
  const authPassword = parsed.CRAWCLAW_ADMIN_AUTH_PASSWORD || parsed.AUTH_PASSWORD || ''
  const devFrontendUrl =
    parsed.CRAWCLAW_ADMIN_DEV_FRONTEND_URL || parsed.DEV_FRONTEND_URL || 'http://localhost:3000'
  const mediaDir = parsed.CRAWCLAW_ADMIN_MEDIA_DIR || parsed.MEDIA_DIR || ''
  const logLevel = parsed.CRAWCLAW_ADMIN_LOG_LEVEL || parsed.LOG_LEVEL || 'INFO'
  const hermesWebUrl = parsed.HERMES_WEB_URL || ''
  const hermesApiUrl = parsed.HERMES_API_URL || ''
  const hermesApiKey = parsed.HERMES_API_KEY || ''
  const hermesCliPath = parsed.HERMES_CLI_PATH || ''
  const hermesHome = parsed.HERMES_HOME || ''

  return {
    paths,
    envPath,
    bindHost,
    port,
    PORT: port,
    crawclawWsUrl,
    crawclawAuthToken,
    crawclawAuthPassword,
    authUsername,
    authPassword,
    logLevel,
    CRAWCLAW_WS_URL: crawclawWsUrl,
    CRAWCLAW_AUTH_TOKEN: crawclawAuthToken,
    CRAWCLAW_AUTH_PASSWORD: crawclawAuthPassword,
    CRAWCLAW_LOCALE: crawclawLocale,
    CRAWCLAW_HOME: crawclawHome,
    CRAWCLAW_N8N_MANAGED: crawclawN8nManaged,
    CRAWCLAW_N8N_BIN: crawclawN8nBin,
    CRAWCLAW_N8N_HOST: crawclawN8nHost,
    CRAWCLAW_N8N_PORT: crawclawN8nPort,
    CRAWCLAW_N8N_USER_FOLDER: crawclawN8nUserFolder,
    DEV_FRONTEND_URL: devFrontendUrl,
    AUTH_USERNAME: authUsername,
    AUTH_PASSWORD: authPassword,
    MEDIA_DIR: mediaDir,
    LOG_LEVEL: logLevel,
    HERMES_WEB_URL: hermesWebUrl,
    HERMES_API_URL: hermesApiUrl,
    HERMES_API_KEY: hermesApiKey,
    HERMES_CLI_PATH: hermesCliPath,
    HERMES_HOME: hermesHome,
  }
}

export function readEnvValue(source, key, fallback = undefined) {
  const value = source[key] ?? source[legacyCrawClawEnvKey(key)]
  return value === undefined ? fallback : value
}

export function normalizeCrawClawEnvSnapshot(source) {
  const normalized = { ...source }
  for (const key of CRAWCLAW_ENV_KEYS) {
    const legacyKey = legacyCrawClawEnvKey(key)
    if (normalized[key] === undefined && normalized[legacyKey] !== undefined) {
      normalized[key] = normalized[legacyKey]
    }
  }
  return normalized
}

export function removeLegacyCrawClawEnvKeys(source) {
  for (const key of CRAWCLAW_ENV_KEYS) {
    delete source[legacyCrawClawEnvKey(key)]
  }
}

function readDotEnv(envPath, fallbackEnv) {
  return existsSync(envPath) ? parse(readFileSync(envPath, 'utf-8')) : fallbackEnv
}

function resolveBindHost(runtimeMode, requestedHost) {
  if (runtimeMode !== 'desktop') {
    return requestedHost || '0.0.0.0'
  }

  return isLoopbackHost(requestedHost) ? requestedHost : '127.0.0.1'
}

function isLoopbackHost(host) {
  if (!host) {return false}
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

function legacyCrawClawEnvKey(key) {
  if (!key.startsWith(CRAWCLAW_ENV_PREFIX)) {return key}
  return `${LEGACY_CRAWCLAW_PREFIX}_${key.slice(CRAWCLAW_ENV_PREFIX.length)}`
}
