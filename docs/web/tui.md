---
summary: "Terminal UI (TUI): connect to the Gateway from any machine"
read_when:
  - You want a beginner-friendly walkthrough of the TUI
  - You need the complete list of TUI features, commands, and shortcuts
title: "TUI"
---

# TUI (Terminal UI)

## Quick start

1. Start the Gateway.

```bash
crawclaw gateway
```

2. Open the TUI.

```bash
crawclaw tui
```

3. Type a message and press Enter.

Remote Gateway:

```bash
crawclaw tui --url ws://<host>:<port> --token <gateway-token>
```

Use `--password` if your Gateway uses password auth.

## What you see

- Header: connection URL, current agent, current session.
- Chat log: user messages, assistant replies, system notices, tool cards.
- Status line: connection/run state (connecting, running, streaming, idle, error).
- Footer: agent + session + model + think/fast/verbose/reasoning + token counts + deliver + a short command hint.
- Input: text editor with autocomplete.

## Mental model: agents + sessions

- Agents are unique slugs (e.g. `main`, `research`). The Gateway exposes the list.
- Sessions belong to the current agent.
- Session keys are stored as `agent:<agentId>:<sessionKey>`.
  - If you type `/session main`, the TUI expands it to `agent:<currentAgent>:main`.
  - If you type `/session agent:other:main`, you switch to that agent session explicitly.
- Session scope:
  - `per-sender` (default): each agent has many sessions.
  - `global`: the TUI always uses the `global` session (the picker may be empty).
- The current agent + session are always visible in the footer.

## Sending + delivery

- Messages are sent to the Gateway; delivery to providers is off by default.
- Turn delivery on:
  - `/deliver on`
  - or the Settings panel
  - or start with `crawclaw tui --deliver`

## Pickers + overlays

- Model picker: list available models and set the session override.
- Agent picker: choose a different agent.
- Session picker: shows only sessions for the current agent. Rows include title/key, recent activity, model, token usage, flags, delivery route, and last-message preview when available.
- Settings: toggle deliver, tool output expansion, and thinking visibility.
- Status overlay: `/status` opens a compact overlay with the current run, model, token usage, delivery route, Gateway link/auth status, queued system events, recent sessions, and the latest TUI error.
- Empty sessions show one short tip with the main pickers and `/help`; the footer keeps the same hint compactly visible.

## Keyboard shortcuts

- Enter: send message
- Esc: abort active run
- Ctrl+C: clear input (press twice to exit)
- Ctrl+D: exit
- Ctrl+L: model picker
- Ctrl+G: agent picker
- Ctrl+P: session picker
- Ctrl+O: tool output overlay
- Ctrl+T: toggle thinking visibility (reloads history)

## Slash commands

Core:

- `/help`
- `/status` (open status overlay)
- `/agent <id>` (or `/agents`)
- `/session <key>` (or `/sessions`)
- `/model <provider/model>` (or `/models`)

Session controls:

- `/think <off|minimal|low|medium|high>`
- `/fast <status|on|off>`
- `/verbose <on|full|off>`
- `/reasoning <on|off|stream>`
- `/usage <off|tokens|full>`
- `/elevated <on|off|ask|full>` (alias: `/elev`)
- `/activation <mention|always>`
- `/deliver <status|on|off>`

Session lifecycle:

- `/new` (start a fresh session)
- `/abort` (abort the active run)
- `/settings`
- `/exit`

Other Gateway slash commands (for example, `/context`) are forwarded to the Gateway and shown as system output. See [Slash commands](/tools/slash-commands).

## Local shell commands

- Prefix a line with `!` to run a local shell command on the TUI host.
- The TUI prompts once per session to allow local execution; declining keeps `!` disabled for the session.
- Commands run in a fresh, non-interactive shell in the TUI working directory (no persistent `cd`/env).
- Local shell commands receive `CRAWCLAW_SHELL=tui-local` in their environment.
- A lone `!` is sent as a normal message; leading spaces do not trigger local exec.

## Tool output

- Tool calls show as cards with args + results.
- Ctrl+O opens a tool output overlay.
- In the overlay, Enter toggles the selected tool, `a` toggles all tools, and Esc closes it.
- Failed tools are marked in the overlay.
- While tools run, partial updates stream into the same card.

## Terminal colors

- The TUI keeps assistant body text in your terminal's default foreground so dark and light terminals both stay readable.
- If your terminal uses a light background and auto-detection is wrong, set `CRAWCLAW_THEME=light` before launching `crawclaw tui`.
- To force the original dark palette instead, set `CRAWCLAW_THEME=dark`.

## History + streaming

- On connect, the TUI loads the latest history (default 200 messages).
- Streaming responses update in place until finalized.
- The TUI also listens to agent tool events for richer tool cards.

## Connection details

- The TUI registers with the Gateway as `mode: "tui"`.
- Reconnects show a system message; event gaps are surfaced in the log.

## Options

- `--url <url>`: Gateway WebSocket URL (defaults to config or `ws://127.0.0.1:<port>`)
- `--token <token>`: Gateway token (if required)
- `--password <password>`: Gateway password (if required)
- `--session <key>`: Session key (default: `main`, or `global` when scope is global)
- `--deliver`: Deliver assistant replies to the provider (default off)
- `--thinking <level>`: Override thinking level for sends
- `--timeout-ms <ms>`: Agent timeout in ms (defaults to `agents.defaults.timeoutSeconds`)
- `--history-limit <n>`: History entries to load (default 200)

Note: when you set `--url`, the TUI does not fall back to config or environment credentials.
Pass `--token` or `--password` explicitly. Missing explicit credentials is an error.

## Troubleshooting

No output after sending a message:

- Run `/status` in the TUI to confirm the Gateway is connected and idle/busy, check the current run, and inspect the latest TUI error.
- Check the Gateway logs: `crawclaw logs --follow`.
- Confirm the agent can run: `crawclaw status` and `crawclaw models status`.
- If you expect messages in a chat channel, enable delivery (`/deliver on` or `--deliver`).

## Connection troubleshooting

- `disconnected`: ensure the Gateway is running and your `--url/--token/--password` are correct.
- No agents in picker: check `crawclaw agents list` and your routing config.
- Empty session picker: you might be in global scope or have no sessions yet.

## Related

- [CLI Reference](/cli) — full CLI command reference
