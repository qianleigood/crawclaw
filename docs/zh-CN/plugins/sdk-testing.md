---
read_when:
  - 你正在为插件编写测试
  - 你需要验证 Rust 插件描述符
  - 你想了解捆绑插件的契约测试
sidebarTitle: Testing
summary: CrawClaw 原生插件测试模式
title: 插件测试
x-i18n:
  generated_at: "2026-05-22T03:01:13Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: c2aa4203f8bfc9087282b1714e52cf95ed7584d7fc1cda8fc06e693a7dd8e383
  source_path: plugins/sdk-testing.md
  workflow: 15
---

# 插件测试

CrawClaw 插件运行时行为由原生代码所有。请测试 Rust SDK、原生插件注册表和 Gateway/运行时契约，而不是依赖已移除的 JavaScript SDK 测试辅助工具。

<Tip>
  提供商示例位于[提供商配置](/plugins/sdk-provider-plugins#add-a-provider)中。
</Tip>

## Rust SDK 测试

更改插件描述符辅助工具时，运行 SDK crate 测试：

```bash
cargo test -q -p crawclaw-plugin-sdk
```

这些测试应该证明辅助构建器保留了现有的 JSON 传输格式。

## 原生插件测试

添加或更改捆绑插件描述符时，运行原生注册表测试：

```bash
cargo test -q -p crawclaw-native-plugins
```

对于运行时或面向 Gateway 的行为，还要运行所属 crate 的测试：

```bash
cargo test -q -p crawclaw-runtime
cargo test -q -p crawclaw-gateway
```

## 仓库契约测试

捆绑插件契约验证注册所有权、描述符格式和 Desktop 插件读取模型：

```bash
cargo test -q -p crawclaw-plugin-host
cargo test -q -p crawclaw-runtime native_plugin_registry
cargo test -q -p crawclaw-gateway plugins
```

这些测试断言：

- 哪些插件注册了哪些提供商
- 哪些插件注册了语音或媒体提供商
- 注册格式正确性
- 运行时契约合规性
- 防护机制确保已移除的 JavaScript 插件 SDK 和 TypeScript 测试接口不会回归

## Desktop 打包防护

Desktop 应用不得发布已移除的 JavaScript SDK 运行时制品：

```bash
pnpm desktop:tauri:release-check
```

当本地存在打包后的应用制品时，运行此发布检查。

## 相关

- [SDK 概览](/plugins/sdk-overview) -- Rust SDK 概览
- [提供商配置](/plugins/sdk-provider-plugins) -- 提供商设置
- [构建插件](/plugins/building-plugins) -- 入门指南
