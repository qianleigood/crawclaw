# Control UI Stitch Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the browser Control UI so the app shell, page structure, controls, and channels subflows match the canonical Stitch baseline 1:1, while allowing the backend contract to move with the UI.

**Architecture:** Split the current monolithic Control UI rewrite surface into a Stitch-first shell, shared primitives, page-specific screen components, and page-oriented controllers/contracts. Use runtime i18n for English and Simplified Chinese only, keep `Channels` subflows nested, and delete replaced UI code as each rebuilt area becomes authoritative.

**Tech Stack:** Lit, Vite, TypeScript, Vitest, Gateway control-plane RPC schemas, existing browser i18n registry.

---

## File Structure

### New frontend files

- Create: `ui/src/ui/rewrite/shell/control-shell.ts`
- Create: `ui/src/ui/rewrite/shell/control-topbar.ts`
- Create: `ui/src/ui/rewrite/shell/control-sidebar.ts`
- Create: `ui/src/ui/rewrite/primitives/control-card.ts`
- Create: `ui/src/ui/rewrite/primitives/control-metric-tile.ts`
- Create: `ui/src/ui/rewrite/primitives/control-tab-strip.ts`
- Create: `ui/src/ui/rewrite/primitives/control-split-panel.ts`
- Create: `ui/src/ui/rewrite/primitives/control-list-row.ts`
- Create: `ui/src/ui/rewrite/screens/overview-screen.ts`
- Create: `ui/src/ui/rewrite/screens/sessions-screen.ts`
- Create: `ui/src/ui/rewrite/screens/channels-screen.ts`
- Create: `ui/src/ui/rewrite/screens/workflows-screen.ts`
- Create: `ui/src/ui/rewrite/screens/agents-screen.ts`
- Create: `ui/src/ui/rewrite/screens/memory-screen.ts`
- Create: `ui/src/ui/rewrite/screens/runtime-screen.ts`
- Create: `ui/src/ui/rewrite/screens/usage-screen.ts`
- Create: `ui/src/ui/rewrite/screens/config-screen.ts`
- Create: `ui/src/ui/rewrite/screens/debug-screen.ts`
- Create: `ui/src/ui/rewrite/screens/screen-types.ts`
- Create: `ui/src/ui/rewrite/screen-copy.ts`
- Create: `ui/src/styles/rewrite/tokens.css`
- Create: `ui/src/styles/rewrite/shell.css`
- Create: `ui/src/styles/rewrite/primitives.css`
- Create: `ui/src/styles/rewrite/screens.css`

### Frontend files to modify

- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/ui/rewrite/routes.ts`
- Modify: `ui/src/ui/rewrite/routes.test.ts`
- Modify: `ui/src/styles/rewrite.css`
- Modify: `ui/src/i18n/locales/en.ts`
- Modify: `ui/src/i18n/locales/zh-CN.ts`
- Modify: `ui/index.html`

### Backend files to modify

- Modify: `src/gateway/protocol/control-ui-methods.ts`
- Modify: `src/gateway/protocol/control-ui-methods.test.ts`
- Modify: `src/gateway/protocol/schema/channels.ts`
- Modify: `src/gateway/protocol/schema/memory.ts`
- Modify: `src/gateway/protocol/schema/sessions.ts`
- Modify: `src/gateway/protocol/schema/usage.ts`
- Create: `src/gateway/protocol/schema/control-ui-overview.ts`
- Create: `src/gateway/protocol/schema/control-ui-workflows.ts`
- Create: `src/gateway/protocol/schema/control-ui-agents.ts`
- Create: `src/gateway/protocol/schema/control-ui-runtime.ts`

### Controller files to modify

- Modify: `ui/src/ui/controllers/channels.ts`
- Modify: `ui/src/ui/controllers/channel-config.ts`
- Modify: `ui/src/ui/controllers/channel-setup.ts`
- Modify: `ui/src/ui/controllers/sessions.ts`
- Modify: `ui/src/ui/controllers/workflows.ts`
- Modify: `ui/src/ui/controllers/agents.ts`
- Modify: `ui/src/ui/controllers/memory.ts`
- Modify: `ui/src/ui/controllers/agent-runtime.ts`
- Modify: `ui/src/ui/controllers/usage.ts`
- Modify: `ui/src/ui/controllers/config.ts`
- Modify: `ui/src/ui/controllers/debug.ts`

### Docs to modify

- Modify: `docs/web/control-ui.md`
- Modify: `docs/web/control-ui-ux.md`
- Modify: `docs/concepts/architecture.md`
- Modify: `docs/.i18n/glossary.zh-CN.json`
- Modify: `docs/zh-CN/concepts/project-control-ui-stitch-1to1-pr-plan.md`
- Modify: `docs/zh-CN/concepts/project-control-ui-stitch-baseline.md`

### Tests to add or update

- Create: `ui/src/ui/rewrite/control-shell.browser.test.ts`
- Create: `ui/src/ui/rewrite/channels-subflows.browser.test.ts`
- Create: `ui/src/ui/rewrite/i18n.browser.test.ts`
- Modify: `ui/src/ui/rewrite/routes.test.ts`
- Modify: `ui/src/ui/controllers/channels.test.ts`
- Modify: `ui/src/ui/controllers/sessions.test.ts`
- Modify: `ui/src/ui/controllers/workflows.test.ts`
- Modify: `ui/src/ui/controllers/agents.test.ts`
- Modify: `ui/src/ui/controllers/memory.test.ts`
- Modify: `ui/src/ui/controllers/config.test.ts`
- Modify: `ui/src/ui/controllers/usage.node.test.ts`
- Modify: `src/gateway/protocol/control-ui-methods.test.ts`

## Task 1: Establish The Stitch-First Shell And Primitive Layer

**Files:**

- Create: `ui/src/ui/rewrite/shell/control-shell.ts`
- Create: `ui/src/ui/rewrite/shell/control-topbar.ts`
- Create: `ui/src/ui/rewrite/shell/control-sidebar.ts`
- Create: `ui/src/ui/rewrite/primitives/control-card.ts`
- Create: `ui/src/ui/rewrite/primitives/control-metric-tile.ts`
- Create: `ui/src/ui/rewrite/primitives/control-tab-strip.ts`
- Create: `ui/src/ui/rewrite/primitives/control-split-panel.ts`
- Create: `ui/src/ui/rewrite/primitives/control-list-row.ts`
- Create: `ui/src/styles/rewrite/tokens.css`
- Create: `ui/src/styles/rewrite/shell.css`
- Create: `ui/src/styles/rewrite/primitives.css`
- Modify: `ui/src/styles/rewrite.css`
- Test: `ui/src/ui/rewrite/control-shell.browser.test.ts`

- [ ] **Step 1: Write the failing shell parity test**

```ts
import { fixture, html } from "@open-wc/testing";
import { expect, test } from "vitest";
import "./control-shell.ts";

test("renders stitch shell landmarks and action strip", async () => {
  const el = await fixture<any>(html`
    <control-shell
      .locale=${"en"}
      .pages=${[{ id: "overview", icon: "dashboard", label: "System Overview" }]}
      .activePage=${"overview"}
    ></control-shell>
  `);

  expect(el.shadowRoot?.querySelector(".cp-shell")).toBeTruthy();
  expect(el.shadowRoot?.querySelector(".cp-sidebar")).toBeTruthy();
  expect(el.shadowRoot?.querySelector(".cp-topbar")).toBeTruthy();
  expect(el.shadowRoot?.querySelector(".cp-topbar__stats")).toBeTruthy();
});
```

- [ ] **Step 2: Run the shell test to verify it fails**

Run: `pnpm --dir ui test src/ui/rewrite/control-shell.browser.test.ts`

Expected: FAIL with missing module or missing `.cp-shell` structure.

- [ ] **Step 3: Implement the shell and primitive components**

```ts
// ui/src/ui/rewrite/shell/control-shell.ts
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("control-shell")
export class ControlShell extends LitElement {
  @property({ attribute: false }) pages = [];
  @property() activePage = "overview";
  @property() locale: "en" | "zh-CN" = "en";

  render() {
    return html`
      <div class="cp-shell">
        <control-sidebar
          class="cp-sidebar"
          .pages=${this.pages}
          .activePage=${this.activePage}
        ></control-sidebar>
        <div class="cp-shell__main">
          <control-topbar class="cp-topbar" .locale=${this.locale}></control-topbar>
          <section class="cp-shell__body">
            <slot></slot>
          </section>
        </div>
      </div>
    `;
  }
}
```

- [ ] **Step 4: Run shell tests and UI build**

Run: `pnpm --dir ui test src/ui/rewrite/control-shell.browser.test.ts && pnpm ui:build`

Expected: PASS for the new shell test and a successful UI build into `dist/control-ui`.

- [ ] **Step 5: Commit**

```bash
scripts/committer "UI: add Stitch control shell primitives" \
  ui/src/ui/rewrite/shell/control-shell.ts \
  ui/src/ui/rewrite/shell/control-topbar.ts \
  ui/src/ui/rewrite/shell/control-sidebar.ts \
  ui/src/ui/rewrite/primitives/control-card.ts \
  ui/src/ui/rewrite/primitives/control-metric-tile.ts \
  ui/src/ui/rewrite/primitives/control-tab-strip.ts \
  ui/src/ui/rewrite/primitives/control-split-panel.ts \
  ui/src/ui/rewrite/primitives/control-list-row.ts \
  ui/src/styles/rewrite/tokens.css \
  ui/src/styles/rewrite/shell.css \
  ui/src/styles/rewrite/primitives.css \
  ui/src/styles/rewrite.css \
  ui/src/ui/rewrite/control-shell.browser.test.ts
```

## Task 2: Split Screen Copy From Templates And Enforce Runtime i18n

**Files:**

- Create: `ui/src/ui/rewrite/screen-copy.ts`
- Modify: `ui/src/ui/rewrite/routes.ts`
- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/i18n/locales/en.ts`
- Modify: `ui/src/i18n/locales/zh-CN.ts`
- Test: `ui/src/ui/rewrite/i18n.browser.test.ts`
- Test: `ui/src/ui/rewrite/routes.test.ts`

- [ ] **Step 1: Write the failing locale separation tests**

```ts
import { expect, test } from "vitest";
import { controlPagesForLocale } from "./routes.ts";

test("returns English-only shell labels for en", () => {
  const overview = controlPagesForLocale("en").find((page) => page.id === "overview");
  expect(overview?.label).toBe("System Overview");
});

test("returns Chinese-only shell labels for zh-CN", () => {
  const overview = controlPagesForLocale("zh-CN").find((page) => page.id === "overview");
  expect(overview?.label).toBe("系统概览");
});
```

- [ ] **Step 2: Run the locale tests to verify they fail**

Run: `pnpm --dir ui test src/ui/rewrite/routes.test.ts src/ui/rewrite/i18n.browser.test.ts`

Expected: FAIL because route labels are still bilingual and shell copy is embedded in templates.

- [ ] **Step 3: Move screen copy into locale-aware resources**

```ts
// ui/src/ui/rewrite/screen-copy.ts
export const SCREEN_COPY = {
  en: {
    overview: { label: "System Overview", eyebrow: "OPERATIONS DASHBOARD" },
    channels: { label: "Channels", eyebrow: "CHANNELS MANAGEMENT CONSOLE" },
  },
  "zh-CN": {
    overview: { label: "系统概览", eyebrow: "操作总览" },
    channels: { label: "渠道管理", eyebrow: "渠道管理台" },
  },
} as const;
```

- [ ] **Step 4: Re-run route and locale tests**

Run: `pnpm --dir ui test src/ui/rewrite/routes.test.ts src/ui/rewrite/i18n.browser.test.ts ui/src/i18n/test/translate.test.ts`

Expected: PASS with no mixed bilingual labels in route metadata.

- [ ] **Step 5: Commit**

```bash
scripts/committer "UI: separate Control UI locale resources" \
  ui/src/ui/rewrite/screen-copy.ts \
  ui/src/ui/rewrite/routes.ts \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/i18n/locales/en.ts \
  ui/src/i18n/locales/zh-CN.ts \
  ui/src/ui/rewrite/i18n.browser.test.ts \
  ui/src/ui/rewrite/routes.test.ts
```

## Task 3: Add Page-Oriented Control UI Contracts And Controller View Models

**Files:**

- Create: `src/gateway/protocol/schema/control-ui-overview.ts`
- Create: `src/gateway/protocol/schema/control-ui-workflows.ts`
- Create: `src/gateway/protocol/schema/control-ui-agents.ts`
- Create: `src/gateway/protocol/schema/control-ui-runtime.ts`
- Modify: `src/gateway/protocol/control-ui-methods.ts`
- Modify: `src/gateway/protocol/control-ui-methods.test.ts`
- Modify: `src/gateway/protocol/schema/channels.ts`
- Modify: `src/gateway/protocol/schema/memory.ts`
- Modify: `src/gateway/protocol/schema/sessions.ts`
- Modify: `src/gateway/protocol/schema/usage.ts`
- Modify: `ui/src/ui/controllers/channels.ts`
- Modify: `ui/src/ui/controllers/channel-config.ts`
- Modify: `ui/src/ui/controllers/channel-setup.ts`
- Modify: `ui/src/ui/controllers/sessions.ts`
- Modify: `ui/src/ui/controllers/workflows.ts`
- Modify: `ui/src/ui/controllers/agents.ts`
- Modify: `ui/src/ui/controllers/memory.ts`
- Modify: `ui/src/ui/controllers/agent-runtime.ts`
- Modify: `ui/src/ui/controllers/usage.ts`
- Modify: `ui/src/ui/controllers/config.ts`
- Modify: `ui/src/ui/controllers/debug.ts`
- Test: `src/gateway/protocol/control-ui-methods.test.ts`
- Test: `ui/src/ui/controllers/channels.test.ts`
- Test: `ui/src/ui/controllers/sessions.test.ts`

- [ ] **Step 1: Write failing contract tests for page-level summaries**

```ts
import { expect, test } from "vitest";
import { hasControlUiMethodDefinition } from "./control-ui-methods.js";

test("registers overview.summary for Stitch shell hydration", () => {
  expect(hasControlUiMethodDefinition("overview.summary")).toBe(true);
});

test("registers channels.catalog and channels.editor surfaces", () => {
  expect(hasControlUiMethodDefinition("channels.catalog")).toBe(true);
  expect(hasControlUiMethodDefinition("channels.editor.get")).toBe(true);
});
```

- [ ] **Step 2: Run the contract tests to verify they fail**

Run: `pnpm test -- src/gateway/protocol/control-ui-methods.test.ts -t "registers overview.summary|registers channels.catalog"`

Expected: FAIL with missing method definitions.

- [ ] **Step 3: Add page-oriented methods and adapt controllers**

```ts
// src/gateway/protocol/control-ui-methods.ts
"overview.summary": defineControlUiMethod({
  method: "overview.summary",
  capability: "controlUi.overview",
  paramsSchema: OverviewSummaryParamsSchema,
  resultSchema: OverviewSummaryResultSchema,
});

"channels.catalog": defineControlUiMethod({
  method: "channels.catalog",
  capability: "controlUi.channels",
  paramsSchema: ChannelCatalogParamsSchema,
  resultSchema: ChannelCatalogResultSchema,
});
```

```ts
// ui/src/ui/controllers/channels.ts
export async function loadChannelsSurface(client: GatewayBrowserClient) {
  const [status, catalog] = await Promise.all([
    client.call("channels.status", {}),
    client.call("channels.catalog", {}),
  ]);
  return { status, catalog };
}
```

- [ ] **Step 4: Run protocol and controller tests**

Run: `pnpm test -- src/gateway/protocol/control-ui-methods.test.ts ui/src/ui/controllers/channels.test.ts ui/src/ui/controllers/sessions.test.ts`

Expected: PASS with new summary/catalog/editor contract coverage.

- [ ] **Step 5: Commit**

```bash
scripts/committer "Gateway: add Stitch page-oriented control UI contracts" \
  src/gateway/protocol/schema/control-ui-overview.ts \
  src/gateway/protocol/schema/control-ui-workflows.ts \
  src/gateway/protocol/schema/control-ui-agents.ts \
  src/gateway/protocol/schema/control-ui-runtime.ts \
  src/gateway/protocol/control-ui-methods.ts \
  src/gateway/protocol/control-ui-methods.test.ts \
  src/gateway/protocol/schema/channels.ts \
  src/gateway/protocol/schema/memory.ts \
  src/gateway/protocol/schema/sessions.ts \
  src/gateway/protocol/schema/usage.ts \
  ui/src/ui/controllers/channels.ts \
  ui/src/ui/controllers/channel-config.ts \
  ui/src/ui/controllers/channel-setup.ts \
  ui/src/ui/controllers/sessions.ts \
  ui/src/ui/controllers/workflows.ts \
  ui/src/ui/controllers/agents.ts \
  ui/src/ui/controllers/memory.ts \
  ui/src/ui/controllers/agent-runtime.ts \
  ui/src/ui/controllers/usage.ts \
  ui/src/ui/controllers/config.ts \
  ui/src/ui/controllers/debug.ts \
  ui/src/ui/controllers/channels.test.ts \
  ui/src/ui/controllers/sessions.test.ts
```

## Task 4: Rebuild Overview, Sessions, And Channels Against Stitch

**Files:**

- Create: `ui/src/ui/rewrite/screens/overview-screen.ts`
- Create: `ui/src/ui/rewrite/screens/sessions-screen.ts`
- Create: `ui/src/ui/rewrite/screens/channels-screen.ts`
- Create: `ui/src/ui/rewrite/screens/screen-types.ts`
- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/styles/rewrite/screens.css`
- Test: `ui/src/ui/rewrite/channels-subflows.browser.test.ts`
- Test: `ui/src/ui/views/overview.browser.test.ts`
- Test: `ui/src/ui/views/sessions.test.ts`
- Test: `ui/src/ui/views/channels.browser.test.ts`

- [ ] **Step 1: Write failing browser tests for channels subflows and page landmarks**

```ts
import { fixture, html } from "@open-wc/testing";
import { expect, test } from "vitest";
import "./channels-screen.ts";

test("renders management, catalog, and feishu editor as explicit channels subflows", async () => {
  const el = await fixture<any>(html`<channels-screen .mode=${"catalog"}></channels-screen>`);
  expect(el.shadowRoot?.querySelector('[data-flow="catalog"]')).toBeTruthy();
  expect(el.shadowRoot?.querySelector(".cp-channel-catalog")).toBeTruthy();
});
```

- [ ] **Step 2: Run the page tests to verify they fail**

Run: `pnpm --dir ui test src/ui/rewrite/channels-subflows.browser.test.ts src/ui/views/overview.browser.test.ts src/ui/views/channels.browser.test.ts`

Expected: FAIL with missing screen modules or incorrect landmarks.

- [ ] **Step 3: Implement the first three Stitch screens**

```ts
// ui/src/ui/rewrite/screens/channels-screen.ts
render() {
  return html`
    <section class="cp-screen cp-screen--channels">
      <div class="cp-stage cp-stage--three-column">
        <aside class="cp-stage__rail">${this.renderManagementRail()}</aside>
        <div class="cp-stage__main">${this.renderActiveFlow()}</div>
        <aside class="cp-stage__detail">${this.renderDetailPanel()}</aside>
      </div>
    </section>
  `;
}
```

- [ ] **Step 4: Run page tests and a UI build**

Run: `pnpm --dir ui test src/ui/rewrite/channels-subflows.browser.test.ts src/ui/views/overview.browser.test.ts src/ui/views/sessions.test.ts src/ui/views/channels.browser.test.ts && pnpm ui:build`

Expected: PASS with the rebuilt shell rendering the three Stitch-first screens.

- [ ] **Step 5: Commit**

```bash
scripts/committer "UI: rebuild overview sessions and channels screens" \
  ui/src/ui/rewrite/screens/overview-screen.ts \
  ui/src/ui/rewrite/screens/sessions-screen.ts \
  ui/src/ui/rewrite/screens/channels-screen.ts \
  ui/src/ui/rewrite/screens/screen-types.ts \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/styles/rewrite/screens.css \
  ui/src/ui/rewrite/channels-subflows.browser.test.ts \
  ui/src/ui/views/overview.browser.test.ts \
  ui/src/ui/views/sessions.test.ts \
  ui/src/ui/views/channels.browser.test.ts
```

## Task 5: Rebuild Workflows, Agents, Memory, And Runtime Screens

**Files:**

- Create: `ui/src/ui/rewrite/screens/workflows-screen.ts`
- Create: `ui/src/ui/rewrite/screens/agents-screen.ts`
- Create: `ui/src/ui/rewrite/screens/memory-screen.ts`
- Create: `ui/src/ui/rewrite/screens/runtime-screen.ts`
- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/styles/rewrite/screens.css`
- Test: `ui/src/ui/controllers/workflows.test.ts`
- Test: `ui/src/ui/controllers/agents.test.ts`
- Test: `ui/src/ui/controllers/memory.test.ts`

- [ ] **Step 1: Write failing tests for the mid-product screen set**

```ts
import { expect, test } from "vitest";
import { render } from "@testing-library/lit";
import "./workflows-screen.ts";

test("renders Stitch workflow registry rail, execution center, and right summary panel", async () => {
  const view = await render(`<workflows-screen></workflows-screen>`);
  expect(view.container.querySelector(".cp-stage--three-column")).toBeTruthy();
  expect(view.container.querySelector(".cp-workflows__registry")).toBeTruthy();
});
```

- [ ] **Step 2: Run the screen and controller tests to verify they fail**

Run: `pnpm --dir ui test src/ui/controllers/workflows.test.ts src/ui/controllers/agents.test.ts src/ui/controllers/memory.test.ts`

Expected: FAIL because the current view model and screen structure do not match the new Stitch layout.

- [ ] **Step 3: Implement the four screen components and wire them through app-root**

```ts
// ui/src/ui/rewrite/app-root.ts
private renderCurrentScreen() {
  switch (this.activePage) {
    case "workflows":
      return html`<workflows-screen .state=${this.workflowsState}></workflows-screen>`;
    case "agents":
      return html`<agents-screen .state=${this.agentsState}></agents-screen>`;
    case "memory":
      return html`<memory-screen .state=${this.memoryState}></memory-screen>`;
    case "runtime":
      return html`<runtime-screen .state=${this.runtimeState}></runtime-screen>`;
  }
}
```

- [ ] **Step 4: Run tests and build**

Run: `pnpm --dir ui test src/ui/controllers/workflows.test.ts src/ui/controllers/agents.test.ts src/ui/controllers/memory.test.ts && pnpm ui:build`

Expected: PASS for the rebuilt screen/controller set and a successful production bundle.

- [ ] **Step 5: Commit**

```bash
scripts/committer "UI: rebuild workflows agents memory and runtime screens" \
  ui/src/ui/rewrite/screens/workflows-screen.ts \
  ui/src/ui/rewrite/screens/agents-screen.ts \
  ui/src/ui/rewrite/screens/memory-screen.ts \
  ui/src/ui/rewrite/screens/runtime-screen.ts \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/styles/rewrite/screens.css \
  ui/src/ui/controllers/workflows.test.ts \
  ui/src/ui/controllers/agents.test.ts \
  ui/src/ui/controllers/memory.test.ts
```

## Task 6: Rebuild Usage, Config, And Debug Screens And Finish Route Wiring

**Files:**

- Create: `ui/src/ui/rewrite/screens/usage-screen.ts`
- Create: `ui/src/ui/rewrite/screens/config-screen.ts`
- Create: `ui/src/ui/rewrite/screens/debug-screen.ts`
- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/ui/rewrite/routes.ts`
- Modify: `ui/src/ui/rewrite/routes.test.ts`
- Modify: `ui/src/styles/rewrite/screens.css`
- Test: `ui/src/ui/views/usage.view.test.ts`
- Test: `ui/src/ui/views/config.browser.test.ts`
- Test: `ui/src/ui/views/debug.view.test.ts`

- [ ] **Step 1: Write failing tests for the final top-level screens**

```ts
import { expect, test } from "vitest";
import { metaForPage } from "./routes.ts";

test("uses single-language labels for final routes", () => {
  expect(metaForPage("config", "en").label).toBe("Config");
  expect(metaForPage("config", "zh-CN").label).toBe("审批与配置");
});
```

- [ ] **Step 2: Run the route and view tests to verify they fail**

Run: `pnpm --dir ui test src/ui/rewrite/routes.test.ts src/ui/views/usage.view.test.ts src/ui/views/config.browser.test.ts src/ui/views/debug.view.test.ts`

Expected: FAIL because the routes and views still reflect mixed-language legacy structure.

- [ ] **Step 3: Implement the last three screen components and route metadata**

```ts
// ui/src/ui/rewrite/routes.ts
export function metaForPage(page: ControlPage, locale: SupportedShellLocale) {
  return {
    id: page,
    icon: CONTROL_PAGE_ICONS[page],
    ...SCREEN_COPY[locale][page],
  };
}
```

- [ ] **Step 4: Run tests and the full UI build**

Run: `pnpm --dir ui test src/ui/rewrite/routes.test.ts src/ui/views/usage.view.test.ts src/ui/views/config.browser.test.ts src/ui/views/debug.view.test.ts && pnpm ui:build`

Expected: PASS with all top-level Stitch screens wired through the new route metadata.

- [ ] **Step 5: Commit**

```bash
scripts/committer "UI: rebuild usage config and debug screens" \
  ui/src/ui/rewrite/screens/usage-screen.ts \
  ui/src/ui/rewrite/screens/config-screen.ts \
  ui/src/ui/rewrite/screens/debug-screen.ts \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/ui/rewrite/routes.ts \
  ui/src/ui/rewrite/routes.test.ts \
  ui/src/styles/rewrite/screens.css \
  ui/src/ui/views/usage.view.test.ts \
  ui/src/ui/views/config.browser.test.ts \
  ui/src/ui/views/debug.view.test.ts
```

## Task 7: Delete Legacy Control UI Paths And Dead Assets

**Files:**

- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/styles/rewrite.css`
- Delete or stop importing legacy view helpers no longer referenced from `app-root.ts`
- Delete or stop importing obsolete CSS blocks replaced by `tokens.css`, `shell.css`, `primitives.css`, and `screens.css`
- Test: `pnpm --dir ui build`

- [ ] **Step 1: Write a failing dead-code guard test**

```ts
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

test("app-root no longer renders legacy cp-page inline templates", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("renderOverviewPage(")).toBe(false);
  expect(source.includes("renderChannelsPage(")).toBe(false);
});
```

- [ ] **Step 2: Run the dead-code guard test to verify it fails**

Run: `pnpm --dir ui test src/ui/rewrite/legacy-cleanup.node.test.ts`

Expected: FAIL because the monolithic page render paths still exist.

- [ ] **Step 3: Remove legacy inline screen renderers and dead imports**

```ts
// ui/src/ui/rewrite/app-root.ts
private renderCurrentScreen() {
  return html`
    <control-shell .pages=${this.pages} .activePage=${this.activePage} .locale=${this.locale}>
      ${this.renderScreenByRoute()}
    </control-shell>
  `;
}
```

- [ ] **Step 4: Run cleanup verification and full repo build**

Run: `pnpm --dir ui test src/ui/rewrite/legacy-cleanup.node.test.ts && pnpm ui:build && pnpm build`

Expected: PASS with no references to deleted inline UI paths.

- [ ] **Step 5: Commit**

```bash
scripts/committer "UI: remove legacy Control UI implementation" \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/styles/rewrite.css \
  ui/src/ui/rewrite/legacy-cleanup.node.test.ts
```

## Task 8: Update Docs, Baseline Notes, And Translation Artifacts

**Files:**

- Modify: `docs/web/control-ui.md`
- Modify: `docs/web/control-ui-ux.md`
- Modify: `docs/concepts/architecture.md`
- Modify: `docs/.i18n/glossary.zh-CN.json`
- Modify: `docs/zh-CN/concepts/project-control-ui-stitch-1to1-pr-plan.md`
- Modify: `docs/zh-CN/concepts/project-control-ui-stitch-baseline.md`

- [ ] **Step 1: Write a failing docs checklist in the plan notes**

```md
- [ ] `docs/web/control-ui.md` describes the Stitch-first shell and nested Channels subflows.
- [ ] `docs/web/control-ui-ux.md` no longer describes the old simplified IA as the implementation target.
- [ ] Translation glossary contains any new Control UI canonical labels.
```

- [ ] **Step 2: Run the docs drift and glossary checks**

Run: `pnpm docs:check-i18n-glossary`

Expected: either PASS or FAIL with missing glossary terms for new Control UI labels.

- [ ] **Step 3: Update docs and regenerate translated pages as needed**

```bash
pnpm docs:check-i18n-glossary
node scripts/docs-i18n
```

```md
<!-- docs/web/control-ui.md -->

- The browser UI now follows the Stitch canonical shell and page layouts.
- `Channel Catalog` and `Feishu Channel Editor` are nested Channels flows.
- English and Simplified Chinese are runtime language variants, not mixed labels.
```

- [ ] **Step 4: Re-run docs checks**

Run: `pnpm docs:check-i18n-glossary`

Expected: PASS with updated glossary coverage.

- [ ] **Step 5: Commit**

```bash
scripts/committer "Docs: update Control UI rebuild guidance" \
  docs/web/control-ui.md \
  docs/web/control-ui-ux.md \
  docs/concepts/architecture.md \
  docs/.i18n/glossary.zh-CN.json \
  docs/zh-CN/concepts/project-control-ui-stitch-1to1-pr-plan.md \
  docs/zh-CN/concepts/project-control-ui-stitch-baseline.md
```

## Task 9: Run Parity Verification And Final Landing Gate

**Files:**

- Verify: `ui/src/ui/rewrite/*.ts`
- Verify: `src/gateway/protocol/*.ts`
- Verify: `docs/web/control-ui.md`

- [ ] **Step 1: Run focused Control UI tests**

Run:

```bash
pnpm --dir ui test src/ui/rewrite/routes.test.ts
pnpm --dir ui test src/ui/rewrite/control-shell.browser.test.ts
pnpm --dir ui test src/ui/rewrite/channels-subflows.browser.test.ts
pnpm --dir ui test src/ui/rewrite/i18n.browser.test.ts
pnpm test -- src/gateway/protocol/control-ui-methods.test.ts
```

Expected: all targeted tests PASS.

- [ ] **Step 2: Run the build gate**

Run:

```bash
pnpm ui:build
pnpm build
```

Expected: both builds PASS.

- [ ] **Step 3: Run the local dev gate**

Run:

```bash
pnpm check
pnpm test
```

Expected: PASS, or if unrelated pre-existing failures exist on latest `main`, document them explicitly before landing.

- [ ] **Step 4: Capture parity evidence**

```md
- Save per-page screenshot evidence for `overview`, `sessions`, `channels`, `workflows`, `agents`, `memory`, `runtime`, `usage`, `config`, and `debug`.
- Record any approved divergence in the Stitch baseline notes before merge.
```

- [ ] **Step 5: Commit final parity/doc cleanup if needed**

```bash
scripts/committer "UI: finalize Stitch parity verification" \
  ui/src/ui/rewrite/routes.test.ts \
  ui/src/ui/rewrite/control-shell.browser.test.ts \
  ui/src/ui/rewrite/channels-subflows.browser.test.ts \
  ui/src/ui/rewrite/i18n.browser.test.ts \
  src/gateway/protocol/control-ui-methods.test.ts \
  docs/web/control-ui.md
```

## Self-Review

- Spec coverage:
  - Stitch-first shell and primitive layer: Tasks 1, 4, 5, 6
  - Runtime language switching and no mixed labels: Task 2
  - Backend contract allowed to move: Task 3
  - Channels nested subflows: Task 4
  - Legacy code removal: Task 7
  - Docs update and translation follow-through: Task 8
  - Parity validation and landing gates: Task 9
- Placeholder scan:
  - all tasks name concrete files, commands, and expected outcomes
  - no `TODO`/`TBD` placeholders remain
- Type consistency:
  - new shell/screen naming stays under `ui/src/ui/rewrite/*`
  - new contract naming uses page-oriented `*.summary`, `channels.catalog`, and `channels.editor.*` surfaces consistently
