---
read_when:
  - 添加新的核心能力和插件注册接口
  - 决定代码属于核心、供应商插件还是功能插件
  - 为渠道或工具连接新的运行时辅助函数
sidebarTitle: Adding Capabilities
summary: 为 CrawClaw 插件系统添加新共享能力的贡献者指南
title: 添加能力（贡献者指南）
x-i18n:
  generated_at: "2026-05-22T02:13:55Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 567debbbe3294a75730e8bca85b27cf88a3a461af51b152954461a5e2bf562f5
  source_path: tools/capability-cookbook.md
  workflow: 15
---

# 添加能力

<Info>
  这是 CrawClaw 核心开发者的**贡献者指南**。如果你要构建外部插件，请参阅[构建插件](/plugins/building-plugins)。
</Info>

在 CrawClaw 需要新领域（如图像生成、视频生成或某些未来供应商支持的特性区域）时使用。

规则：

- 插件 = 所有权边界
- 能力 = 共享核心契约

这意味着你不应该从直接将供应商连接到渠道或工具开始。应该从定义能力开始。

## 何时创建能力

当满足以下所有条件时创建新能力：

1. 多个供应商可能实现它
2. 渠道、工具或功能插件应该使用它而不关心供应商
3. 核心需要拥有回退、策略、配置或投递行为

如果工作仅限供应商且尚不存在共享契约，请停止并先定义契约。

## 标准序列

1. 定义类型化的核心契约。
2. 为该契约添加插件注册。
3. 添加共享运行时辅助函数。
4. 连接一个真实的供应商插件作为证明。
5. 将功能/渠道使用者迁移到运行时辅助函数。
6. 添加契约测试。
7. 记录面向操作员的配置和所有权模型。

## 放置位置

核心：

- 请求/响应类型
- 提供商注册表 + 解析
- 回退行为
- 配置 schema 和标签/帮助
- 运行时辅助函数接口

供应商插件：

- 供应商 API 调用
- 供应商凭证处理
- 供应商特定请求规范化
- 能力实现的注册

功能插件：

- 调用 Rust 本机运行时或匹配的非执行 SDK 辅助函数
- 绝不直接调用供应商实现

## 文件检查清单

对于新能力，预期会涉及以下区域：

- `src/generated/plugins/bundled-capability-metadata.generated.json`
- `crates/crawclaw-plugin-sdk/src/lib.rs`
- `crates/crawclaw-plugin-host/src/lib.rs` 用于 Desktop 插件读取模型更新
- `crates/crawclaw-channels/src/lib.rs` 用于本机渠道描述符和 Desktop 渠道配置元数据
- `crates/crawclaw-runtime/src/lib.rs`
- 拥有能力契约/运行时的 Rust crate
- 一个或多个捆绑插件包
- 配置/文档/测试

## 审查检查清单

在发布新能力之前，验证：

- 没有渠道/工具直接导入供应商代码
- 运行时辅助函数是共享路径
- 至少一个 Rust 契约测试断言捆绑所有权
- 配置文档命名新模型/配置键
- 插件文档解释所有权边界

如果 PR 跳过能力层并将供应商行为硬编码到渠道/工具中，请退回并先定义契约。
