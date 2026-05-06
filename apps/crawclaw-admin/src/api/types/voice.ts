export type Qwen3TtsProfile =
  | {
      source: 'preset'
      quality: 'fast' | 'balanced'
      voice: string
      language?: string
      instructions?: string
    }
  | {
      source: 'clone'
      quality: 'clone-fast' | 'clone'
      refAudio: string
      refText: string
      language?: string
      instructions?: string
    }
  | {
      source: 'design'
      prompt: string
      language?: string
    }

export interface VoiceOverviewResult {
  activeProvider?: string
  qwen3Tts: {
    enabled: boolean
    supported: boolean
    runtime: string
    managedRuntime: string | null
    autoStart: boolean
    baseUrl: string
    healthPath: string
    defaultProfile: string
    voiceDirectory: string
    profiles: Record<string, Qwen3TtsProfile>
    agentProfiles: Record<string, string>
    builtinVoices: string[]
    health: {
      reachable: boolean
      ready: boolean
      runtime?: string
      error?: string
    }
  }
}

export interface VoicePreviewParams {
  text: string
  profileId?: string
  draftProfile?: Qwen3TtsProfile
  agentId?: string
  target?: 'audio-file' | 'voice-note'
}

export interface VoicePreviewResult {
  audioBase64: string
  outputFormat: string
  fileExtension: string
  voiceCompatible: boolean
}

export interface VoiceUploadReferenceAudioParams {
  filename: string
  audioBase64: string
}

export interface VoiceUploadReferenceAudioResult {
  storedPath: string
  filename: string
}
