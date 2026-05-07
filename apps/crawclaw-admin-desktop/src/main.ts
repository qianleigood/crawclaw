import { app, BrowserWindow, ipcMain, shell } from 'electron'
import log from 'electron-log'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDesktopAppPaths, resolveDesktopAppPaths } from './app-paths.js'
import { startAdminBackend, type BackendLaunchResult } from './backend-launch.js'
import { loadDesktopConfig } from './config-store.js'
import { bootstrapLocalGatewayConfig } from './gateway-bootstrap.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | undefined
let backend: BackendLaunchResult | undefined
let backendUrl: string | undefined
let quitAfterBackendStop = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  })

  app.whenReady().then(startDesktopApp).catch((error: unknown) => {
    log.error('[desktop] Failed to start CrawClaw Desktop', error)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendUrl) {
      createMainWindow(backendUrl)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', (event) => {
    if (!backend || quitAfterBackendStop) {
      return
    }

    event.preventDefault()
    quitAfterBackendStop = true
    const backendToStop = backend
    backend = undefined
    void backendToStop.stop().finally(() => {
      app.quit()
    })
  })
}

async function startDesktopApp(): Promise<void> {
  installHostIpc()

  const paths = resolveDesktopAppPaths(app)
  ensureDesktopAppPaths(paths)
  const desktopConfig = await loadDesktopConfig(paths.configPath)
  const runtimeRoot = resolveBundledRuntimeRoot()
  const crawclawStateDir = resolveCrawClawStateDir()
  const gatewayBootstrap = await bootstrapLocalGatewayConfig({
    stateDir: crawclawStateDir,
  })

  backend = await startAdminBackend({
    adminRoot: resolveAdminRoot(),
    paths,
    gateway: {
      wsUrl: gatewayBootstrap.wsUrl,
      authToken: gatewayBootstrap.authToken,
      locale: process.env.CRAWCLAW_LOCALE || desktopConfig.locale,
      runtimeRoot,
      crawclawStateDir,
      nodePath: process.execPath,
    },
  })
  backendUrl = backend.url
  createMainWindow(backend.url)
}

function createMainWindow(url: string): void {
  const backendOrigin = new URL(url).origin
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    title: 'CrawClaw Desktop',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    void openExternalUrl(targetUrl)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (new URL(targetUrl).origin === backendOrigin) {
      return
    }

    event.preventDefault()
    void openExternalUrl(targetUrl)
  })
  mainWindow.on('close', (event) => {
    if (quitAfterBackendStop) {
      return
    }
    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.once('closed', () => {
    mainWindow = undefined
  })
  void mainWindow.loadURL(url)
}

function installHostIpc(): void {
  ipcMain.handle('desktop:open-external', async (_event, url: string) => {
    await openExternalUrl(url)
  })
}

async function openExternalUrl(url: string): Promise<void> {
  const parsedUrl = new URL(url)
  if (!['https:', 'http:', 'mailto:'].includes(parsedUrl.protocol)) {
    throw new Error(`Unsupported external URL protocol: ${parsedUrl.protocol}`)
  }
  await shell.openExternal(parsedUrl.toString())
}

function resolveAdminRoot(): string {
  const override = process.env.CRAWCLAW_ADMIN_DESKTOP_ADMIN_ROOT
  if (override?.trim()) {
    return resolve(override)
  }

  if (app.isPackaged) {
    return join(process.resourcesPath, 'admin')
  }

  return resolve(__dirname, '..', '..', 'crawclaw-admin')
}

function resolveBundledRuntimeRoot(): string {
  const override = process.env.CRAWCLAW_DESKTOP_RUNTIME_ROOT
  if (override?.trim()) {
    return resolve(override)
  }

  if (app.isPackaged) {
    return join(process.resourcesPath, 'runtime', 'crawclaw')
  }

  return resolve(__dirname, '..', '..', '..')
}

function resolveCrawClawStateDir(): string {
  const override = process.env.CRAWCLAW_STATE_DIR
  if (override?.trim()) {
    return resolve(override)
  }
  return join(homedir(), '.crawclaw')
}
