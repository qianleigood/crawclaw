import type { MenuItemConstructorOptions } from 'electron'

export const DESKTOP_GLOBAL_SHORTCUT = 'CommandOrControl+Shift+Space'

export interface DesktopAppMenuHandlers {
  isMac: boolean
  onShow(): void
  onAskScreenshot(): void
  onOpenSettings(): void
  onQuit(): void
}

export interface DesktopPermissionItem {
  status: 'not-applicable' | 'needs-system-settings'
  message: string
}

export interface DesktopPermissionGuide {
  platform: NodeJS.Platform
  screenRecording: DesktopPermissionItem
  accessibility: DesktopPermissionItem
}

export interface DesktopScreenshotResult {
  ok: boolean
  dataUrl?: string
  mediaPath?: string
  sourceName?: string
  error?: string
}

export function buildDesktopAppMenuTemplate(handlers: DesktopAppMenuHandlers): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions = {
    label: 'CrawClaw Desktop',
    submenu: [
      {
        label: 'Show CrawClaw Desktop',
        accelerator: DESKTOP_GLOBAL_SHORTCUT,
        click: () => handlers.onShow(),
      },
      {
        label: 'Ask about Screenshot',
        accelerator: 'CommandOrControl+Shift+S',
        click: () => handlers.onAskScreenshot(),
      },
      {
        label: 'Settings',
        accelerator: 'CommandOrControl+,',
        click: () => handlers.onOpenSettings(),
      },
      { type: 'separator' },
      {
        label: 'Quit CrawClaw Desktop',
        accelerator: handlers.isMac ? 'Command+Q' : 'Control+Q',
        click: () => handlers.onQuit(),
      },
    ],
  }

  return handlers.isMac
    ? [
      appMenu,
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]
    : [
      appMenu,
      { role: 'viewMenu' },
    ]
}

export function buildDesktopTrayMenuTemplate(handlers: Omit<DesktopAppMenuHandlers, 'isMac'>): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Show CrawClaw Desktop',
      click: () => handlers.onShow(),
    },
    {
      label: 'Ask about Screenshot',
      click: () => handlers.onAskScreenshot(),
    },
    {
      label: 'Settings',
      click: () => handlers.onOpenSettings(),
    },
    { type: 'separator' },
    {
      label: 'Quit CrawClaw Desktop',
      click: () => handlers.onQuit(),
    },
  ]
}

export function buildDesktopPermissionGuide(platform: NodeJS.Platform): DesktopPermissionGuide {
  if (platform !== 'darwin') {
    return {
      platform,
      screenRecording: {
        status: 'not-applicable',
        message: 'Screen capture permission is managed by the operating system.',
      },
      accessibility: {
        status: 'not-applicable',
        message: 'Accessibility permission is managed by the operating system.',
      },
    }
  }

  return {
    platform,
    screenRecording: {
      status: 'needs-system-settings',
      message: 'Enable Screen Recording for CrawClaw Desktop in System Settings before asking about screenshots.',
    },
    accessibility: {
      status: 'needs-system-settings',
      message: 'Enable Accessibility for CrawClaw Desktop in System Settings before using desktop control shortcuts.',
    },
  }
}
