import { runDesktopRuntimeAction } from './desktop-runtime.js'

const OPTIONAL_RUNTIMES = [
  {
    id: 'n8n',
    name: 'n8n',
    description: 'Workflow automation runtime',
    estimatedSize: '2.2 GB',
  },
  {
    id: 'skill-openai-whisper',
    name: 'Whisper',
    description: 'Local OpenAI Whisper transcription runtime',
    estimatedSize: '1.0 GB',
  },
  {
    id: 'qwen3-tts',
    name: 'Qwen3-TTS',
    description: 'Local Qwen3 text-to-speech runtime',
    estimatedSize: 'large',
  },
]

export function runDesktopRuntimeApiAction(params) {
  if (!params.envConfig?.desktopLocal) {
    throw new Error('Desktop runtime actions require desktop-local mode.')
  }
  const runtimeRoot = params.envConfig.CRAWCLAW_DESKTOP_RUNTIME_ROOT
  if (!runtimeRoot) {
    throw new Error('CRAWCLAW_DESKTOP_RUNTIME_ROOT is not configured.')
  }

  return (params.runAction ?? runDesktopRuntimeAction)({
    runtimeRoot,
    nodePath: params.nodePath,
    action: params.action,
    baseEnv: params.baseEnv,
    authToken: params.envConfig.CRAWCLAW_AUTH_TOKEN,
    authPassword: params.envConfig.CRAWCLAW_AUTH_PASSWORD,
    logsParams: params.action === 'logs.tail' ? params.body ?? {} : undefined,
    runtimeId: params.runtimeId,
  })
}

export function listDesktopOptionalRuntimes(params) {
  const result = runDesktopRuntimeApiAction({
    ...params,
    action: 'runtimes.list',
  })
  const plugins = result?.manifest?.plugins ?? result?.result?.manifest?.plugins ?? {}
  return OPTIONAL_RUNTIMES.map((runtime) => {
    const entry = plugins[runtime.id]
    const state = typeof entry?.state === 'string' ? entry.state : 'not-installed'
    return {
      ...runtime,
      state,
      installed: state === 'healthy',
      reason: entry?.reason,
      error: entry?.error,
      version: entry?.version,
      installDir: entry?.installDir || entry?.venvDir,
    }
  })
}

export function installDesktopOptionalRuntime(params) {
  const runtimeId = String(params.runtimeId || '').trim()
  if (!OPTIONAL_RUNTIMES.some((runtime) => runtime.id === runtimeId)) {
    throw new Error(`Unsupported optional runtime: ${runtimeId}`)
  }
  runDesktopRuntimeApiAction({
    ...params,
    action: 'runtimes.install',
    runtimeId,
  })
  return listDesktopOptionalRuntimes(params).find((runtime) => runtime.id === runtimeId) ?? {
    id: runtimeId,
    state: 'unknown',
    installed: false,
  }
}
