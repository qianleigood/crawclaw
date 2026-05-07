---
title: "ESP32 Admin Page Design"
summary: "Design for a first-class CrawClaw admin page that manages ESP32 pairing, approvals, devices, and low-risk operations"
read_when:
  - You are implementing the ESP32 admin page in apps/crawclaw-admin
  - You need the frontend and backend boundary for ESP32 pairing and device management
---

# ESP32 Admin Page Design

## Summary

CrawClaw should add a first-class `ESP32` management page to
`apps/crawclaw-admin`. The page should not be hidden inside the generic `Nodes`
page or stretched into the `Channels` page. The ESP32 surface has a different
shape from the existing node UI: it combines channel status, short-lived
pairing sessions, pending approvals, paired device inventory, online state, and
device-declared capabilities.

The first page pass should optimize for `pairing and approval` because that is
where the current user flow still falls back to CLI. The admin page should let
operators start pairing sessions, review pending requests, approve or reject
them, inspect paired devices, revoke devices, and view capability summaries. It
should reuse existing approval and pairing primitives behind a new admin-facing
RPC layer instead of forcing the frontend to emulate CLI commands.

The first implementation target is the tracked Vue admin app under
`apps/crawclaw-admin`, using the existing router, Pinia stores, i18n, RPC
client, and Naive UI patterns already used by pages such as `Channels`,
`Nodes`, and `ComfyUI`.

## Goals

- Add a dedicated `ESP32` route to the CrawClaw admin navigation.
- Show whether the ESP32 bundled plugin is enabled and whether its managed MQTT
  broker and UDP service are configured.
- Let operators start a short-lived pairing session from the admin UI.
- Show pending pairing requests with enough metadata to make an approval
  decision.
- Let operators approve or reject a pending pairing request from the admin UI.
- Show paired devices with online or offline state, last seen time, and
  declared capabilities.
- Let operators revoke a paired device.
- Show device detail with supported display, affect, audio, and tool
  capabilities.
- Expose a small set of low-risk test actions, such as sending display text or
  a muted state command, after device pairing is working.

## Non-Goals

- Do not build the ESP32 firmware UI inside the admin page.
- Do not expose raw MQTT topic publishing or UDP packet debugging in the first
  pass.
- Do not build a generic device-tool console that can invoke arbitrary
  high-risk tools.
- Do not add OTA update management.
- Do not build multi-room or fleet grouping in the first pass.
- Do not turn the existing `Nodes` page into a second ESP32 operations page.
- Do not make the page a full plugin configuration editor in the first pass.

## Existing Fit

The current repository already contains the ESP32 channel and service side:

- `extensions/esp32` contains pairing, MQTT, UDP, renderer, device store, and
  device registry logic.
- `docs/channels/esp32.md` documents the current operator flow as
  `crawclaw esp32 pair start --name desk` followed by
  `crawclaw devices approve <requestId>`.
- `apps/crawclaw-admin` currently has no `esp32` page, route, or store.
- `apps/crawclaw-admin/src/views/nodes/NodesPage.vue` is a generic node page
  that assumes the existing node pairing RPC shape and should remain generic.
- `apps/crawclaw-admin/src/views/channels/ChannelsPage.vue` is optimized for
  channel configuration cards and should not absorb pending device approvals or
  paired device operations.

The gap is therefore not protocol or plugin runtime. The gap is the operations
surface that turns the current CLI pairing workflow into a normal admin
workflow.

## Information Architecture

Add a new top-level admin route:

- path: `/esp32`
- page component: `apps/crawclaw-admin/src/views/esp32/ESP32Page.vue`
- store: `apps/crawclaw-admin/src/stores/esp32.ts`
- API types: `apps/crawclaw-admin/src/api/types/esp32.ts`

This should be a first-class route in the same style as `ComfyUI`, `Channels`,
and `Voice`. It should not be nested under `Channels` or `Nodes`.

The page should behave as a compact operations workbench rather than a marketing
dashboard:

1. Status bar
2. Pairing workspace
3. Paired device inventory
4. Device detail drawer

## Page Structure

### 1. Header Status Bar

The header should summarize the ESP32 channel runtime state in one horizontal
band:

- plugin enabled or disabled
- managed MQTT broker host and port
- UDP host and port
- renderer model summary
- TTS provider summary
- count of pending pairing requests
- count of online paired devices

Primary actions:

- `Start Pairing Session`
- `Refresh`

This area answers the operator question: "Is the ESP32 channel ready to accept a
new device right now?"

### 2. Pairing Workspace

This is the primary v1 region. It should have two subpanels:

- active pairing session card
- pending pairing request list

#### Active Pairing Session Card

When the operator starts a pairing session, show:

- session name
- `pairId`
- MQTT username
- pairing code
- broker host and port
- expiration time
- remaining TTL

Actions:

- `Copy Pairing Info`
- `Expire Now`
- `Start New Session`

Only one active session needs to be foregrounded in v1. Historical sessions do
not need a separate table yet.

#### Pending Pairing Request List

Each pending request card should show:

- `requestId`
- `deviceId`
- `deviceFamily`
- `hardwareTarget`
- `fingerprint`
- capability summary
- request time
- request source pairing session when available

Actions:

- `Approve`
- `Reject`
- `Copy CLI`
- `View Raw`

`Copy CLI` is a fallback and operator aid, not the primary path. The normal
approval path should stay inside the page.

### 3. Paired Device Inventory

Show a compact list or grid for paired devices. The expected scale is around
`10 devices or fewer`, so a dense list with expandable detail is sufficient.

Each device row or card should show:

- display name if available, otherwise `deviceId`
- online or offline state
- last seen time
- device family and hardware target
- whether MQTT is currently online
- whether UDP endpoint has been learned
- a compact capability summary, such as display, audio, affect, tools

Actions:

- `Open Details`
- `Revoke`
- `Send Test Display`
- `Mute` or `Unmute` if supported

`Revoke` must require confirmation.

### 4. Device Detail Drawer

Selecting a paired device opens a right-side drawer rather than a full-page
navigation. The drawer should include:

- identity: `deviceId`, display name, fingerprint
- pair metadata: paired at, last seen, revoked or active
- transport summary: MQTT user, UDP session readiness, endpoint if known
- supported affect states or expressions
- supported LED or chime identifiers
- declared device tools with risk level
- recent command results or last command outcome

The drawer is where operators inspect device shape before approving wider use.

## Primary User Flows

### Flow 1: Start Pairing Session

1. Operator opens `/esp32`.
2. Operator clicks `Start Pairing Session`.
3. Modal requests:
   - session name
   - TTL, default 5 minutes
   - optional note
4. Admin calls a dedicated ESP32 pairing-start RPC.
5. UI shows the session card with the generated pairing code and connection
   fields.
6. Operator enters these values on the physical device setup page.

This flow replaces the need to manually run `crawclaw esp32 pair start`.

### Flow 2: Review and Approve Pairing Request

1. Device publishes its pairing hello.
2. Backend records a pending request.
3. The `Pairing Requests` list updates.
4. Operator opens the request card and checks:
   - target hardware
   - device id
   - fingerprint
   - capability summary
5. Operator clicks `Approve`.
6. Admin calls an ESP32 approval RPC that reuses the existing approval path
   underneath.
7. Request leaves the pending list and the device appears in `Paired Devices`.

### Flow 3: Reject Pairing Request

1. Operator clicks `Reject`.
2. Confirmation modal appears.
3. Backend marks the request rejected and, when possible, emits the rejection
   status back to the temporary pairing topic.

### Flow 4: Revoke Paired Device

1. Operator opens a paired device card or detail drawer.
2. Operator clicks `Revoke`.
3. Confirmation modal explains that existing MQTT credentials will stop working
   and the device must pair again.
4. Backend revokes the device token and updates persisted device state.
5. Device remains visible in history but is marked revoked.

## Backend RPC Surface

The admin app should not call CLI commands directly. It should consume a small
ESP32-specific management RPC surface. The backend can internally bridge to
existing pairing and approval primitives.

Recommended methods:

- `esp32.status.get`
  - returns plugin enabled state, broker summary, UDP summary, renderer summary,
    TTS summary, pending count, and online count

- `esp32.pairing.start`
  - input: session name, TTL, optional note
  - output: `pairId`, username, pairing code, broker summary, expiry

- `esp32.pairing.session.expire`
  - input: `pairId`

- `esp32.pairing.requests.list`
  - returns pending and recently resolved requests

- `esp32.pairing.request.get`
  - returns one request detail including raw capabilities when needed

- `esp32.pairing.request.approve`
  - input: `requestId`
  - backend reuses the existing approval path

- `esp32.pairing.request.reject`
  - input: `requestId`, optional reason

- `esp32.devices.list`
  - returns paired devices aggregated from persisted state and online registry

- `esp32.devices.get`
  - returns one paired device detail

- `esp32.devices.revoke`
  - input: `deviceId`

- `esp32.devices.command.send`
  - limited to low-risk admin actions such as test display or mute state

This RPC layer is intentionally page-shaped. The frontend should not need to
understand MQTT topics, temporary pairing topics, UDP session structs, or device
store layout.

## Data Model

### Pairing Request Summary

The admin page needs a durable request summary separate from the raw MQTT
payload:

- `requestId`
- `pairId`
- `status`: `pending | approved | rejected | expired`
- `deviceId`
- `deviceFamily`
- `hardwareTarget`
- `fingerprint`
- `requestedAtMs`
- `resolvedAtMs?`
- `capabilities`
- `displaySupport`
- `audioSupport`
- `toolSummary`

### Paired Device Summary

- `deviceId`
- `displayName?`
- `deviceFamily`
- `hardwareTarget`
- `fingerprint`
- `pairedAtMs`
- `lastSeenAtMs`
- `online`
- `mqttOnline`
- `udpReady`
- `revoked`
- `capabilities`
- `tools`

### Device Detail

Includes the summary fields plus:

- supported affect identifiers
- supported LED identifiers
- supported chime identifiers
- last known UDP endpoint
- recent command results
- recent error state

## Frontend State Design

Create a dedicated Pinia store rather than extending `node.ts` or
`channel-management.ts`.

Store modules or sections:

- `status`
- `activePairingSession`
- `pairingRequests`
- `devices`
- `selectedDeviceDetail`

This page is operational rather than purely configuration-driven. Reusing the
channel-management store would mix unrelated state lifecycles, while reusing the
node store would force ESP32 to imitate a generic node pairing model that does
not actually match the bundled ESP32 plugin.

## Internationalization

The page must fully participate in the existing admin language-switching model.
`ESP32` should not become an English-only operations surface.

Requirements:

- Route title, menu label, section titles, button labels, table headings,
  empty states, confirmation dialogs, and error toasts must all use the
  existing admin i18n message system.
- The page must respond correctly when the operator changes the admin UI
  language at runtime.
- Device-declared values such as `deviceId`, `hardwareTarget`, tool names,
  affect identifiers, and MQTT field names should remain literal identifiers
  rather than being translated.
- Operator-facing explanatory text around those identifiers must be localized.
- The first implementation pass should include both at least `en-US` and
  `zh-CN` message coverage, following the same message-key conventions already
  used by other admin pages.

## UI Behavior

- Use a compact operational layout with restrained visual styling.
- Use tags for `pending`, `approved`, `offline`, `revoked`, and `error` states.
- Do not infer emotion or device support from free text; only show device
  capabilities that the device has declared.
- Use drawers for detail instead of page hops.
- Use explicit confirmations for approval rejection and device revoke.
- Keep the header status visible while scrolling if convenient, but do not turn
  the page into a large card grid.

## Error Handling

- If the ESP32 plugin is disabled, the page should show a setup state with a
  direct hint to enable `plugins.entries.esp32.enabled`.
- If the managed broker is unavailable, show the configured host and port and
  the failure summary.
- If a pairing session expires before a device requests approval, show it as
  expired and prompt the operator to start a new session.
- If approval fails because the underlying request already resolved, refresh the
  request list and show the new state.
- If a device is revoked while it is currently online, keep the row visible but
  mark it revoked immediately.
- If a low-risk command fails, show the result in the detail drawer instead of
  silently swallowing it.

## Security and Permission Notes

- Approval and revoke are operator actions and should require the same admin
  authority level as other privileged device-management actions.
- The first page pass should not expose arbitrary `esp32_call_tool` invocation
  from the UI.
- High-risk tools remain blocked or approval-gated by backend policy; the admin
  page should not provide a bypass.
- Raw secrets such as device tokens should never be displayed after approval.

## Testing

Backend:

- Unit test pairing session creation and expiry formatting for admin output.
- Unit test pairing request list normalization.
- Unit test approve and reject adapters over the existing approval path.
- Unit test paired device list aggregation from persisted device store and online
  registry.
- Unit test revoke behavior.

Frontend:

- Route test: `/esp32` is registered and visible in the CrawClaw gateway menu.
- Store test: start pairing session, load requests, approve request, revoke
  device.
- Component test: pending request actions and device detail drawer rendering.
- Manual smoke:
  - plugin disabled state
  - start pairing session
  - pending request appears
  - approve request transitions device into paired list
  - revoke invalidates device state

## First-Pass Decisions

- Add a dedicated top-level `ESP32` admin page.
- Prioritize pairing and approval over broad device operations.
- Reuse existing approval and pairing internals through new admin-facing RPCs.
- Include paired device inventory and revoke in v1.
- Keep advanced MQTT and UDP diagnostics out of the first page pass.
