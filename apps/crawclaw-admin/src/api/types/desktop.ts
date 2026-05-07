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
