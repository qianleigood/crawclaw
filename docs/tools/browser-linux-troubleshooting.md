---
summary: "Fix agent-browser startup issues for CrawClaw browser automation on Linux"
read_when: "Browser automation fails on Linux, especially with snap Chromium"
title: "Browser Troubleshooting"
---

# Browser Troubleshooting (Linux)

The Rust native `browser` tool starts the managed `agent-browser` CLI. On Linux,
most failures come from either a missing managed runtime or a Chromium binary
that cannot launch in the current host environment.

## Missing agent-browser runtime

If the tool reports that `agent-browser` is missing, reinstall managed runtimes:

Open CrawClaw Desktop on the gateway host and let it stage the bundled managed
runtimes, or run the same host through the local Gateway runtime install path.
The staged browser binary lives under `runtimes/browser/bin/agent-browser`.

Then check the runtime manifest:

Confirm the gateway runtime root contains `runtimes/manifest.json` and that the
manifest advertises the `browser-agent-browser-runtime` service.

## Browser executable fails to launch

On Ubuntu and many Linux distributions, the default Chromium package may be a
snap wrapper. If it fails under automation, install Google Chrome or another
non-snap Chromium-based browser and point CrawClaw at that binary:

```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt --fix-broken install -y
```

```json
{
  "browser": {
    "enabled": true,
    "provider": "agent-browser",
    "executablePath": "/usr/bin/google-chrome-stable",
    "noSandbox": true,
    "extraArgs": ["--disable-gpu"]
  }
}
```

## Verify through the tool

Call the browser tool through an agent session or the Gateway Tools Invoke API:

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "open", "profile": "crawclaw", "url": "https://example.com" }
```

## Config reference

| Option                   | Description                                                          | Default         |
| ------------------------ | -------------------------------------------------------------------- | --------------- |
| `browser.enabled`        | Enables browser automation                                           | `true`          |
| `browser.provider`       | Browser runtime provider                                             | `agent-browser` |
| `browser.executablePath` | Path to a Chromium-based browser binary                              | auto-detected   |
| `browser.noSandbox`      | Adds `--no-sandbox` for hosts that need it                           | `false`         |
| `browser.extraArgs`      | Extra browser flags passed through the native `agent-browser` client | `[]`            |
