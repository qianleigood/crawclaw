# ESP32 Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` if you split this implementation across workers. Keep writes scoped to the files listed below.

**Goal:** Land a first-class ESP32 admin page in `apps/crawclaw-admin` for pairing and approval, while keeping the actual device lifecycle owned by the existing ESP32 plugin and the existing generic device-pairing infrastructure.

**Architecture:** The admin app gets a new standalone `ESP32` route, its own Pinia store, typed RPC helpers, and bilingual UI copy. The gateway gets a small `esp32.*` admin RPC layer that aggregates existing `device.pair.*` state with ESP32 plugin runtime state. The plugin remains the owner of pairing-session issuance, online device state, UDP sessions, and low-risk test actions.

**Tech Stack:** TypeScript, Vue 3 Composition API, Pinia, Vue Router, Vue I18n, Naive UI, CrawClaw gateway RPC handlers, existing ESP32 plugin service.

## Scope

Included in v1:

- standalone admin route and sidebar entry
- runtime status summary
- start pairing session
- pending pairing request list
- approve / reject pending requests
- paired device list
- device detail view
- revoke paired device
- low-risk test display action
- full `en-US` and `zh-CN` UI strings

Explicitly out of scope for this pass:

- OTA / firmware management
- raw MQTT / UDP debugging console
- arbitrary tool-call console
- batch approve / batch revoke
- plugin config editor

## File Structure

Frontend:

- Create `apps/crawclaw-admin/src/api/types/esp32.ts`
- Modify `apps/crawclaw-admin/src/api/types/index.ts`
- Modify `apps/crawclaw-admin/src/api/rpc-client.ts`
- Create `apps/crawclaw-admin/src/stores/esp32.ts`
- Modify `apps/crawclaw-admin/src/router/routes.ts`
- Modify `apps/crawclaw-admin/src/i18n/messages/en-US.ts`
- Modify `apps/crawclaw-admin/src/i18n/messages/zh-CN.ts`
- Create `apps/crawclaw-admin/src/views/esp32/ESP32Page.vue`
- Create `apps/crawclaw-admin/src/api/rpc-client.esp32.test.ts`
- Modify `apps/crawclaw-admin/src/router/routes.monitor.test.ts`

Gateway / plugin seam:

- Modify `extensions/esp32/api.ts`
- Modify `extensions/esp32/src/device-store.ts`
- Modify `extensions/esp32/src/pairing.ts`
- Modify `extensions/esp32/src/service.ts`
- Create `src/gateway/server-methods/esp32.ts`
- Modify `src/gateway/server-methods.ts`
- Modify `src/gateway/server-methods-list.ts`
- Modify `src/gateway/method-scopes.ts`
- Create `src/gateway/protocol/schema/esp32.ts`
- Modify `src/gateway/protocol/schema.ts`
- Modify `src/gateway/protocol/schema/protocol-schemas.ts`
- Modify `src/gateway/protocol/index.ts`
- Create `src/gateway/server-methods/esp32.test.ts`

## Tasks

### Task 1: Add the ESP32 admin RPC layer

- [ ] Add a public ESP32 plugin seam through `extensions/esp32/api.ts` so gateway code can read service state without deep-importing plugin internals.
- [ ] Extend the ESP32 plugin storage helpers so pairing sessions can be listed / revoked cleanly and stored devices can be removed on revoke.
- [ ] Add `esp32.*` gateway handlers for:
  - `esp32.status.get`
  - `esp32.pairing.start`
  - `esp32.pairing.requests.list`
  - `esp32.pairing.request.approve`
  - `esp32.pairing.request.reject`
  - `esp32.devices.list`
  - `esp32.devices.get`
  - `esp32.devices.revoke`
  - `esp32.devices.command.send`
- [ ] Reuse the existing generic device-pair approval / reject / remove path under the hood instead of duplicating pairing logic.
- [ ] Register the new methods in the gateway method list, scopes, and protocol validators.
- verify: `pnpm test -- src/gateway/server-methods/esp32.test.ts`

### Task 2: Add typed admin RPC access

- [ ] Define the frontend ESP32 types in `apps/crawclaw-admin/src/api/types/esp32.ts`.
- [ ] Export them from the admin type barrel.
- [ ] Add RPC client helpers that call the new `esp32.*` methods.
- [ ] Add a focused RPC client test file for request names and parameter normalization.
- verify: `pnpm test -- apps/crawclaw-admin/src/api/rpc-client.esp32.test.ts`

### Task 3: Build the admin page and store

- [ ] Add a dedicated `useEsp32Store()` for page state, loading, start-pairing, approve/reject, revoke, device detail, and test-display actions.
- [ ] Add the `/esp32` route as a first-class CrawClaw admin page.
- [ ] Build `ESP32Page.vue` with:
  - top status strip
  - pairing session card
  - pending requests table
  - paired devices table
  - device detail panel / modal
- [ ] Keep the page dense and operational, not marketing-style.
- verify: `pnpm test -- apps/crawclaw-admin/src/router/routes.monitor.test.ts apps/crawclaw-admin/src/api/rpc-client.esp32.test.ts`

### Task 4: Wire i18n and runtime language switching

- [ ] Add `routes.esp32` and `pages.esp32.*` keys to both `en-US` and `zh-CN`.
- [ ] Ensure all page labels, modal copy, status strings, and action labels use i18n keys.
- [ ] Keep literal identifiers like `deviceId`, `ESP32-S3-BOX-3`, tool names, and affect IDs untranslated.
- verify: build the admin app and inspect for missing i18n keys

### Task 5: Final verification

- [ ] Run focused gateway and admin tests.
- [ ] Run admin build.
- [ ] Run repo build because gateway protocol and public plugin seams changed.
- [ ] Check formatting / whitespace drift on touched files only.
- verify:
  - `pnpm test -- src/gateway/server-methods/esp32.test.ts apps/crawclaw-admin/src/api/rpc-client.esp32.test.ts apps/crawclaw-admin/src/router/routes.monitor.test.ts`
  - `pnpm --dir apps/crawclaw-admin build`
  - `pnpm build`
  - `git diff --check -- apps/crawclaw-admin src/gateway extensions/esp32 docs/superpowers/plans`
