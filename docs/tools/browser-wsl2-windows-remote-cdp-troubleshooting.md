---
summary: "Troubleshoot WSL2 Gateway + Windows Chrome remote CDP in layers"
read_when:
  - Running CrawClaw Gateway in WSL2 while Chrome lives on Windows
  - Seeing overlapping browser/control-ui errors across WSL2 and Windows
  - Deciding between managed browser and raw remote CDP in split-host setups
title: "WSL2 + Windows + remote Chrome CDP troubleshooting"
---

# WSL2 + Windows + remote Chrome CDP troubleshooting

This guide covers the common split-host setup where:

- CrawClaw Gateway runs inside WSL2
- Chrome runs on Windows
- browser control must cross the WSL2/Windows boundary

It also covers the layered failure pattern from issue `#39369`: several independent problems can show up at once, which makes the wrong layer look broken first.

## Choose the right browser mode first

You have two valid patterns:

### Option 1: Raw remote CDP from WSL2 to Windows

Use a remote browser profile that points from WSL2 to a Windows Chrome CDP endpoint.

Choose this when:

- the Gateway stays inside WSL2
- Chrome runs on Windows
- you need browser control to cross the WSL2/Windows boundary

For WSL2 Gateway + Windows Chrome, prefer raw remote CDP. Managed PinchTab profiles are local to the host that runs CrawClaw; they are not a WSL2-to-Windows bridge.

## Working architecture

Reference shape:

- WSL2 runs the Gateway on `127.0.0.1:18789`
- Windows opens a browser-facing gateway client at `http://127.0.0.1:18789/`
- Windows Chrome exposes a CDP endpoint on port `9222`
- WSL2 can reach that Windows CDP endpoint
- CrawClaw points a browser profile at the address that is reachable from WSL2

## Why this setup is confusing

Several failures can overlap:

- WSL2 cannot reach the Windows CDP endpoint
- the browser-facing client is opened from a non-secure origin
- `gateway.controlUi.allowedOrigins` does not match the page origin
- token or pairing is missing
- the browser profile points at the wrong address

Because of that, fixing one layer can still leave a different error visible.

## Critical rule for browser-facing clients

When the UI is opened from Windows, use Windows localhost unless you have a deliberate HTTPS setup.

Use:

`http://127.0.0.1:18789/`

Do not default to a LAN IP for browser-based gateway clients. Plain HTTP on a LAN or tailnet address can trigger insecure-origin/device-auth behavior that is unrelated to CDP itself. See [Web surfaces](/web).

## Validate in layers

Work top to bottom. Do not skip ahead.

### Layer 1: Verify Chrome is serving CDP on Windows

Start Chrome on Windows with remote debugging enabled:

```powershell
chrome.exe --remote-debugging-port=9222
```

From Windows, verify Chrome itself first:

```powershell
curl http://127.0.0.1:9222/json/version
curl http://127.0.0.1:9222/json/list
```

If this fails on Windows, CrawClaw is not the problem yet.

### Layer 2: Verify WSL2 can reach that Windows endpoint

From WSL2, test the exact address you plan to use in `cdpUrl`:

```bash
curl http://WINDOWS_HOST_OR_IP:9222/json/version
curl http://WINDOWS_HOST_OR_IP:9222/json/list
```

Good result:

- `/json/version` returns JSON with Browser / Protocol-Version metadata
- `/json/list` returns JSON (empty array is fine if no pages are open)

If this fails:

- Windows is not exposing the port to WSL2 yet
- the address is wrong for the WSL2 side
- firewall / port forwarding / local proxying is still missing

Fix that before touching CrawClaw config.

### Layer 3: Configure the correct browser profile

For raw remote CDP, point CrawClaw at the address that is reachable from WSL2:

```json5
{
  browser: {
    enabled: true,
    defaultProfile: "remote",
    profiles: {
      remote: {
        cdpUrl: "http://WINDOWS_HOST_OR_IP:9222",
        color: "#00AA00",
      },
    },
  },
}
```

Notes:

- use the WSL2-reachable address, not whatever only works on Windows
- test the same URL with `curl` before expecting CrawClaw to succeed

### Layer 4: Verify the browser-client layer separately

Open the UI from Windows:

`http://127.0.0.1:18789/`

Then verify:

- the page origin matches what `gateway.controlUi.allowedOrigins` expects
- token auth or pairing is configured correctly
- you are not debugging a browser-client auth problem as if it were a browser problem

Helpful page:

- [Web surfaces](/web)

### Layer 5: Verify end-to-end browser control

From WSL2:

```bash
crawclaw browser open https://example.com --browser-profile remote
crawclaw browser tabs --browser-profile remote
```

Good result:

- the tab opens in Windows Chrome
- `crawclaw browser tabs` returns the target
- later actions (`snapshot`, `screenshot`, `navigate`) work from the same profile

## Common misleading errors

Treat each message as a layer-specific clue:

- `control-ui-insecure-auth`
  - UI origin / secure-context problem, not a CDP transport problem
- `token_missing`
  - auth configuration problem
- `pairing required`
  - device approval problem
- `Remote CDP for profile "remote" is not reachable`
  - WSL2 cannot reach the configured `cdpUrl`
- `gateway timeout after 1500ms`
  - often still CDP reachability or a slow/unreachable remote endpoint

## Fast triage checklist

1. Windows: does `curl http://127.0.0.1:9222/json/version` work?
2. WSL2: does `curl http://WINDOWS_HOST_OR_IP:9222/json/version` work?
3. CrawClaw config: does `browser.profiles.<name>.cdpUrl` use that exact WSL2-reachable address?
4. Browser client: are you opening `http://127.0.0.1:18789/` instead of a LAN IP?
5. Are you using a remote CDP profile instead of trying to treat Windows Chrome as a host-local browser?

## Practical takeaway

The setup is usually viable. The hard part is that browser transport, browser-client origin security, and token/pairing can each fail independently while looking similar from the user side.

When in doubt:

- verify the Windows Chrome endpoint locally first
- verify the same endpoint from WSL2 second
- only then debug CrawClaw config or browser-client auth
