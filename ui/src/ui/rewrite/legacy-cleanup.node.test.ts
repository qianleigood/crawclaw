import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("app-root no longer renders legacy cp-page inline templates", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes('<section class="cp-page cp-page--')).toBe(false);
  expect(source.includes("private renderOverviewPage(")).toBe(false);
  expect(source.includes("private renderChannelsPage(")).toBe(false);
});

test("app-root no longer renders duplicate sessions signal cards", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("cp-session-signal-strip")).toBe(false);
});

test("app-root no longer renders sessions header stat cards", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes('renderPageHeader("sessions", [])')).toBe(true);
});

test("rewrite routes no longer expose overview as a primary section", () => {
  const source = readFileSync("src/ui/rewrite/routes.ts", "utf8");
  expect(source.includes('const CONTROL_PAGE_IDS = [\n  "overview",')).toBe(false);
  expect(source.includes('"/": "overview"')).toBe(false);
  expect(source.includes('"/": "sessions"')).toBe(true);
  expect(source.includes('"/overview": "sessions"')).toBe(true);
});

test("sessions rail stretches to the bottom of the layout", () => {
  const source = readFileSync("src/styles/rewrite.css", "utf8");
  expect(source.includes(".cp-session-console__rail {\n  align-self: stretch;")).toBe(true);
  expect(
    source.includes(
      ".cp-screen--sessions .cp-session-console__rail > .cp-panel--fill {\n  flex: 1;",
    ),
  ).toBe(true);
});

test("sessions thread panel no longer uses 100 percent fill height", () => {
  const source = readFileSync("src/styles/rewrite.css", "utf8");
  expect(
    source.includes(
      ".cp-screen--sessions .cp-session-console__main > .cp-panel--fill {\n  flex: 1;\n  min-height: 0;",
    ),
  ).toBe(true);
});

test("channels management no longer renders a duplicate right-side rail", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("cp-channel-management-side")).toBe(false);
});

test("channels management no longer renders a duplicate selected-channel toolbar", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("cp-channel-toolbar")).toBe(false);
});

test("channels management no longer renders frontend-invented health and delivery metrics", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  const css = readFileSync("src/styles/rewrite.css", "utf8");
  expect(source.includes("resolveChannelHealth")).toBe(false);
  expect(source.includes("resolveChannelDelivery")).toBe(false);
  expect(source.includes('uiLiteral("最后检查")')).toBe(true);
  expect(css.includes(".cp-channel-table__metric")).toBe(false);
  expect(css.includes(".cp-channel-health")).toBe(false);
});

test("channels management table exposes a dedicated edit action per row", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("${copy.common.actions}")).toBe(true);
  expect(source.includes("cp-channel-table__actions")).toBe(true);
  expect(source.includes("event.stopPropagation();")).toBe(true);
  expect(source.includes("${copy.channels.openSettings}")).toBe(true);
});

test("channels management no longer renders a duplicate section header", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("cp-channel-management-header")).toBe(false);
});

test("channels settings no longer renders a duplicate current-channel nav block", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("cp-channel-settings-page__nav")).toBe(false);
});

test("channels settings no longer renders the obsolete utility side rail", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("cp-panel--subtle")).toBe(false);
});

test("channels settings editor uses overview/accounts/settings/advanced tabs", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source).toContain("channelsTabOverview");
  expect(source).toContain("channelsTabAccounts");
  expect(source).toContain("channelsTabSettings");
  expect(source).toContain("channelsTabAdvanced");
  expect(source).toContain("cp-channel-editor-tabs");
});

test("channels settings editor renders a shared submit status strip", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source).toContain("cp-channel-editor-status");
  expect(source).toContain("submitState.title");
  expect(source).not.toContain("cp-channel-settings-overview");
  expect(source).not.toContain("cp-channel-settings-summary");
});

test("channels editor exposes one shared status strip and tab shell", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source).toContain("cp-channel-editor-status");
  expect(source).toContain("cp-channel-editor-tabs");
  expect(source).not.toContain("cp-channel-settings-submit__actions");
});

test("channels settings editor no longer mixes account manager into the settings form shell", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source).toContain("cp-channel-editor-accounts");
  expect(source).toContain("cp-channel-editor-settings");
  expect(source).not.toContain("cp-channel-settings-layout__side");
});

test("channels workspace uses a single three-state flow", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes('type ChannelWorkspaceMode = "guide" | "settings" | "add";')).toBe(true);
  expect(source.includes('"setup" | "connect" | "accounts"')).toBe(false);
  expect(source.includes("channelsWorkspaceReturnMode")).toBe(false);
});

test("channels catalog does not route unsupported entries into management selection", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(
    source.includes(
      "const selectedManagementChannelId = channelIds.includes(this.channelsSelectedChannelId)",
    ),
  ).toBe(true);
  expect(source.includes("this.selectChannel(channelId);\n    };")).toBe(false);
});

test("channels settings preserves catalog-only channel selection", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(
    source.includes(
      "const selectedEditorChannelId = catalogChannelIds.includes(this.channelsSelectedChannelId)",
    ),
  ).toBe(true);
  expect(
    source.includes(
      'const selectedChannelId =\n      activeMode === "settings" ? selectedEditorChannelId : selectedManagementChannelId;',
    ),
  ).toBe(true);
});

test("channels management does not auto-select the first channel", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes('const resolvedFallbackChannelId = "";')).toBe(true);
  expect(source.includes('(channelIds[0] ?? "")')).toBe(false);
});

test("channels settings copy no longer references a removed right-side rail", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(
    source.includes(
      "Keep the left side for form fields and the right side for actions and reference details.",
    ),
  ).toBe(false);
  expect(source.includes("左边填表，右边看动作和参考。")).toBe(false);
});

test("channels catalog no longer repeats already-enabled channels", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("const availableCatalogChannelIds = addChannelIds.filter")).toBe(true);
  expect(source.includes("<h4>${copy.channels.configuredCatalogTitle}</h4>")).toBe(false);
});

test("channels screen uses direct property rendering instead of legacy child slots", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes('<div slot="header">${this.renderPageHeader("channels", [])}</div>')).toBe(
    false,
  );
  expect(
    source.includes(
      '.header=${activeMode === "settings" ? nothing : this.renderPageHeader("channels", [])}',
    ),
  ).toBe(true);
  expect(
    source.includes('.management=${activeMode === "guide" ? renderManagementPage() : nothing}'),
  ).toBe(true);
});

test("channels account creation is consolidated into settings", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("${copy.channels.addAnotherAccount}")).toBe(false);
  expect(source.includes("${copy.channels.addAccountDraft}")).toBe(true);
  expect(source.includes("private async makeChannelAccountDefault(")).toBe(false);
});

test("channels settings includes a dedicated account manager section", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("cp-channel-editor-accounts")).toBe(true);
  expect(source.includes("${copy.channels.defaultAccount}")).toBe(true);
  expect(source.includes("copy.channels.accountManagerTitle")).toBe(true);
  expect(source.includes("copy.channels.accountManagerHint")).toBe(true);
});

test("channels settings exposes a dedicated submit status area and reset action", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("cp-channel-editor-submit")).toBe(true);
  expect(source.includes("resetChannelConfigForm(this.channelConfigState)")).toBe(true);
});

test("channels settings overview keeps a resolved detail label", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("const selectedChannelDetail = selectedChannelId")).toBe(true);
  expect(source.includes("params.selectedChannelDetail")).toBe(true);
});

test("channels settings form hides raw accounts fields when account manager is shown", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes("pruneChannelSettingsEditorSchema")).toBe(true);
  expect(source.includes("pruneChannelSettingsEditorValue")).toBe(true);
});

test("old settings layout selectors are no longer the current implementation primitives", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  const css = readFileSync("src/styles/rewrite.css", "utf8");
  expect(source.includes("cp-channel-settings-overview")).toBe(false);
  expect(source.includes("cp-channel-settings-summary")).toBe(false);
  expect(source.includes("cp-channel-settings-layout")).toBe(false);
  expect(source.includes("cp-channel-settings-layout__main")).toBe(false);
  expect(source.includes("cp-channel-settings-layout__side")).toBe(false);
  expect(source.includes("cp-channel-settings-submit__actions")).toBe(false);
  expect(source.includes("cp-channel-settings-accounts")).toBe(false);
  expect(css.includes(".cp-channel-settings-overview")).toBe(false);
  expect(css.includes(".cp-channel-settings-summary")).toBe(false);
  expect(css.includes(".cp-channel-settings-layout")).toBe(false);
  expect(css.includes(".cp-channel-settings-layout__main")).toBe(false);
  expect(css.includes(".cp-channel-settings-layout__side")).toBe(false);
  expect(css.includes(".cp-channel-settings-submit__actions")).toBe(false);
  expect(css.includes(".cp-channel-settings-accounts")).toBe(false);
});
