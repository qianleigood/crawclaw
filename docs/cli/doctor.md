---
summary: "CLI reference for `crawclaw doctor` (health checks + guided repairs)"
read_when:
  - You have connectivity/auth issues and want guided fixes
  - You updated and want a sanity check
title: "doctor"
---

# `crawclaw doctor`

Health checks + quick fixes for the gateway and channels.

Related:

- Troubleshooting: [Troubleshooting](/gateway/troubleshooting)
- Security audit: [Security](/gateway/security)

## Examples

```bash
crawclaw doctor
crawclaw doctor --repair
crawclaw doctor --deep
```

Notes:

- Interactive prompts (like keychain/OAuth fixes) only run when stdin is a TTY and `--non-interactive` is **not** set. Headless runs (cron, Telegram, no terminal) will skip prompts.
- `--fix` (alias for `--repair`) writes a backup to `~/.crawclaw/crawclaw.json.bak` and drops unknown config keys, listing each removal.
- State integrity checks now detect orphan transcript files in the sessions directory and can archive them as `.deleted.<timestamp>` to reclaim space safely.
- Shared bundled plugin runtimes now have their own dedicated surface: use `crawclaw runtimes doctor` / `crawclaw runtimes install` to inspect or repair install-time runtime provisioning under `~/.crawclaw/runtimes`.
- Doctor also scans `~/.crawclaw/cron/jobs.json` (or `cron.store`) for legacy cron job shapes and can rewrite them in place before the scheduler has to auto-normalize them at runtime.
- Doctor includes memory health checks for the built-in memory runtime.
- If sandbox mode is enabled but Docker is unavailable, doctor reports a high-signal warning with remediation (`install Docker` or `crawclaw config set agents.defaults.sandbox.mode off`).
- If `gateway.auth.token`/`gateway.auth.password` are SecretRef-managed and unavailable in the current command path, doctor reports a read-only warning and does not write plaintext fallback credentials.
- If channel SecretRef inspection fails in a fix path, doctor continues and reports a warning instead of exiting early.
- Telegram `allowFrom` username auto-resolution (`doctor --fix`) requires a resolvable Telegram token in the current command path. If token inspection is unavailable, doctor reports a warning and skips auto-resolution for that pass.

## macOS: `launchctl` env overrides

If you previously ran `launchctl setenv CRAWCLAW_GATEWAY_TOKEN ...` (or the legacy `CRAWCLAW_GATEWAY_TOKEN`, or either password variant), that value overrides your config file and can cause persistent “unauthorized” errors.

```bash
launchctl getenv CRAWCLAW_GATEWAY_TOKEN
launchctl getenv CRAWCLAW_GATEWAY_PASSWORD

launchctl unsetenv CRAWCLAW_GATEWAY_TOKEN
launchctl unsetenv CRAWCLAW_GATEWAY_PASSWORD
```
