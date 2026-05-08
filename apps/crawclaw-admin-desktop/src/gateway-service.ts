import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'

type GatewayServiceSpawnOptions = {
  cwd: string
  env: NodeJS.ProcessEnv
  encoding: 'utf-8'
  timeout: number
}

type GatewayServiceSpawnResult = {
  status: number | null
  signal: NodeJS.Signals | null
  stdout?: string | Buffer | null
  stderr?: string | Buffer | null
}

export type GatewayServiceSpawnSync = (
  file: string,
  args: string[],
  options: GatewayServiceSpawnOptions
) => GatewayServiceSpawnResult

export function runGatewayServiceBootstrap(params: {
  nodePath: string
  runtimeRoot: string
  stateDir: string
  authToken?: string
  authPassword?: string
  baseEnv?: NodeJS.ProcessEnv
  spawnSyncImpl?: GatewayServiceSpawnSync
  timeoutMs?: number
}): void {
  runGatewayServiceCommand({
    ...params,
    actionArgs: buildGatewayServiceInstallArgs(params.runtimeRoot, params.authToken),
  })
  runGatewayServiceCommand({
    ...params,
    actionArgs: ['gateway', 'start', '--json'],
  })
}

function runGatewayServiceCommand(params: {
  nodePath: string
  runtimeRoot: string
  stateDir: string
  authToken?: string
  authPassword?: string
  baseEnv?: NodeJS.ProcessEnv
  spawnSyncImpl?: GatewayServiceSpawnSync
  timeoutMs?: number
  actionArgs: string[]
}): void {
  const command = buildGatewayServiceCommand({
    nodePath: params.nodePath,
    runtimeRoot: params.runtimeRoot,
    args: params.actionArgs,
  })
  const result = (params.spawnSyncImpl ?? spawnGatewayServiceCommand)(
    command.file,
    command.args,
    {
      cwd: command.cwd,
      env: buildGatewayServiceEnv(params),
      encoding: 'utf-8',
      timeout: params.timeoutMs ?? 120_000,
    },
  )
  if (result.status !== 0) {
    const suffix = result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`
    const detail = String(result.stderr || result.stdout || '').trim()
    throw new Error(`Gateway service bootstrap failed with ${suffix}${detail ? `: ${detail}` : ''}`)
  }
}

function buildGatewayServiceCommand(params: {
  nodePath: string
  runtimeRoot: string
  args: string[]
}): { file: string; args: string[]; cwd: string } {
  return {
    file: params.nodePath,
    args: [join(params.runtimeRoot, 'crawclaw.mjs'), ...params.args],
    cwd: params.runtimeRoot,
  }
}

function buildGatewayServiceInstallArgs(runtimeRoot: string, authToken: string | undefined): string[] {
  const runtimeEntryPath = join(runtimeRoot, 'crawclaw.mjs')
  const args = [
    'gateway',
    'install',
    '--force',
    '--runtime',
    'node',
    '--runtime-entry',
    runtimeEntryPath,
  ]
  if (authToken) {
    args.push('--token', authToken)
  }
  args.push('--json')
  return args
}

function buildGatewayServiceEnv(params: {
  stateDir: string
  runtimeRoot: string
  authToken?: string
  authPassword?: string
  baseEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(params.baseEnv ?? process.env),
    ELECTRON_RUN_AS_NODE: '1',
    CRAWCLAW_STATE_DIR: params.stateDir,
    CRAWCLAW_DESKTOP_RUNTIME_ROOT: params.runtimeRoot,
    CRAWCLAW_PLUGIN_RUNTIMES_DIR: [
      join(params.stateDir, 'runtimes'),
      join(params.runtimeRoot, 'runtimes'),
    ].join(delimiter),
  }
  setOptionalEnv(env, 'CRAWCLAW_GATEWAY_TOKEN', params.authToken)
  setOptionalEnv(env, 'CRAWCLAW_GATEWAY_PASSWORD', params.authPassword)
  return env
}

function setOptionalEnv(env: NodeJS.ProcessEnv, key: string, value: string | undefined): void {
  if (value?.trim()) {
    env[key] = value
  }
}

const spawnGatewayServiceCommand: GatewayServiceSpawnSync = (file, args, options) =>
  spawnSync(file, args, options)
