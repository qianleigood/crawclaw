---
title: "Hindsight 最佳实践（来自官方文档和集成案例）"
summary: "从 Hindsight 官方博客、集成文档和 benchmark 数据中提炼的最佳实践"
status: reference
---

# Hindsight 最佳实践

来源：Hindsight 官方文档 (https://hindsight.vectorize.io)、GitHub 仓库
(vectorize-io/hindsight)、集成案例博客。

## 1. 核心架构原则

### 1.1 自动捕获，而非依赖 agent 决策

> "OpenClaw's built-in memory depends on the agent deciding what to save — and
> models don't do this consistently." — Hindsight/OpenClaw 集成文档

**最佳实践**：每个轮次结束后自动 retain，不依赖 agent 主动调用写入工具。
Hindsight 在后台自动提取事实、实体和关系。

**对 CrawClaw 的启示**：当前 CrawClaw 的 `experience` agent 需要 LLM 决定
哪些内容值得提取。应改为自动 retain，让 Hindsight 的提取管线处理。

### 1.2 自动注入，而非工具检索

> "Auto-recall solves this by injecting memories automatically before every turn.
> The agent doesn't need to know the memory system exists." — Hindsight/OpenClaw

**最佳实践**：在每个轮次开始前自动注入相关记忆到系统提示词，而非暴露
`search_memory` 工具让 agent 决定何时调用。

**三种记忆模式**（来自 Hermes 集成）：

| 模式             | 行为                | 适用场景           |
| ---------------- | ------------------- | ------------------ |
| `hybrid`（推荐） | 自动注入 + 暴露工具 | 通用场景           |
| `context`        | 仅自动注入，无工具  | 简单对话           |
| `tools`          | 仅工具，无自动注入  | agent 需要精确控制 |

### 1.3 反馈环路防护

> "The plugin automatically strips its own `<hindsight_memories>` tags before
> retention, preventing this loop." — Hindsight/OpenClaw

**最佳实践**：在 retain 之前剥离所有注入的记忆标签：

- `<hindsight_memories>...</hindsight_memories>`
- `<durable_recall>...</durable_recall>`
- 任何系统注入的记忆上下文

否则会导致指数级记忆增长和重复条目。

## 2. Bank 设计

### 2.1 Mission 导向的 Bank

> "When you set a mission, the consolidation engine focuses on extracting
> knowledge that serves that purpose." — Hindsight 0.4.0 发布博客

**最佳实践**：每个 bank 设置明确的 `mission`，指导 Hindsight 的提取引擎
优先提取哪些知识。

```python
client.create_bank(
    bank_id="support-agent",
    mission="You're a customer support agent — track customer preferences, "
            "past issues, and communication styles."
)
```

**对 CrawClaw 的启示**：

- `durable` bank: "提取用户明确表达的偏好、重要的项目决策和稳定的知识事实"
- `experience` bank: "记录成功的操作方法、失败的教训和可复用的工作流程"
- `resource` bank: "存储项目文档、代码片段和参考资料的关键信息"

### 2.2 Disposition 三维模型

Hindsight 的 disposition 控制 reflect 操作的推理风格：

| 维度                | 1（低）      | 3（平衡）      | 5（高）            |
| ------------------- | ------------ | -------------- | ------------------ |
| 怀疑度 (skepticism) | 信任表面信息 | 正常批判思维   | 寻找矛盾，多源验证 |
| 字面度 (literalism) | 推断解读     | 混合字面与推断 | 严格按字面理解     |
| 共情度 (empathy)    | 优化正确性   | 平衡事实与情感 | 重视人类影响和情感 |

**最佳实践**：按 bank 用途配置 disposition：

- 经验 bank：高怀疑度（验证后再接受）、平衡字面度
- 长期 bank：低怀疑度（信任用户偏好）、高字面度
- 心智模型：平衡怀疑度、低字面度（综合需要解读）

### 2.3 动态 Bank 隔离

来自 OpenClaw 共享记忆博客：

```json
{
  "dynamicBankGranularity": ["agent", "channel", "user"]
}
```

**可用维度**：

- `agent` — agent/bot 身份
- `channel` — 渠道或会话 ID
- `user` — 交互的用户
- `provider` — 消息提供方（Slack、Discord 等）

**最佳实践**：

- 默认按 `agent` 隔离
- 多用户场景加 `user` 维度
- 跨 agent 共享场景用 `shared_mode: true`

### 2.4 RetainMission 控制提取范围

> "Without a focused mission, the bank accumulates everything. With one, only
> the context that generalizes across conversations gets retained."
> — Hindsight 共享记忆博客

**最佳实践**：设置 `retainMission` 控制什么内容被提取：

```
Extract user preferences, ongoing projects, recurring commitments, and
important context. Retain facts that would be useful in any future conversation.
Skip ephemeral task details and one-off requests.
```

## 3. 检索策略

### 3.1 四路混合检索

Hindsight 的 recall 操作并行执行四种检索策略：

| 策略             | 擅长                   | 不擅长                        |
| ---------------- | ---------------------- | ----------------------------- |
| 语义搜索（向量） | 概念相似、同义表达     | 精确匹配（SKU、错误码、人名） |
| BM25 关键词      | 精确术语匹配           | 同义词、不同表述              |
| 图遍历           | 实体关系、因果链       | 孤立事实                      |
| 时间搜索         | 时间范围查询、事件序列 | 非时间相关的事实              |

**最佳实践**：不要只依赖单一策略。Hindsight 的四路并行检索 + RRF 融合 +
cross-encoder 重排序是经过 benchmark 验证的最优方案。

### 3.2 Budget 选择

| Budget | 检索策略数 | 延迟       | 适用场景           |
| ------ | ---------- | ---------- | ------------------ |
| `low`  | 1-2        | 最快       | 简单查询、高频调用 |
| `mid`  | 2-3        | 中等       | 通用场景（默认）   |
| `high` | 全部 4 路  | 最慢但最准 | 复杂查询、梦境反思 |

### 3.3 Recall Types

Hindsight 0.4.0+ 统一了记忆类型：

| Type          | 说明                 | 何时用               |
| ------------- | -------------------- | -------------------- |
| `world`       | 关于世界的事实       | 事实查询             |
| `experience`  | agent 自身的经验     | 经验查询             |
| `observation` | 整合后的知识（推荐） | 通用查询（避免重复） |

**最佳实践**：默认用 `types: ["observation"]`。Observation 是整合去重后的
视图，避免同一答案从多个原始事实中重复出现。

### 3.4 查询时间锚点

```python
client.recall(
    bank_id="my-bank",
    query="What happened during the product launch?",
    query_timestamp="2025-03-15T10:00:00Z",  # 锚定到特定时间点
)
```

**最佳实践**：对时间相关查询使用 `query_timestamp`，让 Hindsight 的时间
感知检索（spreading activation）正确工作。

## 4. 知识整合

### 4.1 Observations（自动整合）

> "After every `retain()` call, Hindsight's consolidation engine runs
> automatically." — Hindsight 0.4.0 博客

Hindsight 自动将原始事实整合为 Observations（整合知识）：

| 原始事实               | 整合后的 Observation                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| "Alice 偏好 Python"    | "Alice 是 Python 为主的开发者，重视可读性和简洁性，推荐使用类型提示，偏好 pytest 测试" |
| "Alice 不喜欢冗长代码" |                                                                                        |
| "Alice 推荐类型提示"   |                                                                                        |

**关键特性**：

- 证据追踪：每个 Observation 关联支撑它的原始事实
- 时间演化：保留知识的完整演变历程，而非仅保留最新状态
- 任务导向：受 bank 的 `mission` 影响，优先提取与任务相关的知识

### 4.2 Mental Models（手动策展）

> "Mental models give you explicit control over how your agent answers common
> questions." — Hindsight 0.4.0 博客

**最佳实践**：为高频查询创建 Mental Models：

```python
client.create_mental_model(
    bank_id="my-bank",
    name="用户偏好",
    source_query="用户的长期偏好、习惯、沟通风格是什么？",
    trigger={"refresh_after_consolidation": True},  # 自动刷新
)
```

**两种使用方式**：

1. **通过 reflect 自动使用**：reflect 操作优先检查 Mental Models
2. **直接查询**：通过 ID 即时获取，无需 LLM 推理

### 4.3 Directives（硬规则）

> "Directives provide hard rules that your agent must always follow during
> reflect operations." — Hindsight 0.4.0 博客

**最佳实践**：用 Directives 设置合规和安全约束：

- "永远不要提供医疗诊断建议"
- "始终用中文回复"
- "不要分享个人身份信息"

## 5. 中文场景

### 5.1 必须配置的组件

| 组件      | 默认值（英文）                         | 中文推荐配置                                       |
| --------- | -------------------------------------- | -------------------------------------------------- |
| 嵌入模型  | `BAAI/bge-small-en-v1.5`               | `BAAI/bge-m3`（100+ 语言）                         |
| 重排序器  | `cross-encoder/ms-marco-MiniLM-L-6-v2` | `BAAI/bge-reranker-v2-m3`（100+ 语言）             |
| BM25 后端 | `native`（英文词典）                   | `pgroonga`（CJK 开箱支持）或 `pg_search` + `jieba` |

### 5.2 语言处理

> "Hindsight automatically detects the language of your input and responds in
> the same language." — Hindsight 多语言文档

- 实体保留原始文字："张伟" 不会被音译为 "Zhang Wei"
- 混合语言内容自动处理："王芳在 Google 北京办公室工作"
- LLM 输出语言跟随输入语言

### 5.3 BM25 后端选择

| 后端                  | CJK 支持          | 推荐场景                 |
| --------------------- | ----------------- | ------------------------ |
| `pgroonga`            | 开箱支持          | 推荐用于中文/混合语言    |
| `pg_search` + `jieba` | 需配置            | 使用 ParadeDB 时         |
| `native` + `zhparser` | 需安装扩展        | 已有 zhparser 时         |
| `vchord`              | 多语言 llmlingua2 | 已用 vchord 做向量搜索时 |

## 6. 部署模式

### 6.1 三种部署模式

| 模式                              | 适用场景             | 数据控制 | 设置复杂度 |
| --------------------------------- | -------------------- | -------- | ---------- |
| `hindsight-embed`（本地守护进程） | 开发、单机、隐私优先 | 完全本地 | 低         |
| 外部 API（自托管）                | 团队、生产环境       | 完全控制 | 中         |
| Hindsight Cloud                   | 团队、快速启动       | 托管     | 最低       |

### 6.2 桌面应用推荐

> "The daemon starts when [the app] displays 'starting agent' on your first
> message — not at launch." — Hermes 集成文档

**最佳实践**：对桌面应用，用 `hindsight-embed` 内嵌模式：

- 首次使用时自动启动守护进程
- 不需要用户手动部署 PostgreSQL
- 数据不离开本机

### 6.3 团队共享记忆

> "One agent learns something; every agent knows it. One config change."
> — Hindsight 共享记忆博客

**最佳实践**：

- 所有实例连接同一个 Hindsight 端点
- 设置 `dynamicBankId: false` 使用共享 bank
- 或用 `dynamicBankGranularity: ["user"]` 按用户隔离

## 7. 性能和可观测性

### 7.1 Benchmark 数据

Hindsight 在 BEAM 10M token benchmark（2026-04）中的表现：

| 系统          | 100K      | 500K      | 1M        | 10M       |
| ------------- | --------- | --------- | --------- | --------- |
| **Hindsight** | **73.4%** | **71.1%** | **73.9%** | **64.1%** |
| Honcho        | 63.0%     | 64.9%     | 63.1%     | 40.6%     |
| RAG baseline  | 32.3%     | 33.0%     | 30.7%     | 24.9%     |

关键洞察：Hindsight 在 1M token 时的得分（73.9%）高于 500K（71.1%），
性能随数据量增加而提升——这与大多数系统的趋势相反。

### 7.2 监控指标

Hindsight 暴露 Prometheus 指标：

| 指标                                | 说明                                    |
| ----------------------------------- | --------------------------------------- |
| `hindsight.operation.duration`      | 操作延迟（按 operation/bank_id/budget） |
| `hindsight.llm.duration`            | LLM 调用延迟（按 provider/model/scope） |
| `hindsight.llm.tokens.input/output` | Token 使用量                            |
| `hindsight.http.duration`           | HTTP 请求延迟                           |

### 7.3 延迟优化

- **Delta Retain**（0.4.21+）：跳过未变更内容的 LLM 处理
- **Async Retain**：设置 `retainAsync: true` 异步处理保留
- **Budget 选择**：高频场景用 `low` 延迟最低
- **Prefetch**：在用户输入前就开始召回（Hermes 模式）

## 8. 对 CrawClaw 设计的直接影响

基于以上最佳实践，对设计文档的修正和补充：

| 编号  | 最佳实践                   | 对 CrawClaw 的影响                                                |
| ----- | -------------------------- | ----------------------------------------------------------------- |
| BP1   | 自动捕获 > agent 决策      | `after_turn` 应直接调 Hindsight `retain`，不依赖 experience agent |
| BP2   | 自动注入 > 工具检索        | 默认 `hybrid` 模式：自动注入 + 可选工具                           |
| BP3   | 反馈环路防护必须做         | retain 前剥离所有记忆标签                                         |
| Bank1 | Mission 导向提取           | 每个 bank 设置中文 mission                                        |
| Bank2 | Disposition 按用途配置     | 经验=高怀疑，长期=低怀疑，心智模型=平衡                           |
| Bank3 | Observations 替代 opinions | recall 默认用 `types: ["observation"]`                            |
| Ret1  | 四路混合检索               | 不要在 CrawClaw 侧重排序，让 Hindsight 处理                       |
| Ret2  | Budget 按场景选择          | 梦境反思用 `high`，日常召回用 `mid`                               |
| Ret3  | 时间锚点                   | 时间相关查询传 `query_timestamp`                                  |
| MM1   | Mental Models 自动刷新     | `trigger_refresh_after_consolidation: true`                       |
| MM2   | 预置常用 Mental Models     | 用户偏好、项目知识、工作模式、决策历史                            |
| Dir1  | Directives 用于硬规则      | 用 Directives 设置安全和合规约束                                  |
| ZH1   | 必须配多语言模型           | bge-m3 + bge-reranker-v2-m3 + pgroonga                            |
| ZH2   | 实体保留原始文字           | 不音译中文人名/术语                                               |
| Dep1  | 桌面用 embed 模式          | CrawClaw Desktop 内嵌 hindsight-embed                             |
| Dep2  | 团队用共享 bank            | 设置 shared_mode 或 dynamicBankGranularity                        |
| Perf1 | Delta Retain 减少开销      | 启用 delta retain 跳过未变更内容                                  |
| Perf2 | Async Retain 降低延迟      | 高频场景设 `retainAsync: true`                                    |
