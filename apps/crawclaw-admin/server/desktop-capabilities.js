import { accessSync, constants, existsSync, statSync } from 'fs'
import { dirname, resolve } from 'path'

const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32', 'linux'])

export function buildDesktopCapabilities(params = {}) {
  const platform = normalizePlatform(params.platform || process.platform)
  const env = params.env || process.env
  const runtimeMode = params.runtimeMode === 'desktop' ? 'desktop' : 'web'
  const desktopLocal = runtimeMode === 'desktop' && env.CRAWCLAW_ADMIN_DESKTOP_LOCAL === '1'
  const paths = params.paths || {}
  const filesWritable = isCreatableOrWritablePath(paths.dataDir)
  const backupWritable = isCreatableOrWritablePath(paths.backupDir)
  const remoteDesktop = resolveRemoteDesktopCapability(platform)
  const desktopInput = resolveDesktopInputCapability(platform)

  return {
    terminal: { available: true, platform },
    files: {
      available: filesWritable,
      platform,
      ...unavailableReason(filesWritable, 'Runtime data path is not configured.'),
    },
    backup: {
      available: backupWritable,
      platform,
      ...unavailableReason(backupWritable, 'Runtime backup path is not configured.'),
    },
    hermesCli: {
      available: Boolean(env.HERMES_CLI_PATH),
      platform,
      ...unavailableReason(Boolean(env.HERMES_CLI_PATH), 'Set HERMES_CLI_PATH to enable Hermes CLI.'),
    },
    n8n: { available: true, platform },
    comfyuiDownloads: { available: true, platform },
    systemMetrics: { available: true, platform },
    remoteDesktop,
    desktopInput,
    desktopUpdate: {
      available: runtimeMode === 'desktop',
      platform,
      ...unavailableReason(runtimeMode === 'desktop', 'Desktop updates are only available in desktop mode.'),
    },
    desktopLocal: {
      available: desktopLocal,
      platform,
      ...unavailableReason(desktopLocal, 'Desktop local runtime is only available in CrawClaw Desktop.'),
    },
  }
}

function resolveRemoteDesktopCapability(platform) {
  if (platform === 'linux') {
    return {
      available: true,
      platform,
      requirements: ['Xvfb', 'ffmpeg', 'x11vnc optional'],
    }
  }
  if (platform === 'win32') {
    return {
      available: true,
      platform,
      requirements: ['PowerShell desktop capture'],
    }
  }
  return {
    available: false,
    platform,
    reason: 'Remote desktop capture is not implemented for this platform.',
  }
}

function resolveDesktopInputCapability(platform) {
  if (platform === 'linux') {
    return {
      available: true,
      platform,
      requirements: ['xdotool'],
    }
  }
  return {
    available: false,
    platform,
    reason: 'Desktop input is only implemented for Linux display sessions.',
  }
}

function isCreatableOrWritablePath(targetPath) {
  if (!targetPath) {return false}
  const resolvedPath = resolve(String(targetPath))
  if (existsSync(resolvedPath)) {
    return isWritableDirectory(resolvedPath)
  }
  const ancestor = findExistingAncestor(resolvedPath)
  if (!ancestor || !isWritableDirectory(ancestor)) {return false}
  try {
    accessSync(ancestor, constants.W_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findExistingAncestor(targetPath) {
  let current = targetPath
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) {return null}
    current = parent
  }
  return current
}

function isWritableDirectory(targetPath) {
  try {
    return statSync(targetPath).isDirectory() && canSearchAndWrite(targetPath)
  } catch {
    return false
  }
}

function canSearchAndWrite(targetPath) {
  try {
    accessSync(targetPath, constants.W_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

function unavailableReason(available, reason) {
  return available ? {} : { reason }
}

function normalizePlatform(platform) {
  return SUPPORTED_PLATFORMS.has(platform) ? platform : String(platform || 'unknown')
}

export function desktopServerPlatform(platform = process.platform) {
  const normalized = normalizePlatform(platform)
  if (normalized === 'linux') {return 'linux'}
  if (normalized === 'win32') {return 'windows'}
  return null
}
