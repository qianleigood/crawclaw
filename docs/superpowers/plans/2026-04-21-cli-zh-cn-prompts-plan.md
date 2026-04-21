# CLI 中文提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为整个 CrawClaw CLI 增加中文提示能力，同时保持命令名、子命令名、flag、配置 key、JSON 输出和错误 code 全部不变。

**Architecture:** 在 CLI 层新增一套轻量 i18n 文案系统，只作用于人类可读输出。全局 locale 解析统一接入命令注册与运行时上下文，命令实现改为通过文案 key 取文案，而不是内嵌英文字符串。先落公共终端组件与高交互命令，再覆盖其余命令面，最后统一清 help/提示文本。

**Tech Stack:** TypeScript, Commander, Vitest, `@clack/prompts`, existing `src/cli/*`, existing `src/terminal/*`, config schema system

---

## File Structure

### New files

- `src/cli/i18n/types.ts`
  - 定义 locale、translation key、翻译 map、翻译函数签名。
- `src/cli/i18n/en.ts`
  - 英文文案基线，作为默认 fallback。
- `src/cli/i18n/zh-CN.ts`
  - 中文文案。
- `src/cli/i18n/index.ts`
  - locale 解析、translator 创建、fallback 逻辑、格式化 helpers。
- `src/cli/i18n/index.test.ts`
  - locale 优先级、fallback、缺省行为测试。

### Core integration files

- `src/cli/program/context.ts`
  - 扩展 `ProgramContext`，注入 locale / translator。
- `src/cli/program/command-registry.ts`
  - 接入全局 `--lang`，并把 context 传给 lazy 命令注册。
- `src/cli/program/core-command-descriptors.ts`
  - 顶层命令说明改成通过文案 key 渲染。
- `src/cli/program/register-lazy-command.ts`
  - 确保 lazy 命令也拿到 locale-aware context。

### Config files

- `src/config/types.gateway.ts`
  - 为 CLI 增加 `cli.language` 对应类型。
- `src/config/zod-schema.ts`
  - 添加 `cli.language` schema。
- `src/config/schema.labels.ts`
  - 给 `cli.language` 增加标签。
- `src/config/schema.help.ts`
  - 给 `cli.language` 增加 help。
- `src/generated/config/schema.base.generated.ts`
  - 需要在实现时随 schema 生成更新。

### Terminal/prompt shared files

- `src/cli/progress.ts`
  - spinner/progress label 支持翻译。
- `src/cli/prompt.ts`
  - yes/no prompt 接 translator。
- `src/terminal/prompt-style.js`
  - prompt 文案入口统一。
- `src/terminal/prompt-select-styled.ts`
  - select 组件 label/hint 改为由调用方传入本地化文案。
- `src/terminal/table.ts`
  - 保持表格结构不变，但允许列标题和说明行由外层翻译。

### High-interaction command surfaces

- `src/cli/program/register.onboard.ts`
- `src/commands/onboard.ts`
- `src/commands/onboard-helpers.ts`
- `src/commands/onboard-config.ts`
- `src/commands/onboard-auth*.ts`
- `src/commands/auth-choice*.ts`
- `src/cli/program/register.configure.ts`
- `src/commands/configure*.ts`
- `src/commands/doctor*.ts`
- `src/cli/update-cli/*.ts`

### High-visibility output command surfaces

- `src/commands/status*.ts`
- `src/commands/channels/**/*.ts`
- `src/commands/sessions*.ts`
- `src/commands/agents*.ts`
- `src/cli/nodes-cli/*.ts`
- `src/cli/hooks-cli.ts`
- `src/cli/pairing-cli.ts`
- `src/cli/secrets-cli.ts`
- `src/cli/plugins-update-command.ts`

### Tests to extend

- `src/terminal/prompt-select-styled.test.ts`
- `src/cli/prompt.test.ts`
- `src/commands/onboard*.test.ts`
- `src/commands/configure*.test.ts`
- `src/commands/doctor*.test.ts`
- `src/commands/status*.test.ts`
- `src/cli/update-cli.test.ts`
- `src/cli/config-cli.test.ts`

---

### Task 1: 建立 CLI i18n 基础层

**Files:**

- Create: `src/cli/i18n/types.ts`
- Create: `src/cli/i18n/en.ts`
- Create: `src/cli/i18n/zh-CN.ts`
- Create: `src/cli/i18n/index.ts`
- Test: `src/cli/i18n/index.test.ts`

- [ ] **Step 1: 写 locale 解析与 fallback 的失败测试**

```ts
import { describe, expect, it } from "vitest";
import { createCliTranslator, resolveCliLocale } from "./index.js";

describe("resolveCliLocale", () => {
  it("prefers --lang over config and env", () => {
    expect(
      resolveCliLocale({
        flag: "zh-CN",
        config: "en",
        env: "en",
      }),
    ).toBe("zh-CN");
  });

  it("falls back to en for unsupported locale", () => {
    expect(
      resolveCliLocale({
        flag: "fr",
        config: undefined,
        env: undefined,
      }),
    ).toBe("en");
  });
});

describe("createCliTranslator", () => {
  it("returns zh-CN copy when locale is zh-CN", () => {
    const t = createCliTranslator("zh-CN");
    expect(t("common.confirm")).toBe("确认");
  });

  it("falls back to english when a zh-CN key is missing", () => {
    const t = createCliTranslator("zh-CN");
    expect(t("common.cancel")).toBe("取消");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/cli/i18n/index.test.ts`
Expected: FAIL with missing module/files

- [ ] **Step 3: 写最小 i18n 实现**

```ts
// src/cli/i18n/types.ts
export type CliLocale = "en" | "zh-CN";

export type CliTranslations = Record<string, string>;

export type CliTranslator = (key: string, params?: Record<string, string | number>) => string;
```

```ts
// src/cli/i18n/en.ts
import type { CliTranslations } from "./types.js";

export const EN_CLI_TRANSLATIONS: CliTranslations = {
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",
};
```

```ts
// src/cli/i18n/zh-CN.ts
import type { CliTranslations } from "./types.js";

export const ZH_CN_CLI_TRANSLATIONS: CliTranslations = {
  "common.confirm": "确认",
  "common.cancel": "取消",
};
```

```ts
// src/cli/i18n/index.ts
import { EN_CLI_TRANSLATIONS } from "./en.js";
import { ZH_CN_CLI_TRANSLATIONS } from "./zh-CN.js";
import type { CliLocale, CliTranslator } from "./types.js";

const SUPPORTED: readonly CliLocale[] = ["en", "zh-CN"] as const;

export function resolveCliLocale(params: {
  flag?: string;
  config?: string;
  env?: string;
}): CliLocale {
  for (const candidate of [params.flag, params.config, params.env]) {
    if (candidate && SUPPORTED.includes(candidate as CliLocale)) {
      return candidate as CliLocale;
    }
  }
  return "en";
}

export function createCliTranslator(locale: CliLocale): CliTranslator {
  const primary = locale === "zh-CN" ? ZH_CN_CLI_TRANSLATIONS : EN_CLI_TRANSLATIONS;
  return (key, params) => {
    const template = primary[key] ?? EN_CLI_TRANSLATIONS[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/cli/i18n/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
scripts/committer "CLI: add zh-CN prompt i18n core" \
  src/cli/i18n/types.ts \
  src/cli/i18n/en.ts \
  src/cli/i18n/zh-CN.ts \
  src/cli/i18n/index.ts \
  src/cli/i18n/index.test.ts
```

### Task 2: 接入全局 locale 解析与配置

**Files:**

- Modify: `src/cli/program/context.ts`
- Modify: `src/cli/program/command-registry.ts`
- Modify: `src/cli/program/core-command-descriptors.ts`
- Modify: `src/config/types.gateway.ts`
- Modify: `src/config/zod-schema.ts`
- Modify: `src/config/schema.labels.ts`
- Modify: `src/config/schema.help.ts`
- Modify: `src/generated/config/schema.base.generated.ts`
- Test: `src/cli/program/command-registry.test.ts`
- Test: `src/cli/config-cli.test.ts`

- [ ] **Step 1: 写失败测试，锁定 `--lang` 和 `cli.language` 行为**

```ts
it("resolves locale from --lang first", async () => {
  const ctx = createProgramContext({
    argv: ["node", "crawclaw", "--lang", "zh-CN", "status"],
    config: { cli: { language: "en" } },
  });
  expect(ctx.locale).toBe("zh-CN");
});

it("falls back to cli.language config", async () => {
  const ctx = createProgramContext({
    argv: ["node", "crawclaw", "status"],
    config: { cli: { language: "zh-CN" } },
  });
  expect(ctx.locale).toBe("zh-CN");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/cli/program/command-registry.test.ts src/cli/config-cli.test.ts`
Expected: FAIL because locale option/config do not exist yet

- [ ] **Step 3: 实现 program context 与 config 接线**

```ts
// src/cli/program/context.ts
export type ProgramContext = {
  programVersion: string;
  locale: "en" | "zh-CN";
  t: CliTranslator;
  channelOptions: string[];
  messageChannelOptions: string;
  agentChannelOptions: string;
};
```

```ts
// src/config/types.gateway.ts
export type CliConfig = {
  language?: "en" | "zh-CN";
};
```

```ts
// src/cli/program/command-registry.ts
program.option("--lang <locale>", "Prompt/help language (en or zh-CN)");
```

- [ ] **Step 4: 生成/更新 config schema 基线并跑测试**

Run: `pnpm test -- src/cli/program/command-registry.test.ts src/cli/config-cli.test.ts`
Expected: PASS

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
scripts/committer "CLI: wire locale resolution into program context" \
  src/cli/program/context.ts \
  src/cli/program/command-registry.ts \
  src/cli/program/core-command-descriptors.ts \
  src/config/types.gateway.ts \
  src/config/zod-schema.ts \
  src/config/schema.labels.ts \
  src/config/schema.help.ts \
  src/generated/config/schema.base.generated.ts \
  src/cli/program/command-registry.test.ts \
  src/cli/config-cli.test.ts
```

### Task 3: 本地化终端公共组件

**Files:**

- Modify: `src/cli/progress.ts`
- Modify: `src/cli/prompt.ts`
- Modify: `src/terminal/prompt-style.js`
- Modify: `src/terminal/prompt-select-styled.ts`
- Modify: `src/terminal/table.ts`
- Test: `src/terminal/prompt-select-styled.test.ts`
- Test: `src/cli/prompt.test.ts`

- [ ] **Step 1: 写失败测试，锁定 prompt/progress 接受 translator**

```ts
it("styles translated select labels before delegating", () => {
  const t = (key: string) => ({ "common.confirm": "确认" })[key] ?? key;
  // expect prompt helpers to consume translated strings instead of raw english literals
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/terminal/prompt-select-styled.test.ts src/cli/prompt.test.ts`
Expected: FAIL because shared helpers are not locale-aware

- [ ] **Step 3: 实现共享组件 locale-aware 接口**

```ts
export type PromptText = {
  message: string;
  hint?: string;
  placeholder?: string;
};
```

```ts
export function promptYesNo(
  question: string,
  defaultYes = false,
  labels?: {
    yes: string;
    no: string;
  },
): Promise<boolean> {
  /* keep behavior, add labels only */
}
```

- [ ] **Step 4: 跑共享组件测试**

Run: `pnpm test -- src/terminal/prompt-select-styled.test.ts src/cli/prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
scripts/committer "CLI: localize shared prompt and progress helpers" \
  src/cli/progress.ts \
  src/cli/prompt.ts \
  src/terminal/prompt-style.js \
  src/terminal/prompt-select-styled.ts \
  src/terminal/table.ts \
  src/terminal/prompt-select-styled.test.ts \
  src/cli/prompt.test.ts
```

### Task 4: 覆盖高交互命令面

**Files:**

- Modify: `src/cli/program/register.onboard.ts`
- Modify: `src/commands/onboard.ts`
- Modify: `src/commands/onboard-helpers.ts`
- Modify: `src/commands/onboard-config.ts`
- Modify: `src/commands/onboard-auth*.ts`
- Modify: `src/commands/auth-choice*.ts`
- Modify: `src/cli/program/register.configure.ts`
- Modify: `src/commands/configure*.ts`
- Modify: `src/commands/doctor*.ts`
- Modify: `src/cli/update-cli/*.ts`
- Test: `src/commands/onboard*.test.ts`
- Test: `src/commands/configure*.test.ts`
- Test: `src/commands/doctor*.test.ts`
- Test: `src/cli/update-cli.test.ts`

- [ ] **Step 1: 给 `onboard` 写 zh-CN prompt 快照测试**

```ts
it("renders zh-CN onboarding prompts when locale is zh-CN", async () => {
  const output = await runOnboardForTest({ locale: "zh-CN" });
  expect(output).toContain("请选择默认模型提供商");
});
```

- [ ] **Step 2: 给 `configure/doctor/update` 写同类失败测试**

```ts
it("renders zh-CN doctor repair guidance", async () => {
  const output = await runDoctorForTest({ locale: "zh-CN" });
  expect(output).toContain("建议修复");
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test -- src/commands/onboard.test.ts src/commands/configure.wizard.test.ts src/commands/doctor-config-flow.test.ts src/cli/update-cli.test.ts`
Expected: FAIL because prompts still embed english literals

- [ ] **Step 4: 把这些命令面的 prompt/help/error 迁到文案 key**

```ts
const message = ctx.t("onboard.provider.select.title");
const hint = ctx.t("onboard.provider.select.hint");
```

约束：

- 只替换人类可读字符串
- 不改命令名、flag、provider id、config path

- [ ] **Step 5: 运行命令面测试**

Run: `pnpm test -- src/commands/onboard.test.ts src/commands/configure.wizard.test.ts src/commands/doctor-config-flow.test.ts src/cli/update-cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
scripts/committer "CLI: localize onboarding configure doctor and update prompts" \
  src/cli/program/register.onboard.ts \
  src/commands/onboard.ts \
  src/commands/onboard-helpers.ts \
  src/commands/onboard-config.ts \
  src/commands/auth-choice.ts \
  src/commands/auth-choice-prompt.ts \
  src/commands/configure.wizard.ts \
  src/commands/doctor-prompter.ts \
  src/cli/update-cli.ts \
  src/commands/onboard.test.ts \
  src/commands/configure.wizard.test.ts \
  src/commands/doctor-config-flow.test.ts \
  src/cli/update-cli.test.ts
```

### Task 5: 覆盖高可见输出命令面

**Files:**

- Modify: `src/commands/status*.ts`
- Modify: `src/commands/channels/**/*.ts`
- Modify: `src/commands/sessions*.ts`
- Modify: `src/commands/agents*.ts`
- Modify: `src/cli/nodes-cli/*.ts`
- Modify: `src/cli/hooks-cli.ts`
- Modify: `src/cli/pairing-cli.ts`
- Test: `src/commands/status*.test.ts`
- Test: `src/commands/channels*.test.ts`
- Test: `src/commands/agents*.test.ts`

- [ ] **Step 1: 写失败测试，锁定中文说明层但不改变结构化字段**

```ts
it("keeps json output stable while localizing human-readable status text", async () => {
  const text = await runStatusForTest({ locale: "zh-CN", json: false });
  const json = await runStatusForTest({ locale: "zh-CN", json: true });
  expect(text).toContain("健康状态");
  expect(json).toContain('"health"');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/commands/status.summary.test.ts src/commands/channels.config-only-status-output.test.ts src/commands/agents.test.ts`
Expected: FAIL because status/help text is still english-only

- [ ] **Step 3: 实现状态类命令文案替换**

```ts
const title = ctx.t("status.section.health");
const emptyText = ctx.t("channels.empty.noAccounts");
```

约束：

- 表格列标题可中文
- JSON key 必须保持英文
- channel/provider/plugin id 必须保持英文

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- src/commands/status.summary.test.ts src/commands/channels.config-only-status-output.test.ts src/commands/agents.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
scripts/committer "CLI: localize status and operational command prompts" \
  src/commands/status.command.ts \
  src/commands/status.ts \
  src/commands/channels.ts \
  src/commands/agents.commands.status.ts \
  src/cli/nodes-cli/register.status.ts \
  src/cli/hooks-cli.ts \
  src/cli/pairing-cli.ts \
  src/commands/status.summary.test.ts \
  src/commands/channels.config-only-status-output.test.ts \
  src/commands/agents.test.ts
```

### Task 6: 覆盖低频命令与 help 文案

**Files:**

- Modify: `src/cli/program/*.ts`
- Modify: `src/cli/*.ts`
- Modify: `src/commands/backup*.ts`
- Modify: `src/cli/mcp*.ts`
- Modify: `src/cli/secrets-cli.ts`
- Modify: `src/cli/plugins-update-command.ts`
- Modify: `docs/cli/*.md`
- Test: `src/cli/*test.ts`

- [ ] **Step 1: 写顶层 help 描述失败测试**

```ts
it("renders zh-CN command descriptions in help output", async () => {
  const help = await runCliHelpForTest(["--lang", "zh-CN"]);
  expect(help).toContain("交互式引导");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/cli/program/command-registry.test.ts src/cli/update-cli.test.ts`
Expected: FAIL because help text still uses hard-coded english descriptions

- [ ] **Step 3: 替换剩余低频命令的人类可读文案**

```ts
description: ctx.t("command.backup.description");
```

- [ ] **Step 4: 同步 CLI docs，明确“命令英文、提示可中文”**

更新：

- `docs/cli/index.md`
- `docs/cli/onboard.md`
- `docs/cli/configure.md`
- `docs/cli/doctor.md`
- `docs/cli/status.md`

- [ ] **Step 5: 跑测试和 docs check**

Run: `pnpm test -- src/cli/program/command-registry.test.ts src/cli/update-cli.test.ts`
Expected: PASS

Run: `pnpm build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
scripts/committer "CLI: localize help text across remaining commands" \
  src/cli/program/command-registry.ts \
  src/cli/program/core-command-descriptors.ts \
  src/cli/secrets-cli.ts \
  src/cli/plugins-update-command.ts \
  docs/cli/index.md \
  docs/cli/onboard.md \
  docs/cli/configure.md \
  docs/cli/doctor.md \
  docs/cli/status.md
```

### Task 7: 全局验证与回归保护

**Files:**

- Modify: `src/cli/program/command-registry.test.ts`
- Modify: `src/commands/status-json.test.ts`
- Modify: `src/cli/config-cli.test.ts`
- Modify: `docs/start/wizard-cli-reference.md`

- [ ] **Step 1: 写稳定性测试，锁定命令接口不变**

```ts
it("keeps command names and flags stable while localizing prompt text", async () => {
  const help = await runCliHelpForTest(["--lang", "zh-CN"]);
  expect(help).toContain("onboard");
  expect(help).toContain("--lang");
  expect(help).not.toContain("命令：onboard");
});
```

- [ ] **Step 2: 写 JSON 输出稳定测试**

```ts
it("keeps status json keys unchanged under zh-CN locale", async () => {
  const json = await runStatusForTest({ locale: "zh-CN", json: true });
  expect(json).toContain('"health"');
  expect(json).toContain('"sessions"');
});
```

- [ ] **Step 3: 跑最终验证**

Run: `pnpm test -- src/cli/program/command-registry.test.ts src/cli/config-cli.test.ts src/commands/status-json.test.ts`
Expected: PASS

Run: `pnpm check`
Expected: PASS

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
scripts/committer "CLI: verify zh-CN prompt coverage without interface drift" \
  src/cli/program/command-registry.test.ts \
  src/cli/config-cli.test.ts \
  src/commands/status-json.test.ts \
  docs/start/wizard-cli-reference.md
```

---

## Notes / Constraints

- 只翻译人类可读层，不翻译命令接口。
- `json`、`yaml`、machine-readable 输出禁止改字段名。
- provider/channel/plugin ids 保持英文。
- 新增文案必须通过 `src/cli/i18n/*`，禁止继续在命令实现里散落新字符串。
- 对于暂未覆盖的 key，运行时必须 fallback 到英文，不能抛错。

## Final Verification Gate

在全部任务完成后，执行：

```bash
pnpm test -- src/cli/i18n/index.test.ts
pnpm test -- src/commands/onboard.test.ts src/commands/configure.wizard.test.ts src/commands/doctor-config-flow.test.ts src/cli/update-cli.test.ts
pnpm test -- src/commands/status.summary.test.ts src/commands/status-json.test.ts src/commands/channels.config-only-status-output.test.ts src/commands/agents.test.ts
pnpm test -- src/cli/program/command-registry.test.ts src/cli/config-cli.test.ts
pnpm check
pnpm build
```

Expected:

- 所有命令接口保持英文
- `--lang zh-CN` 下 prompt/help/修复建议为中文
- JSON 输出保持英文 key
- `cli.language` 可持久化语言偏好
