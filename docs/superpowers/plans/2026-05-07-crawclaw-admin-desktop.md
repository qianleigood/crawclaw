# CrawClaw Admin Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a beta-quality cross-platform desktop app for the tracked `apps/crawclaw-admin` console.

**Architecture:** Keep `apps/crawclaw-admin` as the business UI and local admin backend. Add a new Electron host package that starts the admin backend in desktop mode, loads the existing UI from a loopback URL, owns credentials and app paths, and builds macOS, Windows, and Linux artifacts. Backend changes happen first so the desktop host does not depend on source-tree paths, `.env`, fixed ports, or global npm update behavior.

**Tech Stack:** JavaScript ESM backend, TypeScript, Vue 3, Vite, Electron, Electron Builder, Electron utility process, Vitest, GitHub Actions.

---

## Scope

Included in the first beta:

- Desktop runtime mode for the existing admin backend.
- State, config, database, backup, and log paths outside the app bundle.
- Random loopback port selected by the desktop host.
- Desktop capability endpoint for platform-gated admin features.
- Electron host package under `apps/crawclaw-admin-desktop`.
- One active Gateway profile.
- OS credential storage wrapper for Gateway and Hermes secrets.
- First-run connection setup path using the existing admin Settings flow where possible.
- macOS `dmg` / `zip`, Windows `nsis`, and Linux `AppImage` build targets.
- GitHub Actions desktop preflight and draft release asset upload.
- Documentation for desktop trust, credentials, platform support, and release assets.

Explicitly out of scope for this pass:

- Starting or installing CrawClaw Gateway from the desktop app.
- Multiple saved Gateway profiles.
- Automatic update downloads.
- Store distribution.
- Full remote desktop parity across all platforms.
- Replacing the existing web/development admin backend flow.

## File Structure

Admin backend:

- Create `apps/crawclaw-admin/server/admin-paths.js`
- Create `apps/crawclaw-admin/server/runtime-config.js`
- Create `apps/crawclaw-admin/server/desktop-capabilities.js`
- Modify `apps/crawclaw-admin/server/database.js`
- Modify `apps/crawclaw-admin/server/index.js`
- Create `apps/crawclaw-admin/server/admin-paths.test.ts`
- Create `apps/crawclaw-admin/server/runtime-config.test.ts`
- Create `apps/crawclaw-admin/server/desktop-capabilities.test.ts`

Admin frontend:

- Create `apps/crawclaw-admin/src/api/types/desktop.ts`
- Modify `apps/crawclaw-admin/src/api/types/index.ts`
- Modify `apps/crawclaw-admin/src/api/rpc-client.ts`
- Create `apps/crawclaw-admin/src/stores/desktop.ts`
- Modify `apps/crawclaw-admin/src/views/settings/SettingsPage.vue`
- Modify `apps/crawclaw-admin/src/components/common/ConnectionStatus.vue`
- Create `apps/crawclaw-admin/src/api/rpc-client.desktop.test.ts`

Desktop host:

- Create `apps/crawclaw-admin-desktop/package.json`
- Create `apps/crawclaw-admin-desktop/package-lock.json`
- Create `apps/crawclaw-admin-desktop/tsconfig.json`
- Create `apps/crawclaw-admin-desktop/electron-builder.yml`
- Create `apps/crawclaw-admin-desktop/src/main.ts`
- Create `apps/crawclaw-admin-desktop/src/preload.ts`
- Create `apps/crawclaw-admin-desktop/src/app-paths.ts`
- Create `apps/crawclaw-admin-desktop/src/backend-launch.ts`
- Create `apps/crawclaw-admin-desktop/src/credential-store.ts`
- Create `apps/crawclaw-admin-desktop/src/config-store.ts`
- Create `apps/crawclaw-admin-desktop/src/update-check.ts`
- Create `apps/crawclaw-admin-desktop/src/*.test.ts` files beside the modules that own testable logic.

Repository scripts and CI:

- Modify `package.json`
- Create `scripts/admin-desktop-build.mjs`
- Create `scripts/admin-desktop-release-check.mjs`
- Create `.github/workflows/admin-desktop-release.yml`

Docs:

- Create `docs/install/desktop.md`
- Modify `docs/docs.json`
- Modify `apps/crawclaw-admin/README.md`
- Modify `apps/crawclaw-admin/README.en.md`

## Tasks

### Task 1: Add desktop path resolution

**Files:**

- Create `apps/crawclaw-admin/server/admin-paths.js`
- Create `apps/crawclaw-admin/server/admin-paths.test.ts`

- [x] **Step 1: Write path resolution tests**

Create `apps/crawclaw-admin/server/admin-paths.test.ts` with focused cases for macOS, Windows, Linux, and explicit env overrides.

Run: `pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/admin-paths.test.ts`

Expected: FAIL because `admin-paths.js` does not exist.

- [x] **Step 2: Implement `resolveAdminPaths`**

Create `apps/crawclaw-admin/server/admin-paths.js` exporting:

```js
export function resolveAdminPaths(env = process.env, opts = {}) {
  const platform = opts.platform || process.platform;
  const homeDir = opts.homeDir || env.HOME || env.USERPROFILE || process.cwd();
  const stateDir = env.CRAWCLAW_ADMIN_STATE_DIR || defaultStateDir(platform, env, homeDir);
  return {
    runtimeMode: env.CRAWCLAW_ADMIN_RUNTIME_MODE === "desktop" ? "desktop" : "web",
    stateDir,
    configPath: env.CRAWCLAW_ADMIN_CONFIG_PATH || join(stateDir, "config.json"),
    dataDir: env.CRAWCLAW_ADMIN_DATA_DIR || join(stateDir, "data"),
    backupDir: env.CRAWCLAW_ADMIN_BACKUP_DIR || join(stateDir, "backups"),
    logDir: env.CRAWCLAW_ADMIN_LOG_DIR || join(stateDir, "logs"),
  };
}
```

Include a local `defaultStateDir(platform, env, homeDir)` helper that returns:

- macOS: `~/Library/Application Support/CrawClaw Admin`
- Windows: `%APPDATA%/CrawClaw Admin`
- Linux: `$XDG_CONFIG_HOME/crawclaw-admin` or `~/.config/crawclaw-admin`

Use `path.win32` for Windows and `path.posix` for macOS/Linux so tests can
validate target-platform paths from any host OS.

- [x] **Step 3: Run tests**

Run: `pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/admin-paths.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

Run: `scripts/committer "Admin desktop: add runtime path resolution" apps/crawclaw-admin/server/admin-paths.js apps/crawclaw-admin/server/admin-paths.test.ts`

Committed as `5c8b903e5`.

### Task 2: Make backend runtime config explicit

**Files:**

- Create `apps/crawclaw-admin/server/runtime-config.js`
- Create `apps/crawclaw-admin/server/runtime-config.test.ts`
- Modify `apps/crawclaw-admin/server/index.js`

- [x] **Step 1: Write runtime config tests**

Create tests that cover:

- Existing web mode still reads `apps/crawclaw-admin/.env`.
- Desktop mode reads `CRAWCLAW_ADMIN_*` env values and does not require `.env`.
- `CRAWCLAW_ADMIN_BIND_HOST` defaults to `127.0.0.1` in desktop mode.
- `PORT` compatibility remains available for web mode.

Run: `pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/runtime-config.test.ts`

Expected: FAIL because `runtime-config.js` does not exist.

- [x] **Step 2: Extract config loading**

Move the config loading logic out of `apps/crawclaw-admin/server/index.js` into `runtime-config.js`.

Export:

```js
export function loadAdminRuntimeConfig(env = process.env, opts = {}) {
  const paths = resolveAdminPaths(env, opts);
  const parsed = paths.runtimeMode === "desktop" ? env : readDotEnv(opts.envPath);
  return {
    paths,
    bindHost:
      env.CRAWCLAW_ADMIN_BIND_HOST || (paths.runtimeMode === "desktop" ? "127.0.0.1" : "0.0.0.0"),
    port: Number(env.CRAWCLAW_ADMIN_PORT || parsed.PORT || 3001),
    crawclawWsUrl: readEnvValue(parsed, "CRAWCLAW_WS_URL", "ws://localhost:18789"),
    crawclawAuthToken: readEnvValue(parsed, "CRAWCLAW_AUTH_TOKEN", ""),
    crawclawAuthPassword: readEnvValue(parsed, "CRAWCLAW_AUTH_PASSWORD", ""),
    authUsername: parsed.AUTH_USERNAME || "",
    authPassword: parsed.AUTH_PASSWORD || "",
    logLevel: parsed.LOG_LEVEL || "INFO",
  };
}
```

Keep the existing legacy CrawClaw env key support in the extracted module.

Desktop mode additionally treats non-loopback bind host overrides as unsafe and
falls back to `127.0.0.1`.

- [x] **Step 3: Wire `index.js` to runtime config**

Replace the local `envPath`, `loadEnvConfig`, and env parsing block in `apps/crawclaw-admin/server/index.js` with the new `loadAdminRuntimeConfig()` call. Keep existing route behavior unchanged except for reading values from the returned config object.

- [x] **Step 4: Run tests and admin build**

Run:

```bash
pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/runtime-config.test.ts apps/crawclaw-admin/server/admin-paths.test.ts
npm --prefix apps/crawclaw-admin run build
```

Expected: both commands pass.

- [x] **Step 5: Commit**

Run: `scripts/committer "Admin desktop: extract backend runtime config" apps/crawclaw-admin/server/runtime-config.js apps/crawclaw-admin/server/runtime-config.test.ts apps/crawclaw-admin/server/index.js`

Committed as `516ff4803`, with follow-up coverage commit `5a7a11e0a` and
desktop bind safety commit `d8f5fa141`.

### Task 3: Move mutable backend state behind desktop paths

**Files:**

- Modify `apps/crawclaw-admin/server/database.js`
- Modify `apps/crawclaw-admin/server/index.js`
- Create or extend `apps/crawclaw-admin/server/runtime-config.test.ts`

- [x] **Step 1: Add tests for mutable paths**

Extend tests to prove desktop mode resolves:

- SQLite path under `CRAWCLAW_ADMIN_DATA_DIR`.
- Backup directory under `CRAWCLAW_ADMIN_BACKUP_DIR`.
- Config path under `CRAWCLAW_ADMIN_CONFIG_PATH`.

Run: `pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/runtime-config.test.ts`

Expected: FAIL because database and backup paths still use source-relative defaults.

- [x] **Step 2: Update `database.js`**

Change `dbPath` to use `process.env.CRAWCLAW_ADMIN_DATA_DIR` when set:

```js
const dataDir = process.env.CRAWCLAW_ADMIN_DATA_DIR
  ? resolve(process.env.CRAWCLAW_ADMIN_DATA_DIR)
  : join(__dirname, "../data");
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, "wizard.db");
```

Import `resolve` and `mkdirSync` from Node built-ins as needed.

- [x] **Step 3: Update backup/config path usage**

In `apps/crawclaw-admin/server/index.js`, route config writes through the runtime config path and route backup reads/writes through the runtime backup directory. Keep the existing `.env` path only for non-desktop mode.

- [x] **Step 4: Run tests**

Run:

```bash
pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/runtime-config.test.ts
npm --prefix apps/crawclaw-admin run build
```

Expected: both commands pass.

- [x] **Step 5: Commit**

Run: `scripts/committer "Admin desktop: move mutable state to runtime paths" apps/crawclaw-admin/server/database.js apps/crawclaw-admin/server/index.js apps/crawclaw-admin/server/runtime-config.test.ts`

Committed as `2d53967fe`, with follow-up hardening commits `ca26c19c0a`,
`d929292f2`, `3a6e7bdcd`, `142768597`, `62ead75a2`, and `3b34b3991`.

### Task 4: Add desktop capability reporting

**Files:**

- Create `apps/crawclaw-admin/server/desktop-capabilities.js`
- Create `apps/crawclaw-admin/server/desktop-capabilities.test.ts`
- Modify `apps/crawclaw-admin/server/index.js`

- [x] **Step 1: Write capability tests**

Test `buildDesktopCapabilities({ platform, env, runtimeMode })` for:

- Terminal available on all three platforms.
- Files and backup available when runtime paths are writable.
- Remote desktop available only when the backend can support it.
- Desktop update available only in desktop mode.

Run: `pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/desktop-capabilities.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement capability builder**

Create `buildDesktopCapabilities()` returning:

```js
{
  terminal: { available: true, platform },
  files: { available: true, platform },
  backup: { available: true, platform },
  hermesCli: { available: Boolean(env.HERMES_CLI_PATH), platform, reason },
  n8n: { available: true, platform },
  comfyuiDownloads: { available: true, platform },
  systemMetrics: { available: true, platform },
  remoteDesktop: { available, platform, reason },
  desktopInput: { available, platform, reason },
  desktopUpdate: { available: runtimeMode === 'desktop', platform },
}
```

Use explicit `reason` strings for unavailable capabilities so frontend copy can explain the state.

- [x] **Step 3: Expose endpoint**

Add `GET /api/desktop/capabilities` in `apps/crawclaw-admin/server/index.js` behind the existing auth middleware.

- [x] **Step 4: Run tests**

Run:

```bash
pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/desktop-capabilities.test.ts
npm --prefix apps/crawclaw-admin run build
```

Expected: both commands pass.

- [x] **Step 5: Commit**

Run: `scripts/committer "Admin desktop: report platform capabilities" apps/crawclaw-admin/server/desktop-capabilities.js apps/crawclaw-admin/server/desktop-capabilities.test.ts apps/crawclaw-admin/server/index.js`

Committed as `a40e632aa`.

### Task 5: Disable npm global update in desktop mode

**Files:**

- Modify `apps/crawclaw-admin/server/index.js`
- Create or extend `apps/crawclaw-admin/server/runtime-config.test.ts`

- [x] **Step 1: Add desktop update behavior test**

Add a test or server-level helper test proving desktop mode returns a structured desktop-update response instead of executing `npm install -g`.

Run: `pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/runtime-config.test.ts`

Expected: FAIL until the helper exists.

- [x] **Step 2: Extract update decision helper**

Add a small helper in `index.js` or a local server module:

```js
function resolveUpdateMode(runtimeMode) {
  return runtimeMode === "desktop" ? "desktop-release" : "npm-global";
}
```

Use it in `/api/npm/update`.

- [x] **Step 3: Return desktop update response**

When update mode is `desktop-release`, return:

```js
{
  ok: false,
  updateMode: 'desktop-release',
  error: 'Desktop builds update through GitHub Releases.'
}
```

Do not invoke `execSync` in this branch.

- [x] **Step 4: Run tests and build**

Run:

```bash
pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/runtime-config.test.ts
npm --prefix apps/crawclaw-admin run build
```

Expected: both commands pass.

- [x] **Step 5: Commit**

Run: `scripts/committer "Admin desktop: disable npm updates in desktop mode" apps/crawclaw-admin/server/index.js apps/crawclaw-admin/server/runtime-config.test.ts`

Committed as `4c57100af`.

### Task 6: Add frontend desktop capability access

**Files:**

- Create `apps/crawclaw-admin/src/api/types/desktop.ts`
- Modify `apps/crawclaw-admin/src/api/types/index.ts`
- Modify `apps/crawclaw-admin/src/api/rpc-client.ts`
- Create `apps/crawclaw-admin/src/api/rpc-client.desktop.test.ts`
- Create `apps/crawclaw-admin/src/stores/desktop.ts`
- Create `apps/crawclaw-admin/src/stores/desktop.test.ts`
- Modify `apps/crawclaw-admin/src/layouts/DefaultLayout.vue`
- Create `apps/crawclaw-admin/src/layouts/DefaultLayout.desktop.test.ts`

- [x] **Step 1: Add RPC client test**

Create `rpc-client.desktop.test.ts` asserting that the client calls `/api/desktop/capabilities` through the HTTP API surface or a dedicated helper without a Gateway RPC method name.

Run: `pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/src/api/rpc-client.desktop.test.ts`

Expected: FAIL because the helper and types do not exist.

- [x] **Step 2: Add desktop types**

Create `apps/crawclaw-admin/src/api/types/desktop.ts`:

```ts
export type DesktopPlatform = "darwin" | "win32" | "linux";

export interface DesktopCapability {
  available: boolean;
  platform: DesktopPlatform;
  reason?: string;
  requirements?: string[];
}

export interface DesktopCapabilities {
  terminal: DesktopCapability;
  files: DesktopCapability;
  backup: DesktopCapability;
  hermesCli: DesktopCapability;
  n8n: DesktopCapability;
  comfyuiDownloads: DesktopCapability;
  systemMetrics: DesktopCapability;
  remoteDesktop: DesktopCapability;
  desktopInput: DesktopCapability;
  desktopUpdate: DesktopCapability;
}
```

Export these from the existing type barrel.

- [x] **Step 3: Add client and store**

Add a client helper and a `useDesktopStore()` that loads capabilities once on app boot and can refresh from Settings.

- [x] **Step 4: Run tests and build**

Run:

```bash
pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/src/api/rpc-client.desktop.test.ts apps/crawclaw-admin/src/layouts/DefaultLayout.desktop.test.ts apps/crawclaw-admin/src/stores/desktop.test.ts
npm --prefix apps/crawclaw-admin run build
```

Expected: both commands pass.

- [x] **Step 5: Commit**

Run: `scripts/committer "Admin desktop: add frontend capability store" apps/crawclaw-admin/src/api/types/desktop.ts apps/crawclaw-admin/src/api/types/index.ts apps/crawclaw-admin/src/api/rpc-client.ts apps/crawclaw-admin/src/api/rpc-client.desktop.test.ts apps/crawclaw-admin/src/stores/desktop.ts apps/crawclaw-admin/src/stores/desktop.test.ts apps/crawclaw-admin/src/layouts/DefaultLayout.vue apps/crawclaw-admin/src/layouts/DefaultLayout.desktop.test.ts`

Committed as `29c2dedab`.

### Task 7: Gate desktop-sensitive admin UI

**Files:**

- Modify `apps/crawclaw-admin/src/views/settings/SettingsPage.vue`
- Modify `apps/crawclaw-admin/src/components/common/ConnectionStatus.vue`
- Modify `apps/crawclaw-admin/src/stores/desktop.ts`
- Modify `apps/crawclaw-admin/src/views/terminal/TerminalPage.vue`
- Modify `apps/crawclaw-admin/src/views/remote-desktop/RemoteDesktopPage.vue`
- Modify `apps/crawclaw-admin/src/views/files/FilesPage.vue`
- Modify `apps/crawclaw-admin/src/views/backup/BackupPage.vue`
- Modify `apps/crawclaw-admin/src/i18n/messages/en-US.ts`
- Modify `apps/crawclaw-admin/src/i18n/messages/zh-CN.ts`
- Create `apps/crawclaw-admin/src/components/common/ConnectionStatus.desktop.test.ts`
- Create `apps/crawclaw-admin/src/views/settings/SettingsPage.desktop.test.ts`
- Create `apps/crawclaw-admin/src/views/terminal/TerminalPage.desktop.test.ts`

- [x] **Step 1: Add UI tests where existing harnesses cover the target pages**

Extend existing admin tests for Settings or page behavior when capabilities are unavailable. Keep this scoped to pages touched in this task.

Run: `pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/src/views/monitor/MonitorPage.i18n.test.ts apps/crawclaw-admin/src/router/routes.monitor.test.ts`

Expected: existing tests still pass before edits.

- [x] **Step 2: Wire desktop store into Settings**

Show desktop update mode when `desktopUpdate.available` is true. For desktop mode, replace npm update action copy with GitHub Release download behavior.

- [x] **Step 3: Wire capability state into sensitive pages**

For unsupported capabilities, show the existing page shell with a disabled state and the backend-provided reason. Do not remove routes in this task.

- [x] **Step 4: Run focused tests and build**

Run:

```bash
pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/src/views/monitor/MonitorPage.i18n.test.ts apps/crawclaw-admin/src/router/routes.monitor.test.ts apps/crawclaw-admin/src/stores/desktop.test.ts apps/crawclaw-admin/src/components/common/ConnectionStatus.desktop.test.ts apps/crawclaw-admin/src/views/settings/SettingsPage.desktop.test.ts apps/crawclaw-admin/src/views/terminal/TerminalPage.desktop.test.ts apps/crawclaw-admin/src/api/rpc-client.desktop.test.ts
npm --prefix apps/crawclaw-admin run build
```

Expected: both commands pass.

Observed: focused tests passed with 7 files / 12 tests. Build passed with the existing Vite chunk-size warning. A read-only subagent quality review returned PASS; the nonblocking `ConnectionStatus` unsubscribe suggestion was fixed and covered by a regression test before commit.

- [x] **Step 5: Commit**

Run: `scripts/committer "Admin desktop: gate platform-sensitive UI" apps/crawclaw-admin/src/stores/desktop.ts apps/crawclaw-admin/src/stores/desktop.test.ts apps/crawclaw-admin/src/components/common/ConnectionStatus.vue apps/crawclaw-admin/src/components/common/ConnectionStatus.desktop.test.ts apps/crawclaw-admin/src/views/settings/SettingsPage.vue apps/crawclaw-admin/src/views/settings/SettingsPage.desktop.test.ts apps/crawclaw-admin/src/views/terminal/TerminalPage.vue apps/crawclaw-admin/src/views/terminal/TerminalPage.desktop.test.ts apps/crawclaw-admin/src/views/remote-desktop/RemoteDesktopPage.vue apps/crawclaw-admin/src/views/files/FilesPage.vue apps/crawclaw-admin/src/views/backup/BackupPage.vue apps/crawclaw-admin/src/i18n/messages/en-US.ts apps/crawclaw-admin/src/i18n/messages/zh-CN.ts`

Committed as `35c3fb211`.

### Task 8: Create the Electron desktop package

**Files:**

- Create `apps/crawclaw-admin-desktop/package.json`
- Create `apps/crawclaw-admin-desktop/tsconfig.json`
- Create `apps/crawclaw-admin-desktop/electron-builder.yml`
- Create `apps/crawclaw-admin-desktop/src/main.ts`
- Create `apps/crawclaw-admin-desktop/src/preload.ts`
- Create `apps/crawclaw-admin-desktop/src/app-paths.ts`
- Create `apps/crawclaw-admin-desktop/src/backend-launch.ts`

- [x] **Step 1: Create app-local package**

Create `package.json` with app-local npm scripts:

```json
{
  "name": "crawclaw-admin-desktop",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "npm run build && electron .",
    "pack": "npm run build && electron-builder --dir",
    "dist": "npm run build && electron-builder",
    "rebuild:native": "electron-rebuild"
  },
  "dependencies": {
    "electron-log": "^5.4.3"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.2",
    "electron": "^39.2.4",
    "electron-builder": "^26.0.12",
    "typescript": "~5.9.3"
  }
}
```

Run: `npm --prefix apps/crawclaw-admin-desktop install`

Expected: `package-lock.json` is created.

Observed: `package-lock.json` was created. `npm audit` reported 7 dependency advisories in the Electron dependency tree; no automatic audit fix was applied.

- [x] **Step 2: Add TypeScript config**

Create a strict Node/Electron-oriented `tsconfig.json` that emits to `dist`.

- [x] **Step 3: Implement app paths**

In `app-paths.ts`, export `resolveDesktopAppPaths(app)` returning `stateDir`, `configPath`, `dataDir`, `backupDir`, `logDir`, and `runtimeDir` from Electron's `app.getPath('userData')`.

- [x] **Step 4: Implement backend launcher**

In `backend-launch.ts`, export:

```ts
export interface BackendLaunchResult {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export async function startAdminBackend(params: {
  adminRoot: string;
  paths: DesktopAppPaths;
  gateway: DesktopGatewayConfig;
}): Promise<BackendLaunchResult>;
```

Use `utilityProcess.fork()` for the backend entry point. Select a free port before launch, pass it through `CRAWCLAW_ADMIN_PORT`, and wait for `/api/health`.

- [x] **Step 5: Implement main and preload**

`main.ts` should:

- enforce single instance
- resolve paths
- start backend
- create BrowserWindow
- load backend URL
- stop backend on quit

`preload.ts` should expose only host-owned helpers such as opening external URLs.

- [x] **Step 6: Build**

Run: `npm --prefix apps/crawclaw-admin-desktop run build`

Expected: PASS.

Observed: `npm --prefix apps/crawclaw-admin-desktop run build` passed. `npm --prefix apps/crawclaw-admin-desktop run pack` also passed after adding `electron-builder.yml`, packaged admin resources under `Resources/admin`, and the admin native dependency rebuild step. The packaged directory was checked for `admin/server/index.js`, `admin/dist/index.html`, and `admin/node_modules/express`, and the server test files were excluded. A read-only subagent review initially found the missing packaged backend resource as a blocker; the follow-up review returned PASS.

- [x] **Step 7: Commit**

Run: `scripts/committer "Admin desktop: add Electron host package" apps/crawclaw-admin-desktop/.gitignore apps/crawclaw-admin-desktop/package.json apps/crawclaw-admin-desktop/package-lock.json apps/crawclaw-admin-desktop/tsconfig.json apps/crawclaw-admin-desktop/electron-builder.yml apps/crawclaw-admin-desktop/src/main.ts apps/crawclaw-admin-desktop/src/preload.ts apps/crawclaw-admin-desktop/src/app-paths.ts apps/crawclaw-admin-desktop/src/backend-launch.ts`

Committed as `709bbe958`.

### Task 9: Add desktop config and credential storage

**Files:**

- Create `apps/crawclaw-admin-desktop/src/config-store.ts`
- Create `apps/crawclaw-admin-desktop/src/credential-store.ts`
- Create `apps/crawclaw-admin-desktop/src/config-store.test.ts`
- Create `apps/crawclaw-admin-desktop/src/credential-store.test.ts`
- Modify `apps/crawclaw-admin-desktop/package.json`
- Modify `apps/crawclaw-admin-desktop/package-lock.json`

- [x] **Step 1: Add tests**

Test:

- non-sensitive config writes to `config.json`
- token and password writes go through credential adapter
- session-only fallback keeps secrets in memory

Run: `npm --prefix apps/crawclaw-admin-desktop run build`

Expected: PASS before test runner exists; this task uses TypeScript compile as the first gate.

Observed: build passed. The compiled Node test runner command `node --test apps/crawclaw-admin-desktop/dist/config-store.test.js apps/crawclaw-admin-desktop/dist/credential-store.test.js` passed with 5 tests.

- [x] **Step 2: Add credential dependency**

Add `keytar` to desktop dependencies and run:

```bash
npm --prefix apps/crawclaw-admin-desktop install
npm --prefix apps/crawclaw-admin-desktop run rebuild:native
```

Expected: native rebuild succeeds on the local platform.

Observed: `keytar` was added and `npm --prefix apps/crawclaw-admin-desktop run rebuild:native` passed.

- [x] **Step 3: Implement config store**

Store only non-sensitive values:

```ts
export interface DesktopConfig {
  activeProfileId: string;
  gatewayWsUrl: string;
  locale?: string;
  theme?: string;
  hermesWebUrl?: string;
  hermesApiUrl?: string;
}
```

- [x] **Step 4: Implement credential store**

Expose:

```ts
export async function getGatewaySecret(
  profileId: string,
): Promise<{ token?: string; password?: string }>;
export async function setGatewaySecret(
  profileId: string,
  value: { token?: string; password?: string },
): Promise<void>;
export async function deleteGatewaySecret(profileId: string): Promise<void>;
```

Do not log credential values.

- [x] **Step 5: Wire credentials into backend launch**

Load the active profile before `startAdminBackend()` and pass `CRAWCLAW_WS_URL`, `CRAWCLAW_AUTH_TOKEN`, and `CRAWCLAW_AUTH_PASSWORD` in the backend environment.

- [x] **Step 6: Build**

Run: `npm --prefix apps/crawclaw-admin-desktop run build`

Expected: PASS.

Observed: build passed. `npm --prefix apps/crawclaw-admin-desktop run pack` also passed and verified the packaged admin resources. A read-only subagent review returned PASS and confirmed secrets are not written to desktop config or logs by the new desktop package code.

- [x] **Step 7: Commit**

Run: `scripts/committer "Admin desktop: add config and credential stores" apps/crawclaw-admin-desktop/electron-builder.yml apps/crawclaw-admin-desktop/package.json apps/crawclaw-admin-desktop/package-lock.json apps/crawclaw-admin-desktop/src/main.ts apps/crawclaw-admin-desktop/src/config-store.ts apps/crawclaw-admin-desktop/src/config-store.test.ts apps/crawclaw-admin-desktop/src/credential-store.ts apps/crawclaw-admin-desktop/src/credential-store.test.ts`

Committed as `4804ee06b`.

### Task 10: Add Electron Builder packaging

**Files:**

- Create `apps/crawclaw-admin-desktop/electron-builder.yml`
- Modify `apps/crawclaw-admin-desktop/package.json`
- Modify `scripts/admin-desktop-build.mjs`
- Modify root `package.json`

- [x] **Step 1: Add Electron Builder config**

Create config with:

- app id `ai.crawclaw.admin`
- product name `CrawClaw Admin`
- files for desktop `dist/**`
- extra resources for built admin frontend and backend
- mac targets `dmg` and `zip`
- win target `nsis`
- linux target `AppImage`

Observed: Electron Builder config was added earlier with the host package commit and validated by `admin:desktop:pack`.

- [x] **Step 2: Add build script**

Create `scripts/admin-desktop-build.mjs` to:

1. run `npm --prefix apps/crawclaw-admin install` when `node_modules` is missing
2. run `npm --prefix apps/crawclaw-admin run build`
3. run `npm --prefix apps/crawclaw-admin-desktop install` when `node_modules` is missing
4. run `npm --prefix apps/crawclaw-admin-desktop run rebuild:native`
5. run `npm --prefix apps/crawclaw-admin-desktop run dist`

- [x] **Step 3: Add root scripts**

Add:

```json
"admin:build": "npm --prefix apps/crawclaw-admin run build",
"admin:desktop:build": "npm --prefix apps/crawclaw-admin-desktop run build",
"admin:desktop:pack": "npm --prefix apps/crawclaw-admin-desktop run pack",
"admin:desktop:dist": "node scripts/admin-desktop-build.mjs"
```

- [x] **Step 4: Run local package check**

Run:

```bash
npm --prefix apps/crawclaw-admin-desktop run build
npm --prefix apps/crawclaw-admin-desktop run pack
```

Expected: desktop directory package is produced for the local platform.

Observed: `pnpm admin:desktop:build` and `pnpm admin:desktop:pack` passed. The directory package was checked for bundled admin backend, frontend, and `express` dependency resources.

- [x] **Step 5: Commit**

Run: `scripts/committer "Admin desktop: add packaging config" apps/crawclaw-admin-desktop/electron-builder.yml apps/crawclaw-admin-desktop/package.json apps/crawclaw-admin-desktop/package-lock.json scripts/admin-desktop-build.mjs package.json`

Committed as `ec356d51a`.

### Task 11: Add desktop release checks

**Files:**

- Create `scripts/admin-desktop-release-check.mjs`
- Modify root `package.json`

- [x] **Step 1: Implement release check script**

Validate:

- `apps/crawclaw-admin-desktop/package.json` exists
- desktop package version matches root `package.json`
- required Electron Builder config targets exist
- admin frontend `dist/index.html` exists after build
- no desktop release asset is built from a dirty generated path

- [x] **Step 2: Add root script**

Add:

```json
"admin:desktop:release-check": "node scripts/admin-desktop-release-check.mjs"
```

- [x] **Step 3: Run release check**

Run:

```bash
pnpm admin:build
pnpm admin:desktop:build
pnpm admin:desktop:release-check
```

Expected: all commands pass.

Observed: all three commands passed. The release check validated version alignment, Electron Builder targets, built admin frontend, and generated path status.

- [x] **Step 4: Commit**

Run: `scripts/committer "Admin desktop: add release checks" scripts/admin-desktop-release-check.mjs package.json apps/crawclaw-admin-desktop/package.json apps/crawclaw-admin-desktop/package-lock.json`

Committed as `41bf051e5`.

### Task 12: Add GitHub Actions desktop release workflow

**Files:**

- Create `.github/workflows/admin-desktop-release.yml`

- [x] **Step 1: Create workflow**

The workflow should support `workflow_dispatch` with inputs:

- `tag`
- `preflight_only`
- `publish_draft_release`
- `skip_signing`

Jobs:

- `validate-input`
- `build-macos`
- `build-windows`
- `build-linux`
- `publish-draft-release`

- [x] **Step 2: Use app-local npm installs**

Each platform build job should:

```bash
npm --prefix apps/crawclaw-admin ci
npm --prefix apps/crawclaw-admin run build
npm --prefix apps/crawclaw-admin-desktop ci
npm --prefix apps/crawclaw-admin-desktop run rebuild:native
npm --prefix apps/crawclaw-admin-desktop run dist
```

- [x] **Step 3: Upload artifacts**

Upload platform artifacts and checksums with `actions/upload-artifact`.

- [x] **Step 4: Add draft release publication**

Use GitHub Release upload only when `publish_draft_release=true` and preflight passed.

- [x] **Step 5: Run workflow validation**

Run:

```bash
pnpm check:no-conflict-markers
pnpm lint:docs
```

Expected: both commands pass.

Observed: workflow YAML parsed locally. `pnpm check:no-conflict-markers` and `pnpm lint:docs` passed. The workflow uses a helper script to collect top-level Electron Builder release artifacts and platform-specific checksum files.

- [x] **Step 6: Commit**

Run: `scripts/committer "Admin desktop: add release workflow" .github/workflows/admin-desktop-release.yml scripts/collect-admin-desktop-artifacts.mjs`

Committed as `317215766`.

### Task 13: Add desktop documentation

**Files:**

- Create `docs/install/desktop.md`
- Modify `docs/docs.json`
- Modify `apps/crawclaw-admin/README.md`
- Modify `apps/crawclaw-admin/README.en.md`

- [x] **Step 1: Write docs page**

Create `docs/install/desktop.md` covering:

- what CrawClaw Admin Desktop is
- trust model
- supported platforms
- where credentials are stored
- where app state is stored
- how it connects to a local or remote Gateway
- beta limitations
- update behavior

- [x] **Step 2: Add docs navigation**

Add the page to `docs/docs.json` near other install surfaces.

- [x] **Step 3: Update admin READMEs**

Mention the desktop app as the packaged form of `apps/crawclaw-admin` and keep the web development instructions intact.

- [x] **Step 4: Run docs checks**

Run:

```bash
pnpm format:docs:check
pnpm lint:docs
```

Expected: both commands pass.

Observed: `pnpm format:docs:check`, `pnpm lint:docs`, and the extra `pnpm docs:check-i18n-glossary` check passed.

- [x] **Step 5: Commit**

Run: `scripts/committer "Docs: add admin desktop packaging guide" docs/install/desktop.md docs/docs.json docs/.i18n/glossary.zh-CN.json apps/crawclaw-admin/README.md apps/crawclaw-admin/README.en.md`

Committed as `b667d238b`.

### Task 14: Final integration gate

**Files:**

- All files touched by Tasks 1 through 13.

- [ ] **Step 1: Run focused admin backend tests**

Run:

```bash
pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/server/admin-paths.test.ts apps/crawclaw-admin/server/runtime-config.test.ts apps/crawclaw-admin/server/desktop-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused admin frontend tests**

Run:

```bash
pnpm exec vitest run --config apps/crawclaw-admin/vite.config.ts apps/crawclaw-admin/src/api/rpc-client.desktop.test.ts apps/crawclaw-admin/src/router/routes.monitor.test.ts
```

Expected: PASS.

- [ ] **Step 3: Build admin and desktop**

Run:

```bash
npm --prefix apps/crawclaw-admin run build
npm --prefix apps/crawclaw-admin-desktop run build
```

Expected: PASS.

- [ ] **Step 4: Run local desktop pack**

Run:

```bash
npm --prefix apps/crawclaw-admin-desktop run pack
```

Expected: local platform package directory is produced.

- [ ] **Step 5: Run repo gates**

Run:

```bash
pnpm check
pnpm build
git diff --check -- apps/crawclaw-admin apps/crawclaw-admin-desktop scripts .github/workflows docs package.json
```

Expected: all commands pass. If unrelated repo-wide failures appear, capture the first unrelated failure and rerun the focused gates before asking whether to broaden scope.

- [ ] **Step 6: Manual smoke**

Run the packaged desktop app locally and verify:

- app launches without a system Node dependency
- backend health reaches `ok`
- Gateway connection can be configured
- Dashboard opens
- Terminal opens
- Files page can list a workspace
- Backup create/download flow works
- app quit stops backend runtime

- [ ] **Step 7: Final commit if needed**

If integration fixes were needed after Task 13, commit them with:

```bash
scripts/committer "Admin desktop: finish beta integration" <changed-files>
```
