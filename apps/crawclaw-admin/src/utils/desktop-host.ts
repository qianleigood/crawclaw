export interface DesktopScreenshotResult {
  ok: boolean
  dataUrl?: string
  mediaPath?: string
  sourceName?: string
  error?: string
}

export interface DesktopPermissionGuide {
  platform: string
  screenRecording: {
    status: string
    message: string
  }
  accessibility: {
    status: string
    message: string
  }
}

export interface CrawClawDesktopHost {
  openExternal(url: string): Promise<void>
  showMainWindow(): Promise<void>
  captureScreen(): Promise<DesktopScreenshotResult>
  getPermissionGuide(): Promise<DesktopPermissionGuide>
  onScreenshotCaptured(callback: (result: DesktopScreenshotResult) => void): () => void
}

interface DesktopHostWindow extends Window {
  crawclawDesktop?: CrawClawDesktopHost
}

export function getCrawClawDesktopHost(): CrawClawDesktopHost | null {
  return (window as DesktopHostWindow).crawclawDesktop ?? null
}

export function createDesktopScreenshotDraft(
  result: DesktopScreenshotResult,
  prompt: string
): string | null {
  if (!result.ok) {
    return null
  }

  const mediaRef = result.mediaPath
    ? `MEDIA:${result.mediaPath}`
    : result.dataUrl
      ? `![Screenshot](${result.dataUrl})`
      : ''
  if (!mediaRef) {
    return null
  }

  return `${prompt.trim()}\n\n${mediaRef}`
}
