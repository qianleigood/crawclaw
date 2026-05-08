import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import log from 'electron-log'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDesktopAppPaths, resolveDesktopAppPaths } from './app-paths.js'
import { startAdminBackend, type BackendLaunchResult } from './backend-launch.js'
import { loadDesktopConfig } from './config-store.js'
import { bootstrapLocalGatewayConfig } from './gateway-bootstrap.js'
import { runGatewayServiceBootstrap } from './gateway-service.js'
import { resolveCrawClawStateDir, resolveDesktopNodePath, resolveDesktopRuntimeRoot } from './runtime-paths.js'
import {
  DESKTOP_GLOBAL_SHORTCUT,
  buildDesktopAppMenuTemplate,
  buildDesktopPermissionGuide,
  buildDesktopTrayMenuTemplate,
  type DesktopScreenshotResult,
} from './system-entry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const TRAY_ICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><rect x="3" y="3" width="12" height="12" rx="3" fill="black"/><circle cx="7" cy="8" r="1.2" fill="white"/><circle cx="11" cy="8" r="1.2" fill="white"/><path d="M6.5 11.5h5" stroke="white" stroke-width="1.4" stroke-linecap="round"/></svg>')}`

let mainWindow: BrowserWindow | undefined
let backend: BackendLaunchResult | undefined
let backendUrl: string | undefined
let mediaRoot: string | undefined
let tray: Tray | undefined
let quitAfterBackendStop = false
let allowWindowClose = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(startDesktopApp).catch((error: unknown) => {
    log.error('[desktop] Failed to start CrawClaw Desktop', error)
    app.quit()
  })

  app.on('activate', () => {
    if (mainWindow) {
      showMainWindow()
      return
    }
    if (BrowserWindow.getAllWindows().length === 0 && backendUrl) {
      createMainWindow(backendUrl)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    tray?.destroy()
    tray = undefined
  })

  app.on('before-quit', (event) => {
    if (!backend || quitAfterBackendStop) {
      return
    }

    event.preventDefault()
    quitAfterBackendStop = true
    allowWindowClose = true
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
  const crawclawStateDir = resolveCrawClawStateDir(process.env)
  mediaRoot = join(crawclawStateDir, 'media')
  const localGateway = await bootstrapLocalGatewayConfig({
    stateDir: crawclawStateDir,
  })
  const runtimeRoot = resolveDesktopRuntimeRoot({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    moduleDir: __dirname,
    env: process.env,
  })
  const desktopNodePath = resolveDesktopNodePath({
    runtimeRoot,
    env: process.env,
  })
  const gatewayAuthToken = process.env.CRAWCLAW_AUTH_TOKEN ?? localGateway.authToken
  const gatewayAuthPassword = process.env.CRAWCLAW_AUTH_PASSWORD ?? localGateway.authPassword
  runGatewayServiceBootstrap({
    nodePath: desktopNodePath,
    runtimeRoot,
    stateDir: crawclawStateDir,
    authToken: gatewayAuthToken,
    authPassword: gatewayAuthPassword,
  })

  backend = await startAdminBackend({
    adminRoot: resolveAdminRoot(),
    paths,
    gateway: {
      wsUrl: process.env.CRAWCLAW_WS_URL || localGateway.wsUrl,
      authToken: gatewayAuthToken,
      authPassword: gatewayAuthPassword,
      locale: process.env.CRAWCLAW_LOCALE || desktopConfig.locale,
      runtimeRoot,
      nodePath: desktopNodePath,
      crawclawStateDir,
    },
  })
  backendUrl = backend.url
  createMainWindow(backend.url)
  installSystemEntry()
}

function createMainWindow(url: string): void {
  const backendOrigin = new URL(url).origin
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
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
    if (allowWindowClose) {
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

function showMainWindow(): void {
  if (!mainWindow) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }
  mainWindow.focus()
}

function installHostIpc(): void {
  ipcMain.handle('desktop:open-external', async (_event, url: string) => {
    await openExternalUrl(url)
  })
  ipcMain.handle('desktop:show-main-window', () => {
    showMainWindow()
  })
  ipcMain.handle('desktop:capture-screen', async () => capturePrimaryScreen())
  ipcMain.handle('desktop:get-permission-guide', () => buildDesktopPermissionGuide(process.platform))
}

function installSystemEntry(): void {
  const handlers = {
    isMac: process.platform === 'darwin',
    onShow: showMainWindow,
    onAskScreenshot: () => {
      void askAboutScreenshot()
    },
    onOpenSettings: openSettings,
    onQuit: () => {
      allowWindowClose = true
      app.quit()
    },
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(buildDesktopAppMenuTemplate(handlers)))
  installTray(handlers)
  if (!globalShortcut.register(DESKTOP_GLOBAL_SHORTCUT, showMainWindow)) {
    log.warn(`[desktop] Failed to register global shortcut ${DESKTOP_GLOBAL_SHORTCUT}`)
  }
}

function installTray(handlers: Parameters<typeof buildDesktopTrayMenuTemplate>[0]): void {
  if (tray) {
    return
  }

  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('CrawClaw Desktop')
  tray.setContextMenu(Menu.buildFromTemplate(buildDesktopTrayMenuTemplate(handlers)))
  tray.on('click', showMainWindow)
}

function openSettings(): void {
  showMainWindow()
  if (!mainWindow || !backendUrl) {
    return
  }

  void mainWindow.loadURL(new URL('/settings', backendUrl).toString())
}

async function askAboutScreenshot(): Promise<void> {
  showMainWindow()
  const result = await capturePrimaryScreen()
  mainWindow?.webContents.send('desktop:screenshot-captured', result)
}

async function capturePrimaryScreen(): Promise<DesktopScreenshotResult> {
  try {
    const [source] = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1600, height: 1000 },
      fetchWindowIcons: false,
    })
    if (!source || source.thumbnail.isEmpty()) {
      return { ok: false, error: 'No screen source is available.' }
    }
    const mediaPath = await saveScreenshotToMedia(source.thumbnail.toPNG())
    return {
      ok: true,
      dataUrl: source.thumbnail.toDataURL(),
      mediaPath,
      sourceName: source.name,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

async function saveScreenshotToMedia(image: Buffer): Promise<string | undefined> {
  if (!mediaRoot) {
    return undefined
  }

  const relativeDir = 'desktop'
  const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  await mkdir(join(mediaRoot, relativeDir), { recursive: true })
  await writeFile(join(mediaRoot, relativeDir, filename), image)
  return `${relativeDir}/${filename}`
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
