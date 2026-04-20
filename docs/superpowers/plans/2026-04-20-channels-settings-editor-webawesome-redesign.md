# 渠道设置编辑器 Web Awesome 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `Channels` 的设置 / 账号编辑子流重构为基于 `Web Awesome` 的多账号编辑器，正确支持每个账号独立的凭据编辑，并显著提升 tabs 与表单控件的视觉质量。

**Architecture:** 保持现有 `channels` 路由、`channelId` 上下文和后端协议不变，重做编辑器内容区。前端会在 `Accounts` tab 内新增“账号导航 + 当前账号编辑器”模型，并把 `Settings` 收缩为真正的渠道级配置面。`Web Awesome` 只在这一条子流局部引入，不要求整个 Control UI 一次迁移。

**Tech Stack:** Lit、TypeScript、Web Awesome、现有 Control UI rewrite surface、Vitest、现有 channel config controller 与 schema form 渲染器。

---

## 文件结构

### 需要修改的现有文件

- `ui/package.json`
  - 增加 `Web Awesome` 依赖。
- `ui/src/ui/rewrite/app-root.ts`
  - 当前 `channels` 编辑器主渲染入口。
  - 会被改为基于 `Web Awesome` 的 tab shell、账号导航、账号编辑器、渠道设置编辑器和高级设置面。
- `ui/src/ui/controllers/channel-config.ts`
  - 当前配置加载、dirty tracking、save/apply/reset 的核心状态。
  - 会增加“当前选中账号”“账号字段映射”“账号编辑草稿合并”相关状态和 helper。
- `ui/src/styles/rewrite.css`
  - 当前 `channels` 编辑器样式。
  - 会删掉旧手写 tabs / buttons / account list 相关样式，并补局部主题覆盖。
- `ui/src/ui/rewrite/legacy-cleanup.node.test.ts`
  - 当前 source-level 回归测试。
  - 会补“旧 hand-rolled tabs/旧账号列表布局不再出现”的保护。
- `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`
  - 当前 browser-level 编辑器测试。
  - 会扩展为多账号编辑、切 tab、切默认账号、账号级字段不出现在 Settings 的回归。
- `ui/src/ui/controllers/channel-config.test.ts`
  - 增加 controller 层对多账号编辑状态的覆盖。

### 建议新增文件

- `ui/src/ui/rewrite/webawesome.ts`
  - 局部注册这次子流所需的 `Web Awesome` 组件，避免在 `app-root.ts` 中散落 import。
- `ui/src/ui/rewrite/channel-editor-account-mapping.ts`
  - 明确哪些 schema 字段属于账号级，哪些属于渠道级。
  - 负责把 raw schema 分拆成 `Accounts` 和 `Settings` 两套编辑输入。
- `ui/src/ui/rewrite/channel-editor-field-adapters.ts`
  - 把现有 schema form 字段包装成 `Web Awesome` 风格控件。

### 尽量不要做的事

- 不要在这次任务里把整个 `config form` 系统一次性重写。
- 不要把整个 Control UI 全量迁到 `Web Awesome`。
- 不要为了 UI 重做而改后端协议，除非出现真实阻塞。

---

### Task 1: 引入 Web Awesome 并锁定新的编辑器基线

**Files:**

- Modify: `ui/package.json`
- Create: `ui/src/ui/rewrite/webawesome.ts`
- Modify: `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`
- Modify: `ui/src/ui/rewrite/legacy-cleanup.node.test.ts`

- [ ] **Step 1: 写失败测试，锁定新 tab shell 和组件库接入**

在 `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts` 中增加新断言，要求新的 tab shell 使用组件库容器而不是裸按钮：

```ts
it("renders a component-library tab shell for the channel editor", async () => {
  const el = createEditor();
  try {
    await customElements.whenDefined("crawclaw-app");
    el.openTestChannelEditor("demo-channel");
    await el.updateComplete;

    expect(el.renderRoot.querySelector("wa-tab-group")).toBeTruthy();
    expect(el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button")).toHaveLength(0);
  } finally {
    el.remove();
  }
});
```

在 `ui/src/ui/rewrite/legacy-cleanup.node.test.ts` 中补 source-level 保护：

```ts
test("channels editor no longer uses raw button tabs", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes('class="cp-channel-editor-tabs"')).toBe(false);
  expect(source.includes("wa-tab-group")).toBe(true);
});
```

- [ ] **Step 2: 跑测试，确认当前失败**

运行：

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts src/ui/rewrite/legacy-cleanup.node.test.ts
```

预期：

- `wa-tab-group` 相关断言失败
- 旧 `button` tab 断言失败

- [ ] **Step 3: 安装 Web Awesome 依赖**

修改 `ui/package.json`：

```json
{
  "dependencies": {
    "@awesome.me/webawesome": "^3.2.1",
    "@create-markdown/preview": "^2.0.0",
    "@noble/ed25519": "3.0.1",
    "dompurify": "^3.3.3",
    "lit": "^3.3.2",
    "marked": "^17.0.5"
  }
}
```

新增 `ui/src/ui/rewrite/webawesome.ts`：

```ts
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";

import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/select/select.js";
import "@awesome.me/webawesome/dist/components/textarea/textarea.js";
import "@awesome.me/webawesome/dist/components/switch/switch.js";
import "@awesome.me/webawesome/dist/components/radio/radio.js";
import "@awesome.me/webawesome/dist/components/radio-group/radio-group.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/tab/tab.js";
import "@awesome.me/webawesome/dist/components/tab-group/tab-group.js";
import "@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js";
```

- [ ] **Step 4: 在 rewrite surface 顶部引入 Web Awesome 注册文件**

在 `ui/src/ui/rewrite/app-root.ts` 顶部加入：

```ts
import "./webawesome.ts";
```

- [ ] **Step 5: 重新跑失败测试，确认依赖已接入但 UI 仍未完成**

运行：

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts -t "component-library tab shell"
```

预期：

- 组件已经注册
- 但 tab shell 结构仍未通过，说明还需要真正实现 UI

- [ ] **Step 6: 提交这一阶段**

```bash
scripts/committer "UI: add Web Awesome channel editor baseline" \
  ui/package.json \
  ui/src/ui/rewrite/webawesome.ts \
  ui/src/ui/rewrite/channels-settings-editor.browser.test.ts \
  ui/src/ui/rewrite/legacy-cleanup.node.test.ts \
  ui/src/ui/rewrite/app-root.ts
```

---

### Task 2: 用 Web Awesome 重做 tabs 和共享状态区

**Files:**

- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/styles/rewrite.css`
- Modify: `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 tab 行为**

在 `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts` 中增加：

```ts
it("switches tabs through Web Awesome tab controls", async () => {
  const el = createEditor();
  try {
    await customElements.whenDefined("crawclaw-app");
    el.openTestChannelEditor("demo-channel");
    await el.updateComplete;

    const accountsTab = el.renderRoot.querySelector(
      'wa-tab[panel="accounts"]',
    ) as HTMLElement | null;
    expect(accountsTab).toBeTruthy();
  } finally {
    el.remove();
  }
});
```

- [ ] **Step 2: 把旧 `renderChannelEditorTabs()` 改成 `wa-tab-group`**

在 `ui/src/ui/rewrite/app-root.ts` 中，用下面的结构替换旧 tab 渲染：

```ts
private renderChannelEditorTabs(copy: ReturnType<typeof uiText>, activeTab: ChannelEditorTab) {
  const tabs: Array<{ id: ChannelEditorTab; label: string }> = [
    { id: "overview", label: copy.channels.channelsTabOverview },
    { id: "accounts", label: copy.channels.channelsTabAccounts },
    { id: "settings", label: copy.channels.channelsTabSettings },
    { id: "advanced", label: copy.channels.channelsTabAdvanced },
  ];

  return html`
    <wa-tab-group
      class="cp-channel-editor-tabs"
      placement="top"
      @wa-tab-show=${(event: CustomEvent<{ name?: string }>) => {
        const next = event.detail?.name;
        if (
          next === "overview" ||
          next === "accounts" ||
          next === "settings" ||
          next === "advanced"
        ) {
          this.setChannelEditorTab(next);
        }
      }}
    >
      ${tabs.map(
        (tab) => html`
          <wa-tab slot="nav" panel=${tab.id} ?active=${tab.id === activeTab}>${tab.label}</wa-tab>
        `,
      )}
    </wa-tab-group>
  `;
}
```

- [ ] **Step 3: 用 `wa-tab-panel` 包住各 tab 内容**

在 `renderChannels()` 的 editor 分支里，把原来手动条件切换的 tab 内容改为：

```ts
<wa-tab-panel name="overview" ?active=${this.channelEditorTab === "overview"}>
  ${this.renderChannelOverviewTab(copy, {...})}
</wa-tab-panel>
<wa-tab-panel name="accounts" ?active=${this.channelEditorTab === "accounts"}>
  ${this.renderChannelAccountsTab(copy, {...})}
</wa-tab-panel>
<wa-tab-panel name="settings" ?active=${this.channelEditorTab === "settings"}>
  ${this.renderChannelSettingsTab(copy, {...})}
</wa-tab-panel>
<wa-tab-panel name="advanced" ?active=${this.channelEditorTab === "advanced"}>
  ${this.renderChannelAdvancedTab(copy, {...})}
</wa-tab-panel>
```

- [ ] **Step 4: 重做 tab strip 和状态条样式**

在 `ui/src/styles/rewrite.css` 中，把旧 `button tabs` 样式替换为 `Web Awesome` 覆盖：

```css
.cp-channel-editor-tabs {
  --wa-tab-gap: 10px;
  --wa-tab-font-size: 0.95rem;
  --wa-color-brand-fill-quiet: rgba(89, 145, 255, 0.14);
  --wa-color-brand-border-quiet: rgba(89, 145, 255, 0.28);
  --wa-color-brand-on-quiet: var(--cp-text);
}

.cp-channel-editor-status {
  display: grid;
  gap: 18px;
}

.cp-channel-editor-tabs::part(base) {
  padding: 8px 0 2px;
}

.cp-channel-editor-tabs::part(nav) {
  gap: 8px;
}

.cp-channel-editor-tabs::part(active-tab-indicator) {
  height: 3px;
  border-radius: 999px;
}
```

- [ ] **Step 5: 跑相关测试和构建**

运行：

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts src/ui/rewrite/legacy-cleanup.node.test.ts
pnpm --dir ui build
```

预期：

- tests pass
- UI build pass

- [ ] **Step 6: 提交这一阶段**

```bash
scripts/committer "UI: replace channel editor tabs with Web Awesome" \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/styles/rewrite.css \
  ui/src/ui/rewrite/channels-settings-editor.browser.test.ts \
  ui/src/ui/rewrite/legacy-cleanup.node.test.ts
```

---

### Task 3: 重建 Accounts tab 为“账号导航 + 当前账号编辑器”

**Files:**

- Modify: `ui/src/ui/controllers/channel-config.ts`
- Create: `ui/src/ui/rewrite/channel-editor-account-mapping.ts`
- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/ui/controllers/channel-config.test.ts`
- Modify: `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`

- [ ] **Step 1: 先写 controller 失败测试，锁定多账号编辑状态**

在 `ui/src/ui/controllers/channel-config.test.ts` 中加入：

```ts
it("tracks the selected account inside the channel editor", () => {
  const state = makeChannelConfigState();
  state.selectedChannelId = "feishu";
  state.selectedAccountId = "ops";
  selectChannelEditorAccount(state, "qa");
  expect(state.selectedAccountId).toBe("qa");
});

it("keeps account draft changes isolated per account", () => {
  const state = makeChannelConfigState();
  state.accountDrafts = {
    ops: { appId: "ops-id" },
    qa: { appId: "qa-id" },
  };
  expect(state.accountDrafts.ops?.appId).toBe("ops-id");
  expect(state.accountDrafts.qa?.appId).toBe("qa-id");
});
```

- [ ] **Step 2: 增加账号编辑状态**

在 `ui/src/ui/controllers/channel-config.ts` 中给 `ChannelConfigState` 增加：

```ts
selectedAccountId?: string | null;
accountDrafts?: Record<string, Record<string, unknown>>;
accountFieldPaths?: string[];
```

并新增 helper：

```ts
export function selectChannelEditorAccount(state: ChannelConfigState, accountId: string) {
  state.selectedAccountId = accountId;
}
```

- [ ] **Step 3: 新增账号字段映射文件**

创建 `ui/src/ui/rewrite/channel-editor-account-mapping.ts`：

```ts
export const DEFAULT_ACCOUNT_FIELD_KEYS = [
  "appId",
  "appSecret",
  "encryptKey",
  "verificationToken",
  "token",
  "signingSecret",
  "clientId",
  "clientSecret",
] as const;

export function isAccountFieldPath(path: string): boolean {
  return (
    path === "accounts" ||
    path === "defaultAccount" ||
    path.startsWith("accounts.") ||
    DEFAULT_ACCOUNT_FIELD_KEYS.some((key) => path.endsWith(`.${key}`) || path === key)
  );
}
```

- [ ] **Step 4: 把 Accounts tab 改成双栏**

在 `ui/src/ui/rewrite/app-root.ts` 中，把 `renderChannelAccountsTab()` 从“只渲染列表”改为：

```ts
<section class="cp-channel-editor-accounts cp-subpanel">
  <div class="cp-channel-editor-accounts__layout">
    <aside class="cp-channel-editor-accounts__nav">
      <!-- 账号列表 -->
    </aside>
    <section class="cp-channel-editor-accounts__editor">
      <!-- 当前账号的表单 -->
    </section>
  </div>
</section>
```

账号列表中的每一项点击后：

```ts
@click=${() => selectChannelEditorAccount(this.channelConfigState, account.accountId)}
```

右侧编辑器只渲染当前选中账号的账号级字段。

- [ ] **Step 5: 为当前账号渲染账号级凭据字段**

在同一文件中增加局部 helper：

```ts
private renderSelectedAccountEditor(
  copy: ReturnType<typeof uiText>,
  params: {
    selectedChannelId: string;
    selectedAccountId: string | null;
    accountSchema: unknown;
    accountValue: Record<string, unknown> | null;
    busy: boolean;
  },
) {
  if (!params.selectedAccountId) {
    return html`<p class="cp-empty">${copy.channels.noChannelAccounts}</p>`;
  }
  return html`
    <section class="cp-channel-editor-account-form">
      <div class="cp-panel__head">
        <div>
          <span class="cp-kicker">${copy.channels.accountsTitle}</span>
          <h4>${params.selectedAccountId}</h4>
        </div>
      </div>
      ${renderConfigForm({
        schema: params.accountSchema,
        value: params.accountValue,
        disabled: params.busy,
        onPatch: (path, value) => {
          updateChannelAccountDraftValue(this.channelConfigState, params.selectedAccountId!, path, value);
          this.requestUpdate();
        },
      })}
    </section>
  `;
}
```

- [ ] **Step 6: 跑测试，确认多账号编辑器成立**

运行：

```bash
pnpm --dir ui test src/ui/controllers/channel-config.test.ts src/ui/rewrite/channels-settings-editor.browser.test.ts -t "account"
```

预期：

- controller tests pass
- browser tests pass

- [ ] **Step 7: 提交这一阶段**

```bash
scripts/committer "UI: add channel account navigator editor" \
  ui/src/ui/controllers/channel-config.ts \
  ui/src/ui/controllers/channel-config.test.ts \
  ui/src/ui/rewrite/channel-editor-account-mapping.ts \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/ui/rewrite/channels-settings-editor.browser.test.ts
```

---

### Task 4: 把账号字段从 Settings 中移除，并接入 Web Awesome 表单控件

**Files:**

- Create: `ui/src/ui/rewrite/channel-editor-field-adapters.ts`
- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/styles/rewrite.css`
- Modify: `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`
- Modify: `ui/src/ui/rewrite/legacy-cleanup.node.test.ts`

- [ ] **Step 1: 写失败测试，锁定账号字段不再出现在 Settings**

在 `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts` 中加入：

```ts
it("does not show account credential fields in Settings", async () => {
  const el = createEditor();
  try {
    await customElements.whenDefined("crawclaw-app");
    el.openTestChannelEditor("demo-channel");
    el.setTestChannelEditorTab("settings");
    await el.updateComplete;

    expect(el.renderRoot.textContent).not.toContain("App ID");
    expect(el.renderRoot.textContent).not.toContain("App Secret");
  } finally {
    el.remove();
  }
});
```

- [ ] **Step 2: 新增字段适配器**

创建 `ui/src/ui/rewrite/channel-editor-field-adapters.ts`：

```ts
import { html } from "lit";

export function renderTextField(params: {
  label: string;
  help?: string;
  value?: string;
  disabled?: boolean;
  onInput: (value: string) => void;
}) {
  return html`
    <label class="cp-wa-field">
      <span class="cp-wa-field__label">${params.label}</span>
      ${params.help ? html`<span class="cp-wa-field__help">${params.help}</span>` : null}
      <wa-input
        .value=${params.value ?? ""}
        ?disabled=${Boolean(params.disabled)}
        @input=${(event: Event) => {
          const target = event.currentTarget as HTMLInputElement;
          params.onInput(target.value);
        }}
      ></wa-input>
    </label>
  `;
}
```

- [ ] **Step 3: 在 Settings tab 中显式过滤账号级字段**

在 `ui/src/ui/rewrite/app-root.ts` 中，引入：

```ts
import { isAccountFieldPath } from "./channel-editor-account-mapping.ts";
```

并确保 `renderChannelSettingsTab()` 只保留渠道级字段：

```ts
const settingsGroups =
  this.channelConfigState.groupedEditorState?.settings
    ?.map((group) => ({
      ...group,
      fieldPaths: group.fieldPaths.filter((fieldPath) => !isAccountFieldPath(fieldPath)),
    }))
    .filter((group) => group.fieldPaths.length > 0) ?? [];
```

- [ ] **Step 4: 用 `Web Awesome` 替换当前最明显的丑控件**

优先替换：

- 主 tab
- 账号导航 action button
- 账号编辑输入框
- 设置页主要输入框 / select / switch
- 危险动作确认 dialog

保持原有数据流，但可见控件统一通过 adapter 输出为：

- `wa-input`
- `wa-textarea`
- `wa-select`
- `wa-switch`
- `wa-button`
- `wa-dialog`

- [ ] **Step 5: 调整样式，移除旧的手搓控件视觉**

在 `ui/src/styles/rewrite.css` 中新增：

```css
.cp-wa-field {
  display: grid;
  gap: 8px;
}

.cp-wa-field__label {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--cp-text);
}

.cp-wa-field__help {
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--cp-text-soft);
}

.cp-channel-editor-accounts__layout {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 18px;
}
```

同时删除或不再使用旧的：

- 裸 button tabs 样式
- 老 account list 单块面板样式
- 只为旧 input/button 视觉服务的局部样式

- [ ] **Step 6: 跑测试和构建**

运行：

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts src/ui/rewrite/legacy-cleanup.node.test.ts
pnpm --dir ui build
```

预期：

- tests pass
- build pass

- [ ] **Step 7: 提交这一阶段**

```bash
scripts/committer "UI: move account fields out of channel settings" \
  ui/src/ui/rewrite/channel-editor-field-adapters.ts \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/styles/rewrite.css \
  ui/src/ui/rewrite/channels-settings-editor.browser.test.ts \
  ui/src/ui/rewrite/legacy-cleanup.node.test.ts
```

---

### Task 5: 收视觉质量、交互细节和真实浏览器对稿

**Files:**

- Modify: `ui/src/ui/rewrite/app-root.ts`
- Modify: `ui/src/styles/rewrite.css`
- Modify: `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts`

- [ ] **Step 1: 增加 browser 级回归，锁定“账号编辑器 + 渠道设置”真正分离**

在 `ui/src/ui/rewrite/channels-settings-editor.browser.test.ts` 中加入：

```ts
it("renders a separate account editor pane in the Accounts tab", async () => {
  const el = createEditor();
  try {
    await customElements.whenDefined("crawclaw-app");
    el.openTestChannelEditor("demo-channel");
    el.setTestChannelEditorTab("accounts");
    await el.updateComplete;

    expect(el.renderRoot.querySelector(".cp-channel-editor-accounts__nav")).toBeTruthy();
    expect(el.renderRoot.querySelector(".cp-channel-editor-accounts__editor")).toBeTruthy();
  } finally {
    el.remove();
  }
});
```

- [ ] **Step 2: 继续收 tabs、状态条、主按钮和账号列表的视觉**

在 `ui/src/styles/rewrite.css` 中重点优化：

- `wa-tab-group` 的 active/hover/focus
- 状态条 badge 与按钮密度
- 账号列表 item 的默认态 / 选中态 / 脏态
- 右侧账号编辑器 section 头部层级

要求：

- 不再出现“debug panel”观感
- 主按钮明确
- 默认账号与连接状态一眼可见

- [ ] **Step 3: 用真实浏览器做一轮对稿**

运行：

```bash
pnpm --dir ui test src/ui/rewrite/channels-settings-editor.browser.test.ts
pnpm --dir ui build
```

然后打开本地页面，至少手动检查：

- tab 视觉是否像成熟组件，不像裸按钮
- Feishu 多账号是否能明显区分每个账号独立凭据
- `Settings` 是否真的只剩渠道级配置
- `Accounts` 是否有“左导航 + 右编辑器”的清晰结构

- [ ] **Step 4: 把最后一轮视觉回归变成测试保护**

根据对稿结果，在 `channels-settings-editor.browser.test.ts` 中增加稳定断言，例如：

```ts
expect(el.renderRoot.querySelector("wa-tab-group")).toBeTruthy();
expect(el.renderRoot.querySelector(".cp-channel-editor-accounts__layout")).toBeTruthy();
expect(el.renderRoot.querySelector(".cp-channel-editor-accounts__editor")).toBeTruthy();
```

- [ ] **Step 5: 跑最终 gate**

运行：

```bash
pnpm --dir ui test src/ui/controllers/channel-config.test.ts src/ui/rewrite/channels-settings-editor.browser.test.ts src/ui/rewrite/legacy-cleanup.node.test.ts
pnpm --dir ui build
pnpm build
```

预期：

- 所有目标测试通过
- `ui build` 通过
- repo build 通过

- [ ] **Step 6: 提交这一阶段**

```bash
scripts/committer "UI: polish Web Awesome channel editor" \
  ui/src/ui/rewrite/app-root.ts \
  ui/src/styles/rewrite.css \
  ui/src/ui/rewrite/channels-settings-editor.browser.test.ts
```

---

## 自检结果

### Spec 覆盖检查

这份 plan 覆盖了 spec 中的关键要求：

- `Web Awesome` 局部接入：Task 1
- tabs 重做：Task 2
- 多账号独立编辑器：Task 3
- 账号字段从 `Settings` 移除：Task 4
- 视觉质量和真实浏览器对稿：Task 5

没有遗漏 spec 里的核心目标。

### Placeholder 检查

已检查整份 plan，没有使用：

- `TBD`
- `TODO`
- “后续再补”
- “自行处理错误”

每个任务都给出了：

- 明确文件
- 明确步骤
- 明确命令
- 明确提交粒度

### 类型与命名一致性检查

本计划中统一使用以下命名：

- `ChannelEditorTab`
- `selectedAccountId`
- `accountDrafts`
- `isAccountFieldPath()`
- `Web Awesome`
- `wa-tab-group`

没有前后不一致的 helper 名称。
