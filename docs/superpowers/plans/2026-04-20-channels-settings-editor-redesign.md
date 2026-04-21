# Channels Settings Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `Channels` settings and account-editing subflow into a readable tabbed editor with shared submission state, separated account management, and novice-friendly field explanations.

**Architecture:** Keep the existing `Channels` route and selected `channelId` flow, but replace the current one-page settings surface with four tabs: `Overview`, `Accounts`, `Settings`, and `Advanced`. Rework the channel editor view model in `ui/src/ui/rewrite/app-root.ts` and `ui/src/ui/controllers/channel-config.ts` so the UI renders grouped presentation metadata, a shared status strip, and separate account-management and settings surfaces without duplicating raw schema fields.

**Tech Stack:** Lit, TypeScript, existing Control UI rewrite surface, Vitest, existing channel config controllers and schema-driven form renderer.

---

## File Structure

### Existing files to modify

- `ui/src/ui/rewrite/app-root.ts`
  - Owns the current `Channels` screen rendering, settings editor shell, settings/account sections, and copy map.
  - Will be updated to render the new tab strip, shared status strip, overview panel, accounts tab, grouped settings tab, and advanced tab.
- `ui/src/ui/controllers/channel-config.ts`
  - Owns config load, save, apply, dirty tracking, and reset behavior.
  - Will be updated to track active editor tab state, grouped presentation metadata, reload confirmation state, and submission summary fields consumed by the UI.
- `ui/src/styles/rewrite.css`
  - Owns the current channel settings layout and form styling.
  - Will be updated to style the tabbed editor, summary/stat blocks, accounts workspace, grouped form shell, advanced sections, and novice-friendly help affordances.
- `ui/src/ui/rewrite/legacy-cleanup.node.test.ts`
  - Existing source-level regression coverage for Channels UI cleanup.
  - Will be extended to lock in the new tabbed editor structure and removal of the current mixed stacked layout.

### Existing files to create or extend with tests

- `ui/src/ui/controllers/channel-config.test.ts`
  - Extend with controller-level tests for shared status strip state, tab-safe dirty tracking, and reload/reset behavior.
- `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`
  - New browser-level test file for tab rendering, account/settings separation, and shared submission state visibility.

### Optional helper extraction only if needed during implementation

- `ui/src/ui/rewrite/channel-editor-copy.ts`
  - Only create if `app-root.ts` copy tables become materially harder to maintain while adding field explanations and group labels.
- `ui/src/ui/rewrite/channel-editor-metadata.ts`
  - Only create if the grouping/help-text mapping becomes too large to live cleanly inside `app-root.ts`.

Do not create these helper files unless the implementation actually needs the split to keep `app-root.ts` understandable.

---

### Task 1: Lock in the new editor IA with failing structural tests

**Files:**

- Modify: `ui/src/ui/rewrite/legacy-cleanup.node.test.ts`
- Create: `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`

- [ ] **Step 1: Add source-level regression tests for the tabbed editor shell**

Add tests to `ui/src/ui/rewrite/legacy-cleanup.node.test.ts` asserting that the source now contains the new editor primitives and no longer relies on the old single stacked settings layout:

```ts
it("channels settings editor uses overview/accounts/settings/advanced tabs", () => {
  expect(source).toContain("channelsTabOverview");
  expect(source).toContain("channelsTabAccounts");
  expect(source).toContain("channelsTabSettings");
  expect(source).toContain("channelsTabAdvanced");
  expect(source).toContain("cp-channel-editor-tabs");
});

it("channels settings editor renders a shared submit status strip", () => {
  expect(source).toContain("cp-channel-editor-status");
  expect(source).toContain("submitState.title");
  expect(source).not.toContain("cp-channel-settings-overview");
});

it("channels settings editor no longer mixes account manager into the settings form shell", () => {
  expect(source).toContain("cp-channel-editor-accounts");
  expect(source).toContain("cp-channel-editor-settings");
  expect(source).not.toContain("cp-channel-settings-layout__side");
});
```

- [ ] **Step 2: Run the source-level test to verify it fails**

Run:

```bash
pnpm --dir ui test src/ui/rewrite/legacy-cleanup.node.test.ts -t "channels settings editor"
```

Expected: FAIL because the new tab keys/classes do not exist yet and the old layout classes still do.

- [ ] **Step 3: Add browser-level expectations for the new editor behavior**

Create `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts` with a focused render test scaffold that will fail until the new UI is in place:

```ts
import { describe, expect, it } from "vitest";
import { fixture, html } from "@open-wc/testing";
import "./app-root.ts";

describe("channels settings editor", () => {
  it("renders overview/accounts/settings/advanced tabs", async () => {
    const el = await fixture<any>(html`<cc-app-root></cc-app-root>`);
    // test helper hooks will be added in implementation
    const tabs = el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button");
    expect([...tabs].map((tab) => tab.textContent?.trim())).toEqual([
      "Overview",
      "Accounts",
      "Settings",
      "Advanced",
    ]);
  });

  it("shows one shared status strip above tab content", async () => {
    const el = await fixture<any>(html`<cc-app-root></cc-app-root>`);
    expect(el.renderRoot.querySelectorAll(".cp-channel-editor-status")).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run the new browser test to verify it fails**

Run:

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts
```

Expected: FAIL because the new classes and tabbed editor structure are not implemented yet.

- [ ] **Step 5: Commit the red tests**

```bash
scripts/committer "Test: add channels editor redesign regressions" \
  ui/src/ui/rewrite/legacy-cleanup.node.test.ts \
  ui/src/ui/rewrite/channels-settings-editor.browser.test.ts
```

---

### Task 2: Add controller state for tabs, grouped presentation, and shared submit status

**Files:**

- Modify: `ui/src/ui/controllers/channel-config.ts`
- Modify: `ui/src/ui/controllers/channel-config.test.ts`

- [ ] **Step 1: Add failing controller tests for shared editor state**

Extend `ui/src/ui/controllers/channel-config.test.ts` with tests for tab persistence, grouped metadata, and reload confirmation:

```ts
it("keeps dirty state while switching editor tabs", () => {
  const state = makeChannelConfigState();
  state.activeEditorTab = "settings";
  state.configFormDirty = true;
  setChannelEditorTab(state, "accounts");
  expect(state.activeEditorTab).toBe("accounts");
  expect(state.configFormDirty).toBe(true);
});

it("marks reload as confirm-required when form is dirty", () => {
  const state = makeChannelConfigState();
  state.configFormDirty = true;
  expect(channelReloadRequiresConfirm(state)).toBe(true);
});

it("builds grouped presentation buckets from schema/ui hints", () => {
  const state = makeChannelConfigState();
  state.configSchema = sampleSchema;
  state.configUiHints = sampleUiHints;
  const groups = buildChannelEditorGroups(state, "feishu");
  expect(groups.settings.map((group) => group.key)).toContain("sending-defaults");
});
```

- [ ] **Step 2: Run the controller test subset to verify it fails**

Run:

```bash
pnpm --dir ui test src/ui/controllers/channel-config.test.ts -t "editor"
```

Expected: FAIL because the tab helpers, reload guard, and grouped metadata builder do not exist yet.

- [ ] **Step 3: Add minimal controller types and helpers**

Update `ui/src/ui/controllers/channel-config.ts` with explicit editor state:

```ts
export type ChannelEditorTab = "overview" | "accounts" | "settings" | "advanced";

export interface ChannelEditorGroup {
  key: string;
  title: string;
  description: string;
  fieldPaths: string[];
  advanced?: boolean;
}

export interface ChannelConfigState {
  // existing fields...
  activeEditorTab: ChannelEditorTab;
  reloadConfirmOpen: boolean;
  groupedEditorState: {
    overview: ChannelEditorGroup[];
    settings: ChannelEditorGroup[];
    advanced: ChannelEditorGroup[];
  };
}

export function setChannelEditorTab(state: ChannelConfigState, tab: ChannelEditorTab) {
  state.activeEditorTab = tab;
}
```

- [ ] **Step 4: Add grouped presentation and reload helper logic**

In the same file, add helpers used by the UI:

```ts
export function channelReloadRequiresConfirm(state: ChannelConfigState) {
  return state.configFormDirty;
}

export function buildChannelEditorGroups(state: ChannelConfigState, channelId: string) {
  const groups = resolveChannelEditorMetadata(channelId, state.configUiHints);
  state.groupedEditorState = {
    overview: groups.overview,
    settings: groups.settings,
    advanced: groups.advanced,
  };
  return state.groupedEditorState;
}
```

Also ensure successful load paths initialize:

```ts
state.activeEditorTab ??= "overview";
state.reloadConfirmOpen = false;
buildChannelEditorGroups(state, channelId);
```

- [ ] **Step 5: Update reload/reset/save/apply paths to maintain shared status correctly**

Adjust existing actions so they do not reset tab state and they update shared result metadata consistently:

```ts
export function resetChannelConfigForm(state: ChannelConfigState) {
  state.configForm = cloneConfigValue(state.configFormOriginal ?? state.configForm);
  state.configFormDirty = false;
  state.lastError = null;
  state.reloadConfirmOpen = false;
}
```

When save/apply succeeds, preserve `activeEditorTab` and only update submission metadata.

- [ ] **Step 6: Run the controller tests to verify they pass**

Run:

```bash
pnpm --dir ui test src/ui/controllers/channel-config.test.ts
```

Expected: PASS, including the new editor-state tests.

- [ ] **Step 7: Commit the controller changes**

```bash
scripts/committer "UI: add channels editor state model" \
  ui/src/ui/controllers/channel-config.ts \
  ui/src/ui/controllers/channel-config.test.ts
```

---

### Task 3: Replace the stacked settings UI with the tabbed editor shell

**Files:**

- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`

- [ ] **Step 1: Add failing browser expectations for tab content switching**

Extend `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`:

```ts
it("renders account management only inside the accounts tab", async () => {
  const el = await fixture<any>(html`<cc-app-root></cc-app-root>`);
  await el.openTestChannelEditor("feishu");
  await el.setTestChannelEditorTab("accounts");
  expect(el.renderRoot.querySelector(".cp-channel-editor-accounts")).toBeTruthy();
  expect(el.renderRoot.querySelector(".cp-channel-editor-settings")).toBeFalsy();
});

it("renders grouped settings only inside the settings tab", async () => {
  const el = await fixture<any>(html`<cc-app-root></cc-app-root>`);
  await el.openTestChannelEditor("feishu");
  await el.setTestChannelEditorTab("settings");
  expect(el.renderRoot.querySelector(".cp-channel-editor-settings")).toBeTruthy();
  expect(el.renderRoot.querySelector(".cp-channel-editor-accounts")).toBeFalsy();
});
```

- [ ] **Step 2: Run the browser test file and verify it still fails**

Run:

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts
```

Expected: FAIL because the helper hooks and new tab content classes are not present.

- [ ] **Step 3: Add new copy keys and helper renderers in `app-root.ts`**

Add copy keys for tabs, novice help, and grouped settings:

```ts
channelsTabOverview: "Overview",
channelsTabAccounts: "Accounts",
channelsTabSettings: "Settings",
channelsTabAdvanced: "Advanced",
channelsUnsavedChanges: "You have unsaved changes.",
channelsReloadConfirm: "Reload will discard unsaved edits.",
channelsSettingsGroupSendingTitle: "Sending and defaults",
channelsSettingsGroupSendingHint:
  "Control which account sends by default and how this channel behaves when no explicit account is selected.",
```

Add view helpers with one clear responsibility each:

```ts
private renderChannelEditorStatusStrip(...)
private renderChannelEditorTabs(...)
private renderChannelOverviewTab(...)
private renderChannelAccountsTab(...)
private renderChannelSettingsTab(...)
private renderChannelAdvancedTab(...)
```

- [ ] **Step 4: Replace the current settings panel markup with the new shell**

In `renderSettingsPanel`, replace the current `cp-channel-settings-overview` and `cp-channel-settings-layout` block with:

```ts
<div class="cp-channel-editor">
  ${this.renderChannelEditorStatusStrip(...)}
  ${this.renderChannelEditorTabs(...)}
  <div class="cp-channel-editor__body">
    ${activeTab === "overview" ? this.renderChannelOverviewTab(...) : nothing}
    ${activeTab === "accounts" ? this.renderChannelAccountsTab(...) : nothing}
    ${activeTab === "settings" ? this.renderChannelSettingsTab(...) : nothing}
    ${activeTab === "advanced" ? this.renderChannelAdvancedTab(...) : nothing}
  </div>
</div>
```

Inside the new tab renderers, enforce separation:

- `overview` renders summaries and jump actions only
- `accounts` renders account list and account-specific actions only
- `settings` renders grouped channel form only
- `advanced` renders advanced groups and dangerous actions only

- [ ] **Step 5: Add minimal test hooks for the browser tests**

Expose narrowly scoped test helpers on the component instance:

```ts
async openTestChannelEditor(channelId: string) {
  this.openChannelSettings(channelId);
  await this.updateComplete;
}

async setTestChannelEditorTab(tab: ChannelEditorTab) {
  setChannelEditorTab(this.channelConfigState, tab);
  this.requestUpdate();
  await this.updateComplete;
}
```

Keep them local to the component and do not route production logic through test-only branches.

- [ ] **Step 6: Run the browser tests to verify the tabbed shell now passes**

Run:

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts
```

Expected: PASS for the new tab shell and content separation checks.

- [ ] **Step 7: Commit the tabbed UI shell**

```bash
scripts/committer "UI: rebuild channels editor as tabbed flow" \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/ui/rewrite/channels-settings-editor.browser.test.ts
```

---

### Task 4: Add novice-friendly field grouping and help presentation

**Files:**

- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/styles/rewrite.css`
- Modify: `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`

- [ ] **Step 1: Add failing browser tests for user-facing field explanations**

Extend `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`:

```ts
it("shows plain-language group intros for settings sections", async () => {
  const el = await fixture<any>(html`<cc-app-root></cc-app-root>`);
  await el.openTestChannelEditor("feishu");
  await el.setTestChannelEditorTab("settings");
  expect(el.renderRoot.textContent).toContain("Control which account sends by default");
});

it("does not show raw accounts fields inside the settings tab", async () => {
  const el = await fixture<any>(html`<cc-app-root></cc-app-root>`);
  await el.openTestChannelEditor("feishu");
  await el.setTestChannelEditorTab("settings");
  expect(el.renderRoot.textContent).not.toContain("defaultAccount");
});
```

- [ ] **Step 2: Run the browser tests to verify they fail**

Run:

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts -t "settings"
```

Expected: FAIL because the current settings renderer does not yet show grouped human-readable introductions.

- [ ] **Step 3: Add field-group metadata and explanation rendering**

In `ui/src/ui/rewrite/app-root.ts`, create a local mapping from group keys to visible metadata:

```ts
const CHANNEL_EDITOR_GROUP_COPY = {
  "basic-information": {
    title: copy.channels.settingsGroupBasicTitle,
    description: copy.channels.settingsGroupBasicHint,
  },
  "sending-defaults": {
    title: copy.channels.settingsGroupSendingTitle,
    description: copy.channels.settingsGroupSendingHint,
  },
};
```

Render grouped sections in the settings tab:

```ts
${repeat(settingsGroups, (group) => group.key, (group) => html`
  <section class="cp-channel-editor-group">
    <header class="cp-channel-editor-group__head">
      <h4>${group.title}</h4>
      <p>${group.description}</p>
    </header>
    ${renderChannelConfigForm({
      channelId: selectedChannelId,
      configValue: settingsEditorValue,
      schema: pickSchemaFields(settingsEditorSchema, group.fieldPaths),
      uiHints: this.channelConfigState.configUiHints,
      disabled: channelEditorBusy,
      scoped: true,
      onPatch: (path, value) => updateChannelConfigFormValue(this.channelConfigState, path, value),
    })}
  </section>
`)}
```

- [ ] **Step 4: Add visual styles that reduce debug-surface feel**

Update `ui/src/styles/rewrite.css` with classes like:

```css
.cp-channel-editor-group {
  display: grid;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid rgba(96, 115, 173, 0.16);
  background: rgba(8, 18, 31, 0.72);
}

.cp-channel-editor-group__head p {
  margin: 0;
  color: var(--cp-text-soft);
  max-width: 62ch;
}

.cp-channel-editor-help {
  font-size: 0.82rem;
  color: var(--cp-text-soft);
}
```

Style the tabs, status strip, and novice help so the page reads as a settings product instead of a raw schema surface.

- [ ] **Step 5: Run the browser tests to verify help text now appears**

Run:

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts
```

Expected: PASS, including the new user-facing help assertions.

- [ ] **Step 6: Commit the readability layer**

```bash
scripts/committer "UI: add readable grouping to channels editor" \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/styles/rewrite.css \
  ui/src/ui/rewrite/channels-settings-editor.browser.test.ts
```

---

### Task 5: Wire final submit behavior, reload protection, and cleanup regressions

**Files:**

- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/styles/rewrite.css`
- Modify: `ui/src/ui/rewrite/legacy-cleanup.node.test.ts`
- Modify: `ui/src/ui/controllers/channel-config.test.ts`

- [ ] **Step 1: Add failing tests for reload protection and shared status messaging**

Add to `ui/src/ui/controllers/channel-config.test.ts`:

```ts
it("keeps last submit metadata visible after apply", async () => {
  const state = makeChannelConfigState();
  await applyChannelConfig(state);
  expect(state.lastSubmitKind).toBe("apply");
  expect(state.lastSubmitAt).not.toBeNull();
});
```

Add to `ui/src/ui/rewrite/legacy-cleanup.node.test.ts`:

```ts
it("channels editor exposes one shared status strip and tab shell", () => {
  expect(source).toContain("cp-channel-editor-status");
  expect(source).toContain("cp-channel-editor-tabs");
  expect(source).not.toContain("cp-channel-settings-submit__actions");
});
```

- [ ] **Step 2: Run the focused tests to verify current gaps**

Run:

```bash
pnpm --dir ui test src/ui/controllers/channel-config.test.ts -t "last submit metadata visible after apply"
pnpm --dir ui test src/ui/rewrite/legacy-cleanup.node.test.ts -t "channels editor exposes one shared status strip"
```

Expected: FAIL if the status metadata or old layout classes are still incomplete.

- [ ] **Step 3: Finish the shared submit bar behavior in the UI**

In `ui/src/ui/rewrite/app-root.ts`, ensure the action bar is global and rule-driven:

```ts
<button
  class="cp-button"
  ?disabled=${channelEditorBusy || !this.channelConfigState.configFormDirty}
  @click=${() => resetChannelConfigForm(this.channelConfigState)}
>
  ${copy.channels.resetChannelEdits}
</button>

<button
  class="cp-button cp-button--primary"
  ?disabled=${channelEditorBusy || !this.channelConfigState.configFormDirty}
  @click=${() => void this.handleApplyChannelSettings(selectedChannelId)}
>
  ${copy.channels.applyChannelSettings}
</button>
```

For reload:

```ts
if (channelReloadRequiresConfirm(this.channelConfigState)) {
  this.channelConfigState.reloadConfirmOpen = true;
  return;
}
```

- [ ] **Step 4: Remove the now-dead old settings layout selectors**

Delete or rewrite obsolete CSS and source assumptions:

- `.cp-channel-settings-overview`
- `.cp-channel-settings-layout`
- `.cp-channel-settings-layout__main`
- `.cp-channel-settings-layout__side`
- `.cp-channel-settings-submit__actions`
- `.cp-channel-settings-accounts`

Replace them with the new editor classes only.

- [ ] **Step 5: Run the full touched-surface verification**

Run:

```bash
pnpm --dir ui test src/ui/controllers/channel-config.test.ts
pnpm --dir ui test src/ui/rewrite/legacy-cleanup.node.test.ts
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts
pnpm --dir ui build
```

Expected:

- all touched tests PASS
- UI build PASS

- [ ] **Step 6: Commit the submit-flow and cleanup pass**

```bash
scripts/committer "UI: finalize channels editor submit flow" \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/styles/rewrite.css \
  ui/src/ui/rewrite/legacy-cleanup.node.test.ts \
  ui/src/ui/controllers/channel-config.test.ts
```

---

## Self-Review

### Spec coverage

- tabbed `Overview / Accounts / Settings / Advanced` flow: covered in Tasks 1 and 3
- shared status strip and submit-state model: covered in Tasks 2 and 5
- novice-readable field grouping and explanations: covered in Task 4
- separation of account management and channel settings: covered in Tasks 3 and 4
- advanced isolation and dangerous-action handling: covered in Tasks 3 and 5
- backend reuse with frontend metadata layer: covered in Tasks 2 and 4

No spec gaps remain for the scoped implementation.

### Placeholder scan

- no `TODO`/`TBD`
- every task contains exact file paths
- every test task includes concrete test code
- every verification step includes exact commands

### Type consistency

- tab type is consistently `ChannelEditorTab`
- shared submission fields use existing `lastSubmitKind`, `lastSubmitMethod`, `lastSubmitAt`
- UI classes use `cp-channel-editor-*` consistently across tasks
