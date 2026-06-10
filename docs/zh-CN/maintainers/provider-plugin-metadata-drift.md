---
read_when:
  - 你正在添加或更改捆绑提供商或原生插件元数据
  - 你需要决定哪个元数据源是权威的
  - 你正在审查提供商、插件或生成的元数据漂移
summary: 维护者对提供商和插件元数据所有权的审查
title: 提供商和插件元数据漂移
x-i18n:
  generated_at: "2026-06-10T17:03:26Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 127b476fa5c0390a77b00d2dad740dc98ecfcb80bbd8aba94a930bc2406c93f9
  source_path: maintainers/provider-plugin-metadata-drift.md
  workflow: 15
---

# 提供商和插件元数据漂移

本页面记录了捆绑提供商和插件元数据的当前所有权划分。该领域的多个实现文件受 CODEOWNERS 限制，因此未来的运行时契约变更在编辑这些文件之前仍需要明确的 owner 审查。

## 当前来源

- `crates/crawclaw-providers` 拥有运行时提供商目录、提供商默认值、传输元数据、配置 schema 和请求规范化。
- `crates/crawclaw-native-plugins` 拥有内置原生插件描述符、工具、原生 Web 提供商、语音提供商、媒体提供商、服务和原生网关方法描述符。
- `extensions/*/crawclaw.plugin.json` 拥有包标识、原生入口声明、配置 schema、捆绑 Skills、运行时资源以及保护兼容性的公共清单快照。
- `src/generated/` 存储生成的 JSON 读取模型，供文档、包检查和 Desktop 或运行时防护栏使用。

## 清单防护元数据

这些字段仍出现在清单中，因为它们是公共捆绑插件契约的一部分，但运行时和生成的元数据首先从 Rust 目录派生：

- 提供商到插件的映射来自 `BUNDLED_PROVIDER_PLUGINS`。
- 提供商凭证环境变量来自 `BUNDLED_PROVIDER_AUTH_ENV_VAR_CANDIDATES`。
- 提供商旧版插件别名和自动启用映射来自 `BUNDLED_PROVIDER_PLUGIN_CONTRACT_OVERRIDES`。
- 原生工具名称出现在原生插件描述符和捆绑插件的清单契约中。
- Web、语音和媒体提供商描述符出现在原生插件描述符和生成的 capability 元数据中。

提供商 crate 保留防护测试，将 Rust 目录与清单快照进行比较，以便公共清单契约不会静默漂移。

## 当前规则

将 Rust 作为运行时事实来源：

- 提供商运行时行为保持在 `crates/crawclaw-providers` 中。
- 原生工具和 sidecar 行为保持在 `crates/crawclaw-native-plugins` 和运行时原生插件注册表中。
- 插件清单作为包和分发契约保留，而不是作为第二个运行时目录。
- 生成的元数据保持为派生输出，应进行检查，而非手动编辑。

不要删除第三方插件打包或文档仍视为公共契约的清单字段，除非有单独的兼容性决策。

## 验证

在元数据变更前后使用现有的生成检查：

- `pnpm check:bundled-capability-metadata`
- `pnpm check:bundled-provider-auth-env-vars`
- `pnpm check:provider-runtime-constants`
- `pnpm release:check`
