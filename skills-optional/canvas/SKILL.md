---
name: canvas
description: Present local HTML on connected CrawClaw nodes. Use when you need to show a dashboard, demo, or interactive page on a Mac, iOS, or Android canvas and need the correct host URL for the current bind mode.
---

# Canvas

Use this skill to push HTML content to a connected node's canvas view.

## Workflow

1. Confirm `canvasHost.enabled` and note `canvasHost.root`.
2. Put the page under the canvas root.
3. Find an online node with `crawclaw nodes list`.
4. Build the correct URL for the current bind mode:
   - `loopback`: `http://127.0.0.1:18793/__crawclaw__/canvas/<file>.html`
   - `lan`, `tailnet`, `auto`: use the bridge-visible host name or address
5. Run the action you need:
   - `canvas action:present node:<node-id> target:<full-url>`
   - `canvas action:navigate node:<node-id> url:<full-url>`
   - `canvas action:snapshot node:<node-id>`
   - `canvas action:hide node:<node-id>`

## Rules

- Always include `node:<node-id>`.
- Prefer the host name actually advertised by the gateway; do not guess with `localhost`.
- Keep demo pages self-contained when possible.

## Debugging

- White screen usually means the node received the wrong host for the current bind mode.
- Check `gateway.bind`, confirm port `18793` is listening, then `curl` the exact URL you plan to present.
- If live reload does not update, confirm `canvasHost.liveReload` is enabled and the file is under `canvasHost.root`.
