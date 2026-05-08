export type DesktopPlatform = 'darwin' | 'win32' | 'linux' | (string & {})

export interface DesktopCapability {
  available: boolean
  platform: DesktopPlatform
  reason?: string
  requirements?: string[]
}

export interface DesktopCapabilities {
  terminal: DesktopCapability
  files: DesktopCapability
  backup: DesktopCapability
  hermesCli: DesktopCapability
  n8n: DesktopCapability
  comfyuiDownloads: DesktopCapability
  systemMetrics: DesktopCapability
  remoteDesktop: DesktopCapability
  desktopInput: DesktopCapability
  desktopUpdate: DesktopCapability
  desktopLocal: DesktopCapability
}

export type DesktopRuntimeAction =
  | 'bootstrap'
  | 'status'
  | 'service.start'
  | 'service.stop'
  | 'service.restart'
  | 'logs.tail'
  | 'runtimes.list'
  | 'runtimes.install'

export interface DesktopRuntimeActionResponse<T = unknown> {
  action: DesktopRuntimeAction | (string & {})
  result: T
}

export interface DesktopRuntimeLogsTailParams {
  lines?: number
  sinceMs?: number
}

export interface DesktopOptionalRuntime {
  id: string
  name?: string
  description?: string
  estimatedSize?: string
  state: string
  installed: boolean
  reason?: string
  error?: string
  version?: string
  installDir?: string
}
