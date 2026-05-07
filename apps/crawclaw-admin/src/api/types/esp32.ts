export interface Esp32StatusSummary {
  enabled: boolean
  serviceRunning: boolean
  broker: {
    mode?: string
    bindHost: string
    port: number
    advertisedHost?: string
  }
  udp: {
    bindHost: string
    port: number
    advertisedHost?: string
  }
  renderer: {
    model?: string
    timeoutMs?: number
    maxSpokenChars?: number
    maxDisplayChars?: number
  }
  tts: {
    provider: string
    target: string
  }
  tools: {
    allowlist: string[]
    highRiskRequiresApproval: boolean
  }
  counts: {
    activePairingSessions: number
    pendingRequests: number
    pairedDevices: number
    onlineDevices: number
  }
  activePairingSessions: Esp32PairingSessionSummary[]
}

export interface Esp32PairingSessionSummary {
  pairId: string
  username: string
  name?: string
  hardwareTarget: string
  issuedAtMs: number
  expiresAtMs: number
}

export interface Esp32PairingStartResult extends Esp32PairingSessionSummary {
  pairCode: string
  broker: {
    host: string
    port: number
  }
  udp: {
    host: string
    port: number
  }
  profile: {
    hardwareTarget: string
    audio: {
      input: string
      output: string
      codec: string
    }
    display: {
      width: number
      height: number
      color: boolean
    }
  }
}

export interface Esp32DeviceTool {
  name: string
  risk?: 'low' | 'medium' | 'high'
  description?: string
}

export interface Esp32DeviceCapabilities {
  hardwareTarget?: string
  display?: {
    width?: number
    height?: number
    color?: boolean
  }
  audio?: {
    input?: string
    output?: string
    codec?: string
    opus?: boolean
  }
  buttons?: string[]
  expressions?: string[]
  leds?: string[]
  chimes?: string[]
  tools?: Esp32DeviceTool[]
}

export interface Esp32PairingRequestSummary {
  requestId: string
  deviceId: string
  name?: string
  fingerprint?: string
  hardwareTarget: string
  clientMode: string
  requestedAtMs: number
  capabilities: Esp32DeviceCapabilities
}

export interface Esp32DeviceSummary {
  deviceId: string
  name?: string
  fingerprint?: string
  hardwareTarget: string
  clientMode: string
  online: boolean
  lastSeenAtMs?: number
  approvedAtMs?: number
  capabilities: Esp32DeviceCapabilities
}

export interface Esp32DeviceDetail extends Esp32DeviceSummary {
  paired: Record<string, unknown>
}
