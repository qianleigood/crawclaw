---
permalink: /security/formal-verification/
read_when:
  - 审查形式化安全模型保证或限制
  - 复现或更新 TLA+/TLC 安全模型检查
summary: CrawClaw 最高风险路径的机器验证安全模型。
title: 形式化验证（安全模型）
x-i18n:
  generated_at: "2026-06-05T14:48:18Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 7cf56b7768f601bb6b3c53d7b8918559bd51442ec656d0dee99e70e58a8e8995
  source_path: security/formal-verification.md
  workflow: 15
---

# 形式化验证（安全模型）

本页面追踪 CrawClaw 的**形式化安全模型**（目前为 TLA+/TLC；根据需要可添加更多）。

> 注意：一些较旧的链接可能引用的是之前的项目名称。

**目标（北极星）：** 提供机器验证的论据，证明 CrawClaw 在明确假设下执行其预期的安全策略（授权、会话隔离、工具门控和配置错误安全）。

**现状：** 可执行的、攻击者驱动的**安全回归套件**：

- 每个声明都有一个在有限状态空间上可运行的模型检查。
- 许多声明都有一个配对的**负面模型**，用于为真实 bug 类生成反例追踪。

**尚不具备的：** 不能证明"CrawClaw 在所有方面都是安全的"，也不能证明完整的 Rust/原生实现是正确的。

## 模型存放位置

模型在单独的仓库中维护：[vignesh07/crawclaw-formal-models](https://github.com/vignesh07/crawclaw-formal-models)。

## 重要免责

- 这些是**模型**，不是完整的 Rust/原生实现。模型与代码之间可能存在漂移。
- 结果受 TLC 探索的状态空间限制；"绿色"并不意味着超出建模假设和范围的任何安全性。
- 某些声明依赖于明确的环境假设（例如，正确的部署、正确的配置输入）。

## 复现结果

目前，通过在本地克隆模型仓库并运行 TLC 来复现结果（见下文）。未来的迭代可以提供：

- 运行模型并附带公开产物（反例追踪、运行日志）的 CI
- 为小的、有界的检查提供托管的"运行此模型"工作流

入门：

```bash
git clone https://github.com/vignesh07/crawclaw-formal-models
cd crawclaw-formal-models

# 需要 Java 11+（TLC 在 JVM 上运行）。
# 仓库附带了固定的 `tla2tools.jar`（TLA+ 工具）并提供 `bin/tlc` + Make 目标。

make <target>
```

### Gateway 暴露和开放 Gateway 配置错误

**声明：** 在无认证的情况下绑定到 loopback 之外可能使远程入侵成为可能/增加暴露；token/密码阻止未认证攻击者（根据模型假设）。

- 绿色运行：
  - `make gateway-exposure-v2`
  - `make gateway-exposure-v2-protected`
- 红色（预期）：
  - `make gateway-exposure-v2-negative`

另见：模型仓库中的 `docs/gateway-exposure-matrix.md`。

### Gateway exec 管道（最高风险能力）

**声明：** 配置 `exec host=gateway` 时需要实时批准；批准被 token 化以防止重放（模型中）。

- 绿色运行：
  - `make gateway-exec-pipeline`
  - `make approvals-token`
- 红色（预期）：
  - `make gateway-exec-pipeline-negative`
  - `make approvals-token-negative`

### 配对存储（私信门控）

**声明：** 配对请求遵守 TTL 和待处理请求上限。

- 绿色运行：
  - `make pairing`
  - `make pairing-cap`
- 红色（预期）：
  - `make pairing-negative`
  - `make pairing-cap-negative`

### 入口门控（提及 + 控制命令绕过）

**声明：** 在需要提及的群组上下文中，未经授权的"控制命令"无法绕过提及门控。

- 绿色：
  - `make ingress-gating`
- 红色（预期）：
  - `make ingress-gating-negative`

### 路由/会话密钥隔离

**声明：** 来自不同对等方的私信不会崩溃到同一会话，除非明确链接/配置。

- 绿色：
  - `make routing-isolation`
- 红色（预期）：
  - `make routing-isolation-negative`

## v1++：额外的有界模型（并发、重试、追踪正确性）

这些是后续模型，用于在真实世界故障模式（非原子更新、重试和消息扇出）周围收紧保真度。

### 配对存储并发/幂等性

**声明：** 配对存储即使在交错执行下也应强制执行 `MaxPending` 和幂等性（即"检查后写入"必须是原子的/加锁的；刷新不应创建重复）。

含义：

- 在并发请求下，你不能超过频道的 `MaxPending`。
- 同一 `(channel, sender)` 的重复请求/刷新不应创建重复的实时待处理行。

- 绿色运行：
  - `make pairing-race`（原子/加锁上限检查）
  - `make pairing-idempotency`
  - `make pairing-refresh`
  - `make pairing-refresh-race`
- 红色（预期）：
  - `make pairing-race-negative`（非原子 begin/commit 上限竞态）
  - `make pairing-idempotency-negative`
  - `make pairing-refresh-negative`
  - `make pairing-refresh-race-negative`

### 入口追踪关联/幂等性

**声明：** 摄取应跨扇出保留追踪关联，并在提供商重试下保持幂等性。

含义：

- 当一个外部事件变为多个内部消息时，每个部分保持相同的追踪/事件标识。
- 重试不会导致双重处理。
- 如果提供商事件 ID 缺失，去重回退到安全密钥（例如，追踪 ID）以避免丢弃不同事件。

- 绿色：
  - `make ingress-trace`
  - `make ingress-trace2`
  - `make ingress-idempotency`
  - `make ingress-dedupe-fallback`
- 红色（预期）：
  - `make ingress-trace-negative`
  - `make ingress-trace2-negative`
  - `make ingress-idempotency-negative`
  - `make ingress-dedupe-fallback-negative`

### 路由 dmScope 优先级 + identityLinks

**声明：** 路由必须默认保持私信会话隔离，仅在明确配置时崩溃会话（频道优先级 + 身份链接）。

含义：

- 频道特定的 dmScope 覆盖必须优先于全局默认值。
- identityLinks 仅应在明确的链接组内崩溃，而不是跨不相关的对等方。

- 绿色：
  - `make routing-precedence`
  - `make routing-identitylinks`
- 红色（预期）：
  - `make routing-precedence-negative`
  - `make routing-identitylinks-negative`
