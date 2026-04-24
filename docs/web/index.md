summary: "Gateway web surfaces, including Observation Workbench"
read_when:

- You want to access the Gateway over Tailscale
- You want the remaining browser-facing Gateway surfaces
  title: "Web"

---

# Web (Gateway)

The dedicated browser Control UI has been removed from the project.

The Gateway still exposes HTTP/WebSocket surfaces for:

- [WebChat](/web/webchat)
- [TUI over the gateway](/web/tui)
- Observation Workbench at `/observations`
- webhook receivers such as channel integrations

This page focuses on the remaining bind modes, security constraints, and web-facing surfaces.

## Observation Workbench

Open `/observations` on the Gateway HTTP port to inspect unified ObservationContext timelines.
The workbench is read-only. It uses `agent.observations.list` for historical run summaries from
the durable Observation Index and `agent.inspect` for run, task, or trace details.

The page shows:

- run summaries filtered by `runId`, `taskId`, `traceId`, `sessionKey`, `agentId`, source,
  status, or time range
- a mixed timeline for lifecycle, diagnostic, action-feed, archive, trajectory, log, and OTel sources
- an evidence panel with ObservationContext, refs, metrics, and redacted raw JSON
- Trace Map and Ops tabs for span relationships and sink coverage

List responses contain only metadata, status, counts, source coverage, and trace refs. Prompt,
transcript, and tool result bodies are not included in the list payload, and the Raw JSON tab
redacts sensitive or heavy fields before display.

The index is stored in the existing runtime SQLite database. Context archive and task trajectory
records remain the durable evidence stores; the index keeps only search metadata and refs needed
to hydrate details on demand.

## Webhooks

When `hooks.enabled=true`, the Gateway also exposes a small webhook endpoint on the same HTTP server.
See [Gateway configuration](/gateway/configuration) → `hooks` for auth + payloads.

## Tailscale access

### Integrated Serve (recommended)

Keep the Gateway on loopback and let Tailscale Serve proxy it:

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "serve" },
  },
}
```

Then start the gateway:

```bash
crawclaw gateway
```

Open the web surface you actually intend to use, such as WebChat.

### Tailnet bind + token

```json5
{
  gateway: {
    bind: "tailnet",
    auth: { mode: "token", token: "your-token" },
  },
}
```

Then start the gateway (token required for non-loopback binds):

```bash
crawclaw gateway
```

Open the specific HTTP surface you intend to use on the gateway port.

### Public internet (Funnel)

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "funnel" },
    auth: { mode: "password" }, // or CRAWCLAW_GATEWAY_PASSWORD
  },
}
```

## Security notes

- Gateway auth is required by default (token/password or Tailscale identity headers).
- Non-loopback binds still **require** a shared token/password (`gateway.auth` or env).
- The wizard generates a gateway token by default (even on loopback).
- Browser-based clients send `connect.params.auth.token` or `connect.params.auth.password`.
- For non-loopback browser deployments, set `gateway.controlUi.allowedOrigins`
  explicitly (full origins). Without it, gateway startup is refused by default.
- `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback=true` enables
  Host-header origin fallback mode, but is a dangerous security downgrade.
- With Serve, Tailscale identity headers can satisfy browser/WebSocket auth
  when `gateway.auth.allowTailscale` is `true` (no token/password required).
  HTTP API endpoints still require token/password. Set
  `gateway.auth.allowTailscale: false` to require explicit credentials. See
  [Tailscale](/gateway/tailscale) and [Security](/gateway/security). This
  tokenless flow assumes the gateway host is trusted.
- `gateway.tailscale.mode: "funnel"` requires `gateway.auth.mode: "password"` (shared password).

## Removed surface

The old `dist/control-ui` asset surface and the `crawclaw dashboard` command no longer exist in this repository.
