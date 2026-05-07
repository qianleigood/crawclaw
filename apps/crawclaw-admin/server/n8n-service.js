import { spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import net from 'net'

export function normalizeAppLocale(input) {
  const raw = String(input || '').trim().toLowerCase().replace(/_/g, '-')
  if (raw.startsWith('zh')) return 'zh-CN'
  if (raw.startsWith('en')) return 'en-US'
  return 'en-US'
}

export function normalizeN8nLocale(input) {
  return normalizeAppLocale(input) === 'zh-CN' ? 'zh-CN' : 'en'
}

function isFalseLike(value) {
  return /^(0|false|no|off)$/i.test(String(value || '').trim())
}

function resolveStateDir(env) {
  return env.CRAWCLAW_STATE_DIR?.trim() || join(homedir(), '.crawclaw')
}

function canConnect(host, port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export class N8nService {
  constructor(env, log = console) {
    this.env = env
    this.log = log
    this.process = null
    this.locale = normalizeAppLocale(env.CRAWCLAW_LOCALE || env.CRAWCLAW_LANG || env.LANG)
    this.lastError = null
    this.lastExit = null
    this.externalRunning = false
  }

  isManagedEnabled() {
    if (this.env.CRAWCLAW_N8N_MANAGED !== undefined) {
      return !isFalseLike(this.env.CRAWCLAW_N8N_MANAGED)
    }
    return existsSync(this.resolveBinPath())
  }

  resolveHost() {
    return this.env.CRAWCLAW_N8N_HOST || this.env.N8N_HOST || 'localhost'
  }

  resolvePort() {
    const raw = Number(this.env.CRAWCLAW_N8N_PORT || this.env.N8N_PORT || 5679)
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 5679
  }

  resolveBaseUrl() {
    const protocol = this.env.N8N_PROTOCOL || 'http'
    return `${protocol}://${this.resolveHost()}:${this.resolvePort()}`
  }

  resolveBinPath() {
    if (this.env.CRAWCLAW_N8N_BIN?.trim()) {
      return this.env.CRAWCLAW_N8N_BIN.trim()
    }
    const suffix = process.platform === 'win32' ? 'n8n.cmd' : 'n8n'
    return join(resolveStateDir(this.env), 'runtimes', 'n8n', 'node_modules', '.bin', suffix)
  }

  resolveUserFolder() {
    return (
      this.env.CRAWCLAW_N8N_USER_FOLDER?.trim() ||
      this.env.N8N_USER_FOLDER?.trim() ||
      join(resolveStateDir(this.env), 'n8n')
    )
  }

  buildEnv(locale = this.locale) {
    const userFolder = this.resolveUserFolder()
    mkdirSync(userFolder, { recursive: true })
    return {
      ...process.env,
      ...this.env,
      N8N_DEFAULT_LOCALE: normalizeN8nLocale(locale),
      N8N_HOST: this.resolveHost(),
      N8N_PORT: String(this.resolvePort()),
      N8N_PROTOCOL: this.env.N8N_PROTOCOL || 'http',
      N8N_EDITOR_BASE_URL: this.env.N8N_EDITOR_BASE_URL || this.resolveBaseUrl(),
      N8N_USER_FOLDER: userFolder,
      N8N_DIAGNOSTICS_ENABLED: this.env.N8N_DIAGNOSTICS_ENABLED || 'false',
      N8N_VERSION_NOTIFICATIONS_ENABLED: this.env.N8N_VERSION_NOTIFICATIONS_ENABLED || 'false',
      N8N_TEMPLATES_ENABLED: this.env.N8N_TEMPLATES_ENABLED || 'false',
      N8N_SECURE_COOKIE: this.env.N8N_SECURE_COOKIE || 'false',
    }
  }

  async ensureStarted(locale = this.locale) {
    this.locale = normalizeAppLocale(locale)
    if (!this.isManagedEnabled()) {
      return this.getStatus()
    }
    if (this.process && !this.process.killed) {
      return this.getStatus()
    }
    if (!existsSync(this.resolveBinPath())) {
      this.lastError = `n8n binary not found: ${this.resolveBinPath()}`
      return this.getStatus()
    }
    const occupied = await canConnect(this.resolveHost(), this.resolvePort())
    if (occupied) {
      this.externalRunning = true
      return this.getStatus()
    }
    this.start(this.locale)
    return this.getStatus()
  }

  start(locale = this.locale) {
    this.locale = normalizeAppLocale(locale)
    this.externalRunning = false
    const child = spawn(this.resolveBinPath(), ['start'], {
      env: this.buildEnv(this.locale),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.process = child
    this.lastError = null
    this.lastExit = null
    child.stdout.on('data', (data) => this.log.log(`[n8n] ${String(data).trimEnd()}`))
    child.stderr.on('data', (data) => this.log.warn(`[n8n] ${String(data).trimEnd()}`))
    child.once('error', (error) => {
      this.lastError = error.message
      this.process = null
      this.log.error('[n8n] failed to start:', error.message)
    })
    child.once('exit', (code, signal) => {
      this.lastExit = { code, signal, at: new Date().toISOString() }
      this.process = null
      if (code !== 0 && signal !== 'SIGTERM') {
        this.lastError = `n8n exited with code ${code ?? 'unknown'}`
      }
    })
  }

  async stop() {
    const child = this.process
    if (!child || child.killed) return
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
    this.process = null
  }

  async restart(locale = this.locale) {
    await this.stop()
    this.externalRunning = false
    await this.ensureStarted(locale)
  }

  async updateEnv(env, options = {}) {
    const shouldRestart = options.restartManaged && this.process && !this.process.killed
    this.env = env
    this.externalRunning = false
    if (shouldRestart) {
      await this.restart(options.locale || this.locale)
    }
    return this.getStatus()
  }

  async setLocale(locale) {
    const nextLocale = normalizeAppLocale(locale)
    const previousN8nLocale = normalizeN8nLocale(this.locale)
    this.locale = nextLocale
    if (!this.isManagedEnabled()) {
      return this.getStatus()
    }
    if (this.externalRunning) {
      return this.getStatus()
    }
    if (normalizeN8nLocale(nextLocale) !== previousN8nLocale || !this.process) {
      await this.restart(nextLocale)
    }
    return this.getStatus()
  }

  getStatus() {
    return {
      managed: this.isManagedEnabled(),
      externalRunning: this.externalRunning,
      running: !!this.process && !this.process.killed,
      pid: this.process?.pid || null,
      locale: this.locale,
      n8nLocale: normalizeN8nLocale(this.locale),
      baseUrl: this.resolveBaseUrl(),
      binPath: this.resolveBinPath(),
      userFolder: this.resolveUserFolder(),
      lastError: this.lastError,
      lastExit: this.lastExit,
    }
  }
}
