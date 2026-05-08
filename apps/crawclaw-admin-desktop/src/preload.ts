import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { DesktopPermissionGuide, DesktopScreenshotResult } from './system-entry.js'

export interface CrawClawDesktopHost {
  openExternal(url: string): Promise<void>
  showMainWindow(): Promise<void>
  captureScreen(): Promise<DesktopScreenshotResult>
  getPermissionGuide(): Promise<DesktopPermissionGuide>
  onScreenshotCaptured(callback: (result: DesktopScreenshotResult) => void): () => void
}

const host: CrawClawDesktopHost = {
  async openExternal(url: string): Promise<void> {
    await ipcRenderer.invoke('desktop:open-external', url)
  },
  async showMainWindow(): Promise<void> {
    await ipcRenderer.invoke('desktop:show-main-window')
  },
  async captureScreen(): Promise<DesktopScreenshotResult> {
    return await ipcRenderer.invoke('desktop:capture-screen') as DesktopScreenshotResult
  },
  async getPermissionGuide(): Promise<DesktopPermissionGuide> {
    return await ipcRenderer.invoke('desktop:get-permission-guide') as DesktopPermissionGuide
  },
  onScreenshotCaptured(callback: (result: DesktopScreenshotResult) => void): () => void {
    const listener = (_event: IpcRendererEvent, result: DesktopScreenshotResult) => {
      callback(result)
    }
    ipcRenderer.on('desktop:screenshot-captured', listener)
    return () => {
      ipcRenderer.off('desktop:screenshot-captured', listener)
    }
  },
}

contextBridge.exposeInMainWorld('crawclawDesktop', host)

declare global {
  interface Window {
    crawclawDesktop?: CrawClawDesktopHost
  }
}
