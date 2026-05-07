import { posix, win32 } from 'path'

export function resolveAdminPaths(env = process.env, opts = {}) {
  const platform = opts.platform || process.platform
  const homeDir = opts.homeDir || env.HOME || env.USERPROFILE || process.cwd()
  const platformPath = pathForPlatform(platform)
  const stateDir =
    env.CRAWCLAW_ADMIN_STATE_DIR || defaultStateDir(platform, platformPath, env, homeDir)

  return {
    runtimeMode: env.CRAWCLAW_ADMIN_RUNTIME_MODE === 'desktop' ? 'desktop' : 'web',
    stateDir,
    configPath: env.CRAWCLAW_ADMIN_CONFIG_PATH || platformPath.join(stateDir, 'config.json'),
    dataDir: env.CRAWCLAW_ADMIN_DATA_DIR || platformPath.join(stateDir, 'data'),
    backupDir: env.CRAWCLAW_ADMIN_BACKUP_DIR || platformPath.join(stateDir, 'backups'),
    logDir: env.CRAWCLAW_ADMIN_LOG_DIR || platformPath.join(stateDir, 'logs'),
  }
}

function pathForPlatform(platform) {
  return platform === 'win32' ? win32 : posix
}

function defaultStateDir(platform, platformPath, env, homeDir) {
  if (platform === 'darwin') {
    return platformPath.join(homeDir, 'Library', 'Application Support', 'CrawClaw Admin')
  }

  if (platform === 'win32') {
    return platformPath.join(
      env.APPDATA || platformPath.join(homeDir, 'AppData', 'Roaming'),
      'CrawClaw Admin'
    )
  }

  return platformPath.join(
    env.XDG_CONFIG_HOME || platformPath.join(homeDir, '.config'),
    'crawclaw-admin'
  )
}
