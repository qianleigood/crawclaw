---
summary: "Troubleshoot node pairing, foreground requirements, permissions, and tool failures"
read_when:
  - Node is connected but camera/canvas/screen/exec tools fail
  - You need the node pairing versus approvals mental model
title: "Node Troubleshooting"
---

# Node troubleshooting

Use this page when a node is visible in status but node tools fail.

## Command ladder

```bash
crawclaw status
crawclaw gateway status
crawclaw logs --follow
crawclaw doctor
crawclaw channels status --probe
```

Then run node specific checks:

```bash
crawclaw nodes status
crawclaw nodes describe --node <idOrNameOrIp>
crawclaw approvals get --node <idOrNameOrIp>
```

Healthy signals:

- Node is connected and paired for role `node`.
- `nodes describe` includes the capability you are calling.
- Exec approvals show expected mode/allowlist.

## Foreground requirements

`canvas.*`, `camera.*`, and `screen.*` are foreground only on interactive node clients.

Quick check and fix:

```bash
crawclaw nodes describe --node <idOrNameOrIp>
crawclaw nodes canvas snapshot --node <idOrNameOrIp>
crawclaw logs --follow
```

If you see `NODE_BACKGROUND_UNAVAILABLE`, bring the node app to the foreground and retry.

## Permissions matrix

| Capability                   | macOS node app                | Headless node host          | Typical failure code           |
| ---------------------------- | ----------------------------- | --------------------------- | ------------------------------ |
| `camera.snap`, `camera.clip` | Camera (+ mic for clip audio) | n/a                         | `*_PERMISSION_REQUIRED`        |
| `screen.record`              | Screen Recording              | n/a                         | `*_PERMISSION_REQUIRED`        |
| `location.get`               | Location permission           | optional / runtime-specific | `LOCATION_PERMISSION_REQUIRED` |
| `system.run`                 | Exec approvals required       | Exec approvals required     | `SYSTEM_RUN_DENIED`            |

## Pairing versus approvals

These are different gates:

1. **Device pairing**: can this node connect to the gateway?
2. **Gateway node command policy**: is the RPC command ID allowed by `gateway.nodes.allowCommands` / `denyCommands` and platform defaults?
3. **Exec approvals**: can this node run a specific shell command locally?

Quick checks:

```bash
crawclaw devices list
crawclaw nodes status
crawclaw approvals get --node <idOrNameOrIp>
crawclaw approvals allowlist add --node <idOrNameOrIp> "/usr/bin/uname"
```

If pairing is missing, approve the node device first.
If `nodes describe` is missing a command, check the gateway node command policy and whether the node actually declared that command on connect.
If pairing is fine but `system.run` fails, fix exec approvals/allowlist on that node.

Node pairing is an identity/trust gate, not a per-command approval surface. For `system.run`, the per-node policy lives in that node's exec approvals file (`crawclaw approvals get --node ...`), not in the gateway pairing record.

## Common node error codes

- `NODE_BACKGROUND_UNAVAILABLE` → app is backgrounded; bring it foreground.
- `CAMERA_DISABLED` → camera toggle disabled in node settings.
- `*_PERMISSION_REQUIRED` → OS permission missing/denied.
- `LOCATION_DISABLED` → location mode is off.
- `LOCATION_PERMISSION_REQUIRED` → requested location mode not granted.
- `LOCATION_BACKGROUND_UNAVAILABLE` → app is backgrounded but only While Using permission exists.
- `SYSTEM_RUN_DENIED: approval required` → exec request needs explicit approval.
- `SYSTEM_RUN_DENIED: allowlist miss` → command blocked by allowlist mode.
  On Windows node hosts, shell-wrapper forms like `cmd.exe /c ...` are treated as allowlist misses in
  allowlist mode unless approved via ask flow.

## Fast recovery loop

```bash
crawclaw nodes status
crawclaw nodes describe --node <idOrNameOrIp>
crawclaw approvals get --node <idOrNameOrIp>
crawclaw logs --follow
```

If still stuck:

- Re-approve device pairing.
- Re-open node app (foreground).
- Re-grant OS permissions.
- Recreate/adjust exec approval policy.

Related:

- [/nodes/index](/nodes/index)
- [/nodes/camera](/nodes/camera)
- [/nodes/location-command](/nodes/location-command)
- [/tools/exec-approvals](/tools/exec-approvals)
- [/gateway/pairing](/gateway/pairing)
