import { spawnSync } from 'child_process'
import { delimiter, join } from 'path'

export function buildDesktopRuntimeCommand(params) {
  return {
    file: params.nodePath,
    args: [join(params.runtimeRoot, 'crawclaw.mjs'), ...params.args],
    cwd: params.runtimeRoot,
  }
}

export function buildDesktopRuntimeEnv(params) {
  return {
    ...params.baseEnv,
    ELECTRON_RUN_AS_NODE: '1',
    CRAWCLAW_STATE_DIR: resolveDesktopStateDir(params.baseEnv),
    CRAWCLAW_GATEWAY_TOKEN: params.authToken,
    CRAWCLAW_GATEWAY_PASSWORD: params.authPassword,
    CRAWCLAW_DESKTOP_RUNTIME_ROOT: params.runtimeRoot,
    CRAWCLAW_PLUGIN_RUNTIMES_DIR: buildPluginRuntimesDir({
      stateDir: resolveDesktopStateDir(params.baseEnv),
      runtimeRoot: params.runtimeRoot,
    }),
  }
}

function buildPluginRuntimesDir(params) {
  return [params.stateDir ? join(params.stateDir, 'runtimes') : undefined, join(params.runtimeRoot, 'runtimes')]
    .filter(Boolean)
    .join(delimiter)
}

export function buildDesktopRuntimeActionCommand(params) {
  const runtimeEntryPath = join(params.runtimeRoot, 'crawclaw.mjs')
  const args = buildDesktopRuntimeActionArgs({
    action: params.action,
    runtimeEntryPath,
    authToken: params.authToken,
    authPassword: params.authPassword,
    logsParams: params.logsParams,
    runtimeId: params.runtimeId,
  })
  return buildDesktopRuntimeCommand({
    runtimeRoot: params.runtimeRoot,
    nodePath: params.nodePath,
    args,
  })
}

export function runDesktopRuntimeAction(params) {
  const command = buildDesktopRuntimeActionCommand(params)
  const env = buildDesktopRuntimeEnv({
    baseEnv: params.baseEnv ?? process.env,
    runtimeRoot: params.runtimeRoot,
    authToken: params.authToken,
    authPassword: params.authPassword,
  })
  const result = (params.spawnSyncImpl ?? spawnSync)(command.file, command.args, {
    cwd: command.cwd,
    env,
    encoding: 'utf-8',
    timeout: params.timeoutMs ?? 120_000,
  })
  if (result.status !== 0) {
    const suffix = result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`
    const detail = String(result.stderr || result.stdout || '').trim()
    throw new Error(`Desktop runtime ${params.action} failed with ${suffix}${detail ? `: ${detail}` : ''}`)
  }
  return parseDesktopRuntimeJson(result.stdout)
}

export function parseDesktopRuntimeJson(output) {
  const source = String(output || '').trim()
  if (!source) {
    throw new Error('Desktop runtime command did not return JSON output')
  }
  try {
    return JSON.parse(source)
  } catch {
    // Fall through to support command logs followed by pretty-printed JSON.
  }

  let parsed = null
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '{') {
      continue
    }
    const end = findJsonObjectEnd(source, index)
    if (end === -1) {
      continue
    }
    try {
      parsed = JSON.parse(source.slice(index, end + 1))
      index = end
    } catch {
      // Keep scanning; earlier braces may belong to logs.
    }
  }
  if (parsed) {
    return parsed
  }

  throw new Error('Desktop runtime command did not return JSON output')
}

function findJsonObjectEnd(source, start) {
  let depth = 0
  let inString = false
  let escaping = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaping) {
        escaping = false
      } else if (char === '\\') {
        escaping = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

function resolveDesktopStateDir(env) {
  if (typeof env.CRAWCLAW_STATE_DIR === 'string' && env.CRAWCLAW_STATE_DIR.trim()) {
    return env.CRAWCLAW_STATE_DIR
  }
  const home = env.HOME || env.USERPROFILE
  return home ? join(home, '.crawclaw') : undefined
}

function buildDesktopRuntimeActionArgs(params) {
  switch (params.action) {
    case 'bootstrap':
      return appendInstallAuth(
        [
          'gateway',
          'install',
          '--force',
          '--runtime',
          'node',
          '--runtime-entry',
          params.runtimeEntryPath,
        ],
        params.authToken,
      )
    case 'status':
      return appendRpcAuth(['gateway', 'status', '--json'], params.authToken, params.authPassword)
    case 'service.start':
      return ['gateway', 'start', '--json']
    case 'service.stop':
      return ['gateway', 'stop', '--json']
    case 'service.restart':
      return ['gateway', 'restart', '--json']
    case 'logs.tail':
      return [
        'gateway',
        'call',
        'logs.tail',
        '--params',
        JSON.stringify(params.logsParams ?? {}),
        '--json',
      ]
    case 'runtimes.list':
      return ['runtimes', 'list', '--json']
    case 'runtimes.install':
      if (!params.runtimeId) {
        throw new Error('Desktop runtime install requires a runtime id.')
      }
      return ['runtimes', 'install', '--runtime', params.runtimeId, '--json']
    default:
      throw new Error(`Unsupported desktop runtime action: ${String(params.action)}`)
  }
}

function appendInstallAuth(args, token) {
  const next = [...args]
  if (token) {
    next.push('--token', token)
  }
  next.push('--json')
  return next
}

function appendRpcAuth(args, token, password) {
  const next = [...args]
  if (token) {
    next.push('--token', token)
  }
  if (password) {
    next.push('--password', password)
  }
  return next
}
