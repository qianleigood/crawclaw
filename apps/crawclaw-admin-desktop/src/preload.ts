import { contextBridge, ipcRenderer } from 'electron'

export interface CrawClawDesktopHost {
  openExternal(url: string): Promise<void>
}

const host: CrawClawDesktopHost = {
  async openExternal(url: string): Promise<void> {
    await ipcRenderer.invoke('desktop:open-external', url)
  },
}

contextBridge.exposeInMainWorld('crawclawDesktop', host)

declare global {
  interface Window {
    crawclawDesktop?: CrawClawDesktopHost
  }
}
