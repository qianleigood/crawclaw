import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const DEFAULT_TIMEOUT_MS = 30_000

export function buildDesktopRuntimeCommand({
  runtimeRoot,
  nodePath = process.env.CRAWCLAW_DESKTOP_NODE_PATH || process.execPath,
  args = [],
}) {
  return {
    file: nodePath,
    args: [join(runtimeRoot, 'crawclaw.mjs'), ...args],
    cwd: runtimeRoot,
  }
}

export function buildDesktopRuntimeEnv({ baseEnv = process.env, runtimeRoot, authToken } = {}) {
  const env = {
    ...baseEnv,
    CRAWCLAW_DESKTOP_RUNTIME_ROOT: runtimeRoot,
  }
  delete env.CRAWCLAW_CONFIG_PATH
  if (authToken) {
    env.CRAWCLAW_GATEWAY_TOKEN = authToken
  }
  return env
}

export function parseDesktopRuntimeJson(raw) {
  const lines = String(raw || '').split(/\r?\n/).reverse()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      continue
    }
    return JSON.parse(trimmed)
  }
  return null
}

export async function runDesktopRuntimeJson(params) {
  const command = buildDesktopRuntimeCommand(params)
  const env = buildDesktopRuntimeEnv({
    baseEnv: params.env,
    runtimeRoot: params.runtimeRoot,
    authToken: params.authToken,
  })
  const result = await runCommand({
    ...command,
    env,
    timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })
  const parsed = parseDesktopRuntimeJson(`${result.stdout}\n${result.stderr}`)
  if (!parsed) {
    throw new Error('Bundled CrawClaw runtime did not return JSON output')
  }
  if (result.code !== 0) {
    const message = parsed?.error?.message || parsed?.error || result.stderr || result.stdout
    throw new Error(String(message || `Bundled CrawClaw runtime exited with code ${result.code}`))
  }
  return parsed
}

export async function readDesktopRuntimeStatus(params) {
  return runDesktopRuntimeJson({
    ...params,
    args: [
      'gateway',
      'status',
      '--url',
      params.wsUrl,
      '--token',
      params.authToken || '',
      '--json',
    ],
  })
}

export async function runDesktopServiceAction(params) {
  if (params.action === 'start') {
    await runDesktopRuntimeJson({
      ...params,
      args: ['gateway', 'install', '--runtime', 'node', '--port', String(params.port), '--force', '--json'],
    })
  }

  return runDesktopRuntimeJson({
    ...params,
    args: ['gateway', params.action, '--json'],
  })
}

export function tailDesktopGatewayLogs({ stateDir, maxBytes = 64 * 1024 }) {
  for (const path of desktopGatewayLogCandidates(stateDir)) {
    if (!existsSync(path)) {
      continue
    }
    const content = readFileSync(path, 'utf-8')
    return {
      path,
      content: content.length > maxBytes ? content.slice(content.length - maxBytes) : content,
    }
  }
  return { path: null, content: '' }
}

function desktopGatewayLogCandidates(stateDir) {
  return [
    join(stateDir, 'gateway.log'),
    join(stateDir, 'logs', 'gateway.log'),
    join(stateDir, 'logs', 'gateway-current.log'),
  ]
}

function runCommand({ file, args, cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Bundled CrawClaw runtime timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      resolve({ code, stdout, stderr })
    })
  })
}
