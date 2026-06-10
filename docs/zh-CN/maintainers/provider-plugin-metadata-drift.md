---
summary: "provider 和 plugin 元数据 ownership 的维护者审计说明"
read_when:
  - 你在添加或修改捆绑 provider 或 native plugin 元数据
  - 你需要判断哪个元数据来源是权威来源
  - 你在评审 provider、plugin 或生成元数据漂移
title: "Provider and Plugin Metadata Drift"
x-i18n:
  generated_at: "2026-06-10T10:39:08Z"
  model: codex
  provider: openai
  source_hash: 9e8220848b3060b298e12913d65c6e100f18bb811e5aa1b7a1a54bcb5cb26b4a
  source_path: maintainers/provider-plugin-metadata-drift.md
  workflow: 15
---

# Provider and Plugin Metadata Drift

本文记录捆绑 provider 和 plugin 元数据当前的 ownership 划分。该区域里有几个实现文件受 CODEOWNERS 限制，
所以未来的运行时 contract 变更在编辑这些文件前仍需要明确的 owner review。

## 当前来源

- `crates/crawclaw-providers` 拥有 runtime provider catalog、provider defaults、transport metadata、config schema 和 request normalization。
- `crates/crawclaw-native-plugins` 拥有内置 native plugin descriptors、tools、native web providers、speech providers、media providers、services 和 native gateway method descriptors。
- `extensions/*/crawclaw.plugin.json` 拥有 package identity、native entry declaration、config schema、bundled skills、runtime assets，以及用于守护兼容性的 public manifest snapshot。
- `src/generated/` 存放生成的 JSON read models，供 docs、package checks、desktop 或 runtime guardrails 消费。

## Manifest Guard Metadata

这些字段仍会出现在 manifests 中，因为它们是 public bundled plugin contract 的一部分，但 runtime 和生成元数据优先从 Rust catalogs 派生：

- Provider-to-plugin mappings 来自 `BUNDLED_PROVIDER_PLUGINS`。
- Provider auth environment variables 来自 `BUNDLED_PROVIDER_AUTH_ENV_VAR_CANDIDATES`。
- Provider legacy plugin aliases 和 auto-enable mappings 来自 `BUNDLED_PROVIDER_PLUGIN_CONTRACT_OVERRIDES`。
- Native tool names 出现在 native plugin descriptors 和捆绑 extensions 的 manifest contracts 中。
- Web、speech 和 media provider descriptors 出现在 native plugin descriptors 和 generated capability metadata 中。

provider crate 保留 guard tests，用 Rust catalog 对比 manifest snapshot，确保 public manifest contract 不会静默漂移。

## 当前规则

保持 Rust 作为运行时事实来源：

- Provider runtime behavior 留在 `crates/crawclaw-providers`。
- Native tool 和 sidecar behavior 留在 `crates/crawclaw-native-plugins` 以及 runtime native plugin registry。
- Extension manifests 保持为 package 和 distribution contracts，不作为第二套 runtime catalog。
- Generated metadata 仍是派生输出，应检查它，而不是手工编辑它。

不要移除第三方 plugin packaging 或 docs 仍当作 public contract 的 manifest 字段，除非另有兼容性决策。

## 验证

在元数据变更前后使用现有生成检查：

- `pnpm check:bundled-capability-metadata`
- `pnpm check:bundled-provider-auth-env-vars`
- `pnpm check:provider-runtime-constants`
- `pnpm release:check`
