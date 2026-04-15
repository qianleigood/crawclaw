---
summary: "CLI reference for `crawclaw plugins` (list, install, marketplace, uninstall, enable/disable, doctor)"
read_when:
  - You want to install or manage Gateway plugins or compatible bundles
  - You want to debug plugin load failures
title: "plugins"
---

# `crawclaw plugins`

Manage Gateway plugins/extensions, hook packs, and compatible bundles.

Related:

- Plugin system: [Plugins](/tools/plugin)
- Runtime provisioning: [Runtimes](/cli/runtimes)
- Bundle compatibility: [Plugin bundles](/plugins/bundles)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
crawclaw plugins list
crawclaw plugins install <path-or-spec>
crawclaw plugins inspect <id>
crawclaw plugins enable <id>
crawclaw plugins disable <id>
crawclaw plugins uninstall <id>
crawclaw plugins doctor
crawclaw plugins update <id>
crawclaw plugins update --all
crawclaw plugins marketplace list <marketplace>
```

Bundled plugins ship with CrawClaw but start disabled. Use `plugins enable` to
activate them.

Bundled plugin sidecar/runtime dependencies that are part of the default install path are now provisioned during install/postinstall under `~/.crawclaw/runtimes`. Use `crawclaw runtimes doctor` or `crawclaw runtimes install` when you need to inspect or repair those shared runtimes.

Native CrawClaw plugins should ship `crawclaw.plugin.json` with an inline JSON
Schema (`configSchema`, even if empty). Legacy `crawclaw.plugin.json` is still
accepted during migration. Compatible bundles use their own bundle manifests instead.

`plugins list` shows `Format: crawclaw` or `Format: bundle`. Verbose list/info
output also shows the bundle subtype (`codex`, `claude`, or `cursor`) plus detected bundle
capabilities.

### Install

```bash
crawclaw plugins install <package>                      # ClawHub first, then npm
crawclaw plugins install clawhub:<package>              # ClawHub only
crawclaw plugins install <package> --pin                # pin version
crawclaw plugins install <package> --dangerously-force-unsafe-install
crawclaw plugins install <path>                         # local path
crawclaw plugins install <plugin>@<marketplace>         # marketplace
crawclaw plugins install <plugin> --marketplace <name>  # marketplace (explicit)
```

Bare package names are checked against ClawHub first, then npm. Security note:
treat plugin installs like running code. Prefer pinned versions.

`--dangerously-force-unsafe-install` is a break-glass option for false positives
in the built-in dangerous-code scanner. It allows the install to continue even
when the built-in scanner reports `critical` findings, but it does **not**
bypass plugin `before_install` hook policy blocks and does **not** bypass scan
failures.

This CLI flag applies to `crawclaw plugins install`. Gateway-backed skill
dependency installs use the matching `dangerouslyForceUnsafeInstall` request
override, while `crawclaw skills install` remains a separate ClawHub skill
download/install flow.

`plugins install` is also the install surface for hook packs that expose
legacy `crawclaw.hooks` or canonical `crawclaw.hooks` in `package.json`. Use `crawclaw hooks` for filtered hook
visibility and per-hook enablement, not package installation.

Npm specs are **registry-only** (package name + optional **exact version** or
**dist-tag**). Git/URL/file specs and semver ranges are rejected. Dependency
installs run with `--ignore-scripts` for safety.

Bare specs and `@latest` stay on the stable track. If npm resolves either of
those to a prerelease, CrawClaw stops and asks you to opt in explicitly with a
prerelease tag such as `@beta`/`@rc` or an exact prerelease version such as
`@1.2.3-beta.4`.

If a bare install spec matches a bundled plugin id (for example `diffs`), CrawClaw
installs the bundled plugin directly. To install an npm package with the same
name, use an explicit scoped spec (for example `@scope/diffs`).

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Claude marketplace installs are also supported.

ClawHub installs use an explicit `clawhub:<package>` locator:

```bash
crawclaw plugins install clawhub:crawclaw-codex-app-server
crawclaw plugins install clawhub:crawclaw-codex-app-server@1.2.3
```

CrawClaw now also prefers ClawHub for bare npm-safe plugin specs. It only falls
back to npm if ClawHub does not have that package or version:

```bash
crawclaw plugins install crawclaw-codex-app-server
```

CrawClaw downloads the package archive from ClawHub, checks the advertised
plugin API / minimum gateway compatibility, then installs it through the normal
archive path. Recorded installs keep their ClawHub source metadata for later
updates.

Use `plugin@marketplace` shorthand when the marketplace name exists in Claude's
local registry cache at `~/.claude/plugins/known_marketplaces.json`:

```bash
crawclaw plugins marketplace list <marketplace-name>
crawclaw plugins install <plugin-name>@<marketplace-name>
```

Use `--marketplace` when you want to pass the marketplace source explicitly:

```bash
crawclaw plugins install <plugin-name> --marketplace <marketplace-name>
crawclaw plugins install <plugin-name> --marketplace <owner/repo>
crawclaw plugins install <plugin-name> --marketplace ./my-marketplace
```

Marketplace sources can be:

- a Claude known-marketplace name from `~/.claude/plugins/known_marketplaces.json`
- a local marketplace root or `marketplace.json` path
- a GitHub repo shorthand such as `owner/repo`
- a git URL

For remote marketplaces loaded from GitHub or git, plugin entries must stay
inside the cloned marketplace repo. CrawClaw accepts relative path sources from
that repo and rejects external git, GitHub, URL/archive, and absolute-path
plugin sources from remote manifests.

For local paths and archives, CrawClaw auto-detects:

- native CrawClaw plugins (`crawclaw.plugin.json`)
- Codex-compatible bundles (`.codex-plugin/plugin.json`)
- Claude-compatible bundles (`.claude-plugin/plugin.json` or the default Claude
  component layout)
- Cursor-compatible bundles (`.cursor-plugin/plugin.json`)

Compatible bundles install into the normal extensions root and participate in
the same list/info/enable/disable flow. Today, bundle skills, Claude
command-skills, Claude `settings.json` defaults, Cursor command-skills, and compatible Codex hook
directories are supported; other detected bundle capabilities are shown in
diagnostics/info but are not yet wired into runtime execution.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
crawclaw plugins install -l ./my-plugin
```

Use `--pin` on npm installs to save the resolved exact spec (`name@version`) in
`plugins.installs` while keeping the default behavior unpinned.

### Uninstall

```bash
crawclaw plugins uninstall <id>
crawclaw plugins uninstall <id> --dry-run
crawclaw plugins uninstall <id> --keep-files
```

`uninstall` removes plugin records from `plugins.entries`, `plugins.installs`,
the plugin allowlist, and linked `plugins.load.paths` entries when applicable.

By default, uninstall also removes the plugin install directory under the active
state-dir plugin root. Use
`--keep-files` to keep files on disk.

`--keep-config` is supported as a deprecated alias for `--keep-files`.

### Update

```bash
crawclaw plugins update <id-or-npm-spec>
crawclaw plugins update --all
crawclaw plugins update <id-or-npm-spec> --dry-run
crawclaw plugins update @crawclaw/voice-call@beta
```

Updates apply to tracked installs in `plugins.installs` and tracked hook-pack
installs in `hooks.internal.installs`.

When you pass a plugin id, CrawClaw reuses the recorded install spec for that
plugin. That means previously stored dist-tags such as `@beta` and exact pinned
versions continue to be used on later `update <id>` runs.

For npm installs, you can also pass an explicit npm package spec with a dist-tag
or exact version. CrawClaw resolves that package name back to the tracked plugin
record, updates that installed plugin, and records the new npm spec for future
id-based updates.

When a stored integrity hash exists and the fetched artifact hash changes,
CrawClaw prints a warning and asks for confirmation before proceeding. Use
global `--yes` to bypass prompts in CI/non-interactive runs.

### Inspect

```bash
crawclaw plugins inspect <id>
crawclaw plugins inspect <id> --json
```

Deep introspection for a single plugin. Shows identity, load status, source,
registered capabilities, hooks, tools, commands, services, gateway methods,
HTTP routes, policy flags, diagnostics, and install metadata.

Each plugin is classified by what it actually registers at runtime:

- **plain-capability** — one capability type (e.g. a provider-only plugin)
- **hybrid-capability** — multiple capability types (e.g. text + speech + images)
- **hook-only** — only hooks, no capabilities or surfaces
- **non-capability** — tools/commands/services but no capabilities

See [Plugin shapes](/plugins/architecture#plugin-shapes) for more on the capability model.

The `--json` flag outputs a machine-readable report suitable for scripting and
auditing.

`info` is an alias for `inspect`.
