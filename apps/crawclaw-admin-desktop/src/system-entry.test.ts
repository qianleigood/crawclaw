import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DESKTOP_GLOBAL_SHORTCUT,
  buildDesktopAppMenuTemplate,
  buildDesktopPermissionGuide,
} from './system-entry.js'

void test('buildDesktopAppMenuTemplate exposes the desktop system entry actions', () => {
  const template = buildDesktopAppMenuTemplate({
    isMac: true,
    onShow: () => {},
    onAskScreenshot: () => {},
    onOpenSettings: () => {},
    onQuit: () => {},
  })

  assert.equal(DESKTOP_GLOBAL_SHORTCUT, 'CommandOrControl+Shift+Space')
  assert.equal(template[0]?.label, 'CrawClaw Desktop')
  const appSubmenu = template[0]?.submenu
  assert.ok(Array.isArray(appSubmenu))
  const appSubmenuItems = appSubmenu
  assert.deepEqual(
    appSubmenuItems.map((item) => item.label),
    [
      'Show CrawClaw Desktop',
      'Ask about Screenshot',
      'Settings',
      undefined,
      'Quit CrawClaw Desktop',
    ]
  )
})

void test('buildDesktopPermissionGuide returns macOS guidance for screenshot workflows', () => {
  const guide = buildDesktopPermissionGuide('darwin')

  assert.equal(guide.screenRecording.status, 'needs-system-settings')
  assert.equal(guide.accessibility.status, 'needs-system-settings')
  assert.match(guide.screenRecording.message, /System Settings/)
})
