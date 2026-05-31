---
title: "Memory Architecture Redesign: Hindsight-Native"
summary: "Historical redesign notes for CrawClaw memory and Hindsight Retain/Recall/Reflect integration"
status: historical
---

# 记忆架构重设计：Hindsight 原生

> Historical note: this draft records the pre-migration design baseline and
> proposed rollout. The current runtime no longer exposes the old local
> outbox or file-backed durable-memory tool surface described in some sections
> below.

## 1. 问题陈述

### 1.1 当前架构

CrawClaw 的记忆系统有六层：

| 层级       | 存储                        | 代码位置                     |
| ---------- | --------------------------- | ---------------------------- |
| 会话消息   | SQLite `runtime.db`         | 旧本地 runtime store         |
| 会话摘要   | Markdown 文件               | 旧本地 session-summary store |
| 长期记忆   | Markdown 文件               | 旧 file-backed durable store |
| 经验记忆   | Hindsight bank + 本地发件箱 | 旧本地 experience outbox     |
| 梦境整合   | `history.json` 空操作       | 旧本地 dream history         |
| 上下文归档 | 本地文件                    | 独立子系统                   |

Hindsight 作为 sidecar 集成，但仅用于：

- **召回**：`assemble()` 并行查询三个 bank（`memory.rs:209-217`）
- **回写**：`write_hindsight_experience` 写入经验笔记（`memory.rs:686-725`）

### 1.2 七个结构性缺陷

**D1：长期记忆召回仅关键词匹配。**
旧关键词记忆片段逻辑做 `haystack.contains(term)`。
标题为"项目架构决策"的笔记无法被"为什么选择了微服务"找到。

**D2：Hindsight 提取管线被绕过。**
CrawClaw 的 `experience` agent（后台 LLM 调用）先提取经验笔记，再写入 Hindsight。
两次 LLM 调用，且跳过了 Hindsight 的实体/关系归一化和 Observation 自动整合。

**D3：心智模型完全未使用。**
Hindsight 的 `create_mental_model` 和 `reflect` 从未被调用。梦境整合是空操作。

**D4：没有中文优化。**
缺少多语言嵌入（`BAAI/bge-m3`）、多语言重排序（`BAAI/bge-reranker-v2-m3`）、
CJK BM25 后端（`pgroonga`）的配置。

**D5：记忆隔离粒度粗。**
Durable memory 只按 `agentId` 隔离。Hindsight banks 硬编码为 `crawclaw:main:*`。

**D6：缺少反馈环路防护。**
注入的记忆可能被重新 retain 为新事实，导致重复和漂移。

**D7：资源 bank 形同虚设。**
`query_hindsight_resource` 存在但没有注入管线。

---

## 2. 设计目标

| 编号 | 目标                 | 成功标准                                                      |
| ---- | -------------------- | ------------------------------------------------------------- |
| G1   | Hindsight 作为主存储 | 除会话消息、会话摘要和上下文归档外，所有层通过 Hindsight 读写 |
| G2   | 自动捕获             | 每轮结束后自动 retain，不依赖 agent 决策                      |
| G3   | 自动注入             | 每轮开始前自动注入相关记忆到系统提示词                        |
| G4   | 语义召回             | 用 Hindsight 四路混合检索替代关键词匹配                       |
| G5   | 心智模型             | 梦境整合调用 reflect，预置常用心智模型                        |
| G6   | Observation 优先     | 召回默认用 `types: ["observation"]`，避免重复                 |
| G7   | 中文优先             | 默认配置多语言嵌入/重排序/CJK BM25                            |
| G8   | 可组合隔离           | Bank ID 由 `(agentId, channel, userId)` 派生                  |
| G9   | 反馈环路防护         | 注入的记忆标签在 retain 前被剥离                              |
| G10  | 离线降级             | Hindsight 不可用时跳过对应读写，不写本地兼容发件箱            |

---

## 3. 目标架构

### 3.1 层级映射

```
                     当前                                目标
                     ----                                ----
会话消息             SQLite runtime.db              -->  不变
会话摘要             session-summary/*.md           -->  Hindsight session bank + 本地文件
长期记忆             durable/<agentId>/*.md         -->  Hindsight durable bank + 本地文件
经验记忆             Hindsight experience bank      -->  Hindsight experience bank（自动保留）
资源记忆             （未实现）                      -->  Hindsight resource bank（注入管线）
心智模型             （未实现）                      -->  Hindsight mental-models bank（reflect）
梦境整合             history.json 空操作            -->  Hindsight reflect + 心智模型刷新
上下文归档           本地文件                        -->  不变
```

### 3.2 核心数据流

```
用户消息输入
    |
    v
+--- 提示词组装 -----------------------------------+
|  1. Hindsight recall（并行 4 个 bank）             |
|     - durable bank:  偏好、决策、事实              |
|     - experience bank: 流程、模式、教训            |
|     - resource bank:  文档、代码、参考             |
|     - mental-models bank: 预计算的高阶理解         |
|  2. 合并、去重（按 canonical_key）                 |
|  3. 过期提醒（>1 天的条目标注"请以当前状态为准"）  |
|  4. 注入系统提示词                                |
+--------------------------------------------------+
    |
    v
模型推理（agent 可选调用 knowledge_* 工具）
    |
    v
+--- 轮次结束后 -----------------------------------+
|  1. 剥离注入的记忆标签（反馈环路防护）            |
|  2. Hindsight retain（自动捕获）                  |
|     - 后台提取事实、实体、关系                    |
|     - 自动整合为 Observation                      |
|  3. 推进提取游标                                  |
|  4. 失败时记录 warn 并跳过本次 Hindsight 写入      |
+--------------------------------------------------+
    |
    v
+--- 梦境整合（定期） ------------------------------+
|  1. Hindsight reflect                             |
|     - 从积累的记忆中综合洞察                      |
|     - 生成新的 Observation 和 Mental Model 内容   |
|  2. 刷新标记了 auto-refresh 的心智模型            |
|  3. 记录到梦境历史                                |
+--------------------------------------------------+
```

### 3.3 三种记忆模式

参考 Hermes 集成的最佳实践，提供三种模式：

| 模式      | 行为                    | 默认 | 适用场景                  |
| --------- | ----------------------- | ---- | ------------------------- |
| `hybrid`  | 自动注入 + 暴露知识工具 | 是   | 通用场景                  |
| `context` | 仅自动注入，无工具      | -    | 简单对话、减少 token 开销 |
| `tools`   | 仅工具，无自动注入      | -    | agent 需要精确控制时机    |

---

## 4. Bank 拓扑

### 4.1 Bank ID 派生

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BankResolverConfig {
    /// 所有 bank ID 的前缀。默认："crawclaw"。
    pub prefix: String,
    /// 隔离维度。可选："agent"、"channel"、"user"。
    /// 默认：["agent"]。
    pub granularity: Vec<String>,
    /// 共享模式：所有上下文使用单一 bank。默认：false。
    pub shared_mode: bool,
    /// 共享模式下的静态 bank ID。默认："crawclaw:shared"。
    pub shared_bank_id: String,
}

pub struct BankContext {
    pub agent_id: String,
    pub channel: Option<String>,
    pub user_id: Option<String>,
}

impl BankResolverConfig {
    pub fn resolve(&self, ctx: &BankContext, layer: &str) -> String {
        if self.shared_mode {
            return format!("{}:{}", self.shared_bank_id, layer);
        }
        let mut parts = vec![self.prefix.clone()];
        for dim in &self.granularity {
            match dim.as_str() {
                "agent" => parts.push(ctx.agent_id.clone()),
                "channel" => { if let Some(ref v) = ctx.channel { parts.push(v.clone()); } }
                "user" => { if let Some(ref v) = ctx.user_id { parts.push(v.clone()); } }
                _ => {}
            }
        }
        parts.push(layer.to_string());
        parts.join(":")
    }
}
```

### 4.2 Bank 布局

默认（`granularity: ["agent"]`）：

```
crawclaw:main:durable         # 偏好、决策、稳定事实
crawclaw:main:experience      # 可复用流程、模式、教训
crawclaw:main:resource        # 文档、代码、参考
crawclaw:main:session         # 会话摘要
crawclaw:main:mental-models   # 预计算的高阶理解
```

按用户隔离（`granularity: ["agent", "user"]`）：

```
crawclaw:main:alice:durable
crawclaw:main:alice:experience
crawclaw:main:bob:durable
crawclaw:main:bob:experience
```

### 4.3 Bank 创建合约

首次使用时自动创建每个 bank：

```rust
fn ensure_bank(client: &HindsightClient, bank_id: &str, layer: &str, lang: &str) {
    let (name, mission) = match (layer, lang) {
        ("durable", "zh-CN") => ("长期记忆",
            "提取用户明确表达的偏好、重要的项目决策和稳定的知识事实。\
             跳过临时任务细节和一次性请求。"),
        ("experience", "zh-CN") => ("经验记忆",
            "记录成功的操作方法、失败的教训和可复用的工作流程。\
             关注可迁移的经验，而非特定任务的执行细节。"),
        ("resource", "zh-CN") => ("资源记忆",
            "存储项目文档、代码片段和参考资料的关键信息。\
             关注文档的核心内容和结构。"),
        ("session", "zh-CN") => ("会话记忆",
            "跨会话的摘要和连续性。保留未完成的意图和待办事项。"),
        ("mental-models", "zh-CN") => ("心智模型",
            "通过反思形成的高阶理解。整合零散记忆，形成对用户、\
             项目和工作模式的整体认知。"),
        _ => english_mission(layer),
    };

    client.create_bank(bank_id, CreateBankOptions {
        name: name.to_string(),
        mission: mission.to_string(),
        disposition: match layer {
            "experience" => Disposition { skepticism: 4, literalism: 3, empathy: 2 },
            "durable"    => Disposition { skepticism: 2, literalism: 4, empathy: 3 },
            "mental-models" => Disposition { skepticism: 3, literalism: 2, empathy: 3 },
            _ => Disposition { skepticism: 3, literalism: 3, empathy: 3 },
        },
    });
}
```

**Mission 的作用**：告诉 Hindsight 的提取引擎优先提取什么。没有 mission 时做
通用提取；有 mission 时只提取与任务相关的知识。

**Disposition 的作用**：控制 reflect 操作的推理风格——

- `skepticism`（怀疑度）：1=信任表面信息，5=寻找矛盾、多源验证
- `literalism`（字面度）：1=推断解读，5=严格按字面理解
- `empathy`（共情度）：1=优化正确性，5=重视人类影响和情感

---

## 5. 操作合约

### 5.1 自动保留（Retain）

#### 5.1.1 设计原则

> "OpenClaw's built-in memory depends on the agent deciding what to save — and
> models don't do this consistently." — Hindsight 官方

**核心改变**：每轮结束后自动调用 Hindsight `retain`，不依赖 agent 决策。
Hindsight 的后台提取管线自动处理事实、实体、关系的提取和 Observation 的整合。

#### 5.1.2 触发条件

- 顶层轮次稳定结束（非子 agent）
- 新消息包含最终助手回复
- 最新助手回复不包含工具调用
- 轮次未以 `error` 或 `aborted` 结束

#### 5.1.3 Payload 构建

```rust
fn compose_retain_payload(
    messages: &[Value],
    ctx: &BankContext,
    config: &RetainConfig,
) -> RetainPayload {
    // 1. 按角色过滤（默认：user + assistant）
    let filtered: Vec<_> = messages.iter()
        .filter(|m| config.retain_roles.contains(&m["role"].as_str().unwrap_or("").to_string()))
        .collect();

    // 2. 剥离注入的记忆标签（反馈环路防护）
    let cleaned: Vec<_> = filtered.iter().map(|m| strip_memory_tags(m)).collect();

    // 3. 格式化为对话记录
    let content = cleaned.iter()
        .map(|m| format!("{}: {}", m["role"].as_str().unwrap_or(""), extract_text(m)))
        .collect::<Vec<_>>()
        .join("\n\n");

    RetainPayload {
        content,
        context: "agent_turn".to_string(),
        timestamp: Some(Utc::now()),
        metadata: json!({
            "agentId": ctx.agent_id,
            "channel": ctx.channel,
            "userId": ctx.user_id,
        }),
        tags: vec![format!("agent:{}", ctx.agent_id), "layer:experience".to_string()],
    }
}
```

#### 5.1.4 反馈环路防护

> "The plugin automatically strips its own `<hindsight_memories>` tags before
> retention, preventing this loop." — Hindsight/OpenClaw 集成文档

retain 前必须剥离的标签：

```rust
fn strip_memory_tags(message: &Value) -> Value {
    let mut cleaned = message.clone();
    if let Some(content) = cleaned["content"].as_str() {
        let content = strip_tag(content, "hindsight_memories");
        let content = strip_tag(content, "durable_recall");
        let content = strip_tag(content, "experience_recall");
        let content = strip_tag(content, "resource_recall");
        let content = strip_tag(content, "mental_model_recall");
        cleaned["content"] = Value::String(content);
    }
    cleaned
}
```

#### 5.1.5 自动 Observation 整合

Hindsight 的 `retain` 调用后，后台整合引擎自动运行：

1. 分析新事实，与已有知识对比
2. 检测跨相关信息的模式
3. 综合 Observation（整合知识），捕获高阶洞察
4. 追踪证据链，将每个 Observation 关联到支撑它的原始事实

**不需要 CrawClaw 做任何额外工作**。这是 Hindsight 的核心能力。

#### 5.1.6 异步保留

高频场景下，设置 `retainAsync: true` 异步处理保留，不阻塞主循环。

#### 5.1.7 降级模式

Hindsight `retain` 失败时不再写本地兼容发件箱：

1. 记录 `warn` 级别日志
2. 跳过本次 Hindsight 写入
3. 保持会话本地状态可继续运行

---

### 5.2 自动召回（Recall）

#### 5.2.1 设计原则

> "Auto-recall solves this by injecting memories automatically before every turn.
> The agent doesn't need to know the memory system exists." — Hindsight/OpenClaw

**核心改变**：每轮开始前自动注入相关记忆到系统提示词，替代当前的
关键词匹配路径。

#### 5.2.2 查询构建

```rust
fn compose_recall_query(user_text: &str, messages: &[Value], config: &RecallConfig) -> String {
    let mut parts = vec![user_text.to_string()];

    // 包含最近轮次上下文
    let recent: Vec<_> = messages.iter().rev().take(config.recall_context_turns * 2).collect();
    for msg in recent.iter().rev() {
        let text = extract_text(msg);
        if !text.is_empty() {
            parts.push(format!("{}: {}", msg["role"].as_str().unwrap_or(""), text));
        }
    }

    let combined = parts.join("\n");
    // 中文感知截断（字符边界，非字节边界）
    truncate_at_sentence_boundary(&combined, config.recall_max_query_chars)
}
```

中文场景的截断策略：

```rust
fn truncate_at_sentence_boundary(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max_chars).collect();
    // 优先在句子边界截断
    truncated.rfind(|c: char| c == '。' || c == '！' || c == '？' || c == '.' || c == '!' || c == '?')
        .map(|pos| truncated[..pos + 1].to_string())
        .unwrap_or(truncated)
}
```

#### 5.2.3 并行召回

```rust
async fn parallel_recall(&self, query: &str, ctx: &BankContext) -> Vec<UnifiedRecallItem> {
    let resolver = self.bank_resolver();

    let (durable, experience, resource, mental_models) = tokio::join!(
        safe_recall(&self.client, &resolver.resolve(ctx, "durable"), query,
            &["world", "observation"], "durable", &self.config),
        safe_recall(&self.client, &resolver.resolve(ctx, "experience"), query,
            &["experience", "observation"], "experience", &self.config),
        safe_recall(&self.client, &resolver.resolve(ctx, "resource"), query,
            &["resource", "document", "source_fact"], "resource", &self.config),
        safe_recall(&self.client, &resolver.resolve(ctx, "mental-models"), query,
            &["observation"], "mental-models", &self.config),
    );

    let mut all = Vec::new();
    for result in [durable, experience, resource, mental_models] {
        match result {
            Ok(items) => all.extend(items),
            Err(e) => tracing::warn!(?e, "hindsight_recall_bank_failed"),
        }
    }

    // 去重 + 排序
    all.sort_by(|a, b| b.retrieval_score.partial_cmp(&a.retrieval_score).unwrap());
    all.dedup_by(|a, b| a.canonical_key == b.canonical_key);

    // 过期提醒
    for item in &mut all {
        if item.is_stale() {
            item.summary = format!("{} (注意：此记忆可能已过时，请以当前代码/文件为准)", item.summary);
        }
    }

    enforce_token_budget(all, self.config.max_tokens)
}
```

#### 5.2.4 Hindsight Recall Payload

```rust
fn hindsight_recall_payload(config: &HindsightConfig, query: &str, types: &[&str], layer: &str) -> Value {
    json!({
        "query": query,
        "types": types,
        "budget": config.default_budget,
        "max_tokens": config.max_tokens,
        "tags": hindsight_layer_tags(config, layer),
        "tags_match": config.tags_match,
        "include": {
            "entities": { "max_tokens": 500 },
            "chunks": { "max_tokens": 1000 },
            "source_facts": { "max_tokens": 2048 }
        }
    })
}
```

**关键设计决策**：不在 CrawClaw 侧做重排序。Hindsight 的四路混合检索
（语义 + BM25 + 图 + 时间）+ RRF 融合 + cross-encoder 重排序经过
BEAM 10M benchmark 验证（64.1%，比第二名高 58%）。

#### 5.2.5 Observation 优先

> "Observations unify entity summaries and opinions into a single, more
> expressive system." — Hindsight 0.4.0 博客

召回默认使用 `types: ["observation"]`。Observation 是整合去重后的视图，
避免同一答案从多个原始事实中重复出现。

| 原始事实               | Observation                                         |
| ---------------------- | --------------------------------------------------- |
| "Alice 偏好 Python"    | "Alice 是 Python 为主的开发者，重视可读性和简洁性， |
| "Alice 不喜欢冗长代码" | 推荐使用类型提示，偏好 pytest 测试"                 |
| "Alice 推荐类型提示"   |                                                     |

Observation 的关键特性：

- **证据追踪**：关联支撑它的原始事实
- **时间演化**：保留完整演变历程（"用户之前偏好 React，后来切换到了 Vue"）
- **自动整合**：每次 retain 后自动更新

---

### 5.3 反思（Reflect）与心智模型

#### 5.3.1 心智模型是什么

心智模型是**预计算的、策展过的 reflect 响应**。

层级关系：

```
原始事实 (world)         -- 单次对话提取的离散事实
    ↓ 自动整合
观察 (observation)       -- 多条事实 → 一条整合洞察
    ↓ 预计算 reflect
心智模型 (mental model)  -- 对常见问题的预计算完整回答
```

心智模型 vs Observation 的区别：

| 维度     | Observation                   | 心智模型                                            |
| -------- | ----------------------------- | --------------------------------------------------- |
| 创建方式 | retain 后自动整合             | 显式创建（API 调用）或梦境反思                      |
| 粒度     | 事实导向（"张三偏好 Python"） | 回答导向（"张三是什么样的开发者？完整的回答是..."） |
| 更新方式 | 每次 retain 增量更新          | 手动刷新或 `trigger_refresh_after_consolidation`    |
| 使用方式 | 通过 recall 检索              | reflect 优先检查；也可直接查询                      |
| 一致性   | 可能因新事实而变化            | 同一问题每次得到相同回答                            |

心智模型的关键优势：

- **一致性**：同一问题每次得到相同回答
- **速度**：预计算，直接查询无需 LLM 推理（可绕过 reflect）
- **可控性**：可以策展、编辑、删除

#### 5.3.2 预置心智模型

首次梦境整合时自动创建：

```rust
const DEFAULT_MENTAL_MODELS_ZH: &[(&str, &str)] = &[
    ("用户偏好", "用户的长期偏好、习惯、沟通风格是什么？"),
    ("项目知识", "当前项目的技术栈、架构决策、已知问题是什么？"),
    ("工作模式", "用户常见的工作流程、重复出现的模式是什么？"),
    ("决策历史", "过去做过的重要决策及其理由是什么？"),
];

fn ensure_default_mental_models(client: &HindsightClient, bank_id: &str) -> Result<(), String> {
    let existing = client.list_mental_models(bank_id)?;
    for (name, query) in DEFAULT_MENTAL_MODELS_ZH {
        if !existing.iter().any(|m| m.name == *name) {
            client.create_mental_model(bank_id, CreateMentalModelOptions {
                name: name.to_string(),
                source_query: query.to_string(),
                tags: vec!["auto".to_string(), "dream".to_string()],
                trigger_refresh_after_consolidation: true,
                max_tokens: 2048,
            })?;
        }
    }
    Ok(())
}
```

`trigger_refresh_after_consolidation: true` 表示每次新的 Observation 整合后，
心智模型自动用最新记忆重新生成，保持知识最新。

#### 5.3.3 梦境整合流程

```rust
async fn dream_consolidate(&self, session_id: &str, config: &DreamingConfig) -> Result<Value, String> {
    // 1. 节流检查
    if !self.is_dream_due(session_id, config)? {
        return Ok(json!({ "status": "skipped", "reason": "not_due" }));
    }

    let ctx = BankContext { agent_id: "main".to_string(), .. };
    let resolver = self.bank_resolver();

    // 2. 构建反思查询（含最近会话摘要）
    let recent = self.recent_session_summaries(session_id, 5)?;
    let query = compose_reflection_query(&recent);

    // 3. Hindsight reflect
    let bank_id = resolver.resolve(&ctx, "durable");
    let reflection = self.hindsight_reflect(&bank_id, &query, "high", 2048).await?;

    // 4. 存储为心智模型
    let mm_bank = resolver.resolve(&ctx, "mental-models");
    self.hindsight_retain(&mm_bank, &reflection.text, "dream_consolidation",
        json!({ "source": "dream", "sessionId": session_id }),
        &["agent:main", "layer:mental-model"]).await?;

    // 5. 刷新标记了 auto-refresh 的心智模型
    // （Hindsight 自动处理，这里只需记录结果）
    let models = self.hindsight_list_mental_models(&mm_bank).await?;
    let refreshed = models.iter()
        .filter(|m| m.trigger_refresh_after_consolidation)
        .count();

    // 6. 返回反思结果；调用方负责记录状态
    Ok(json!({ "status": "completed", "reflection": reflection.text, "modelsRefreshed": refreshed }))
}
```

#### 5.3.4 心智模型的两种查询方式

**方式一：通过 reflect 自动使用**

```rust
// reflect 操作自动优先检查心智模型
let answer = client.reflect(bank_id, "用户喜欢什么样的沟通风格？", ReflectOptions {
    budget: "low".to_string(),  // 已有心智模型时，low budget 即可
    ..Default::default()
});
// 如果命中心智模型，直接返回预计算的答案
```

**方式二：直接查询（绕过 LLM）**

```rust
// 通过 ID 直接获取，无需 LLM 推理，最快
let model = client.get_mental_model(bank_id, "用户偏好");
print(model.content);  // 预计算的答案，即时返回
```

---

### 5.4 资源注入

#### 5.4.1 触发器

| 触发器         | 时机                         | 范围         |
| -------------- | ---------------------------- | ------------ |
| 显式命令       | 用户调用 `knowledge_ingest`  | 指定文件/URL |
| AGENTS.md 变更 | Git hook 检测                | 变更的文件   |
| 文档变更       | Git hook 检测 `docs/**/*.md` | 变更的文件   |

#### 5.4.2 注入管线

```rust
async fn ingest_resource(&self, bank_id: &str, path: &str, content: &str) -> Result<Value, String> {
    let chunks = chunk_document(content, 2000, 200);
    let doc_id = hash_content(content);

    for (i, chunk) in chunks.iter().enumerate() {
        self.hindsight_retain(bank_id, chunk, "document_ingest",
            json!({ "path": path, "chunkIndex": i, "totalChunks": chunks.len(),
                    "language": detect_language(chunk) }),
            &["agent:main", "layer:resource", "kind:document"]).await?;
    }

    Ok(json!({ "status": "ok", "documentId": doc_id, "chunksIngested": chunks.len() }))
}
```

---

### 5.5 知识工具

当 `memory.hindsight.enableKnowledgeTools` 为 true 时暴露：

| 工具                     | Hindsight API         | 说明                           |
| ------------------------ | --------------------- | ------------------------------ |
| `knowledge_recall`       | `recall`              | 显式记忆搜索                   |
| `knowledge_reflect`      | `reflect`             | 深度综合（生成心智模型级回答） |
| `knowledge_ingest`       | `retain` (batch)      | 注入文档/代码                  |
| `knowledge_forget`       | `delete`              | 删除特定记忆                   |
| `knowledge_model_create` | `create_mental_model` | 创建心智模型                   |
| `knowledge_model_list`   | `list_mental_models`  | 列出心智模型                   |
| `knowledge_model_get`    | `get_mental_model`    | 直接获取心智模型（无需 LLM）   |

---

## 6. 中文语言策略

### 6.1 问题

| 问题                             | 原因                                    |
| -------------------------------- | --------------------------------------- |
| 中文关键词搜不到                 | BM25 用英文分词器，中文无空格分词       |
| 召回结果偏英文                   | 默认嵌入模型 `bge-small-en-v1.5` 仅英文 |
| "微服务"和"microservice"召回不同 | BM25 臂是单语言的                       |
| 中文实体被音译                   | LLM 输出语言设为英文                    |

### 6.2 Hindsight 部署配置（中文必需）

```bash
# 嵌入模型（必需）
HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-m3

# 重排序模型（必需）
HINDSIGHT_API_RERANKER_LOCAL_MODEL=BAAI/bge-reranker-v2-m3

# BM25 后端（必需）
HINDSIGHT_API_TEXT_SEARCH_EXTENSION=pgroonga

# LLM 输出语言（留空 = 跟随输入语言）
# HINDSIGHT_API_LLM_OUTPUT_LANGUAGE=Chinese
```

### 6.3 CrawClaw 侧配置

```json5
{
  memory: {
    hindsight: {
      languageHints: {
        // 主要语言。"auto" = 自动检测，"zh-CN" = 强制中文
        primaryLanguage: "auto",
        // 技术术语双语展开（"微服务" ↔ "microservice"）
        bilingualTechnicalTerms: true,
      },
    },
  },
}
```

### 6.4 双语术语展开

对中英混杂的技术内容，扩展召回查询：

```rust
fn expand_bilingual_terms(query: &str) -> String {
    let pairs = [
        ("微服务", "microservice"), ("网关", "gateway"), ("插件", "plugin"),
        ("记忆", "memory"), ("会话", "session"), ("配置", "config"),
        ("部署", "deploy"), ("测试", "test"), ("数据库", "database"),
        ("缓存", "cache"), ("容器", "container"), ("集群", "cluster"),
        ("监控", "monitor"), ("日志", "log"), ("消息队列", "message queue"),
        ("负载均衡", "load balancer"),
    ];
    let mut expanded = query.to_string();
    for (zh, en) in &pairs {
        if query.contains(zh) && !query.contains(en) {
            expanded.push_str(&format!(" {}", en));
        } else if query.contains(en) && !query.contains(zh) {
            expanded.push_str(&format!(" {}", zh));
        }
    }
    expanded
}
```

嵌入模型（bge-m3）已处理跨语言相似度，但显式展开帮助 BM25 臂。

### 6.5 中文场景常见问题

| 问题                    | 原因               | 对策                              |
| ----------------------- | ------------------ | --------------------------------- |
| 召回全是英文            | 默认嵌入仅英文     | 部署时配 `BAAI/bge-m3`            |
| 中文关键词搜不到        | BM25 英文分词      | 配 `pgroonga`                     |
| "微服务"≠"microservice" | BM25 单语言        | 启用 `bilingualTechnicalTerms`    |
| 实体被音译              | LLM 输出语言设英文 | 不设 `LLM_OUTPUT_LANGUAGE`        |
| 心智模型全英文          | 默认名称英文       | 按 `primaryLanguage` 用中文默认值 |
| 截断破坏中文            | 按字节截断         | 用 `chars().count()` 字符迭代器   |

---

## 7. 完整配置 Schema

```json5
{
  memory: {
    // "builtin" = 当前行为 | "hindsight" = Hindsight 原生
    backend: "builtin",

    runtimeStore: { type: "sqlite", dbPath: "~/.crawclaw/memory-runtime.db" },
    durableExtraction: { enabled: true },
    experience: { enabled: true, recentMessageLimit: 24, maxNotesPerTurn: 2 },
    dreaming: { enabled: true, minHours: 4, minSessions: 3 },
    sessionSummary: { enabled: true, minTokensToInit: 500 },

    hindsight: {
      enabled: false,

      // 连接
      baseUrl: "",
      apiKey: "",
      apiKeyEnv: "",
      timeoutMs: 15_000,

      // Bank 拓扑
      bankPrefix: "crawclaw",
      bankGranularity: ["agent"], // "agent", "channel", "user"
      sharedMode: false,
      sharedBankId: "crawclaw:shared",
      durableBank: "auto",
      experienceBank: "auto",
      resourceBank: "auto",
      sessionBank: "auto",
      mentalModelsBank: "auto",

      // 记忆模式
      memoryMode: "hybrid", // "hybrid", "context", "tools"

      // 自动保留
      autoRetain: true,
      retainRoles: ["user", "assistant"],
      retainEveryNTurns: 1,
      retainOverlapTurns: 0,
      retainAsync: false,

      // 自动召回
      defaultBudget: "mid",
      maxTokens: 2048,
      recallContextTurns: 1,
      recallMaxQueryChars: 800,
      recallTypes: ["observation"],
      recallInjectionPosition: "prepend",

      // 反思
      autoReflect: true,
      reflectBudget: "high",
      reflectMaxTokens: 2048,

      // 心智模型
      defaultMentalModels: true,

      // 知识工具
      enableKnowledgeTools: false,

      // 标签
      tagsMatch: "all_strict",
      tags: ["agent:main"],

      // 语言
      languageHints: { primaryLanguage: "auto", bilingualTechnicalTerms: true },
    },

    contextArchive: { enabled: false, mode: "off" },
  },
}
```

---

## 8. 代码变更

### 8.1 新增文件

| 文件                         | 用途                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `memory/hindsight_client.rs` | Hindsight HTTP 客户端（retain/recall/reflect/mental-models） |
| `memory/bank_resolver.rs`    | Bank ID 派生                                                 |
| `memory/feedback_guard.rs`   | 记忆标签剥离（反馈环路防护）                                 |
| `memory/retain_pipeline.rs`  | 自动保留管线                                                 |
| `memory/recall_pipeline.rs`  | 统一召回管线                                                 |
| `memory/reflect_pipeline.rs` | 梦境 → 反思 → 心智模型                                       |

### 8.2 修改文件

| 文件                | 变更                                    |
| ------------------- | --------------------------------------- |
| `memory.rs`         | 重构为模块目录；接入 Hindsight 原生管线 |
| `agent_context.rs`  | 用 Hindsight 召回替代旧关键词记忆片段   |
| `special_agents.rs` | 添加知识工具允许列表                    |
| `core_tools.rs`     | 注册知识工具                            |

### 8.3 模块结构

```
crates/crawclaw-runtime/src/memory/
  mod.rs                   # 重导出、execute_memory_runtime_operation
  config.rs                # 所有配置结构体
  runtime_store.rs         # SQLite 会话消息
  session_summary_store.rs # 会话摘要
  hindsight_client.rs      # Hindsight HTTP 客户端
  bank_resolver.rs         # Bank ID 派生
  feedback_guard.rs        # 记忆标签剥离
  retain_pipeline.rs       # 自动保留
  recall_pipeline.rs       # 统一召回
  reflect_pipeline.rs      # 梦境反思
  helpers.rs               # 共享工具
  tests                    # 模块内单元测试
```

---

## 9. 错误处理

### 9.1 Hindsight 不可用

| 操作         | 行为                                      |
| ------------ | ----------------------------------------- |
| 保留         | 记录警告，跳过本次 Hindsight 写入         |
| 召回         | 跳过 Hindsight 召回，仅保留本地会话上下文 |
| 反思         | 跳过梦境整合，下一周期重试                |
| 心智模型刷新 | 跳过                                      |

### 9.2 部分失败

并行召回部分失败时，成功的 bank 结果正常返回，失败的记录警告继续：

```rust
for result in [durable, experience, resource, mental_models] {
    match result {
        Ok(items) => all.extend(items),
        Err(e) => tracing::warn!(?e, "hindsight_recall_bank_failed"),
    }
}
```

---

## 10. 测试策略

### 10.1 单元测试

| 测试                               | 验证                         |
| ---------------------------------- | ---------------------------- |
| `bank_resolver_derives_ids`        | 所有粒度组合的 ID 派生       |
| `feedback_guard_strips_tags`       | 所有记忆标签被剥离           |
| `feedback_guard_preserves_content` | 非记忆内容不被修改           |
| `compose_recall_query_chinese`     | 中文句子边界截断             |
| `expand_bilingual_terms`           | 术语展开                     |
| `retain_payload_construction`      | 正确的元数据和标签           |
| `hindsight_recall_payload`         | 每层正确的 budget/types/tags |

### 10.2 集成测试

| 测试                             | 验证                           |
| -------------------------------- | ------------------------------ |
| `retain_recall_roundtrip`        | 保留事实 → 召回事实            |
| `observation_auto_consolidation` | retain 后自动生成 Observation  |
| `mental_model_create_and_query`  | 创建心智模型 → 直接查询        |
| `mental_model_auto_refresh`      | retain 后心智模型自动刷新      |
| `reflect_uses_mental_models`     | reflect 优先返回心智模型       |
| `feedback_loop_prevention`       | 注入记忆不被重新 retain        |
| `degraded_mode_no_outbox`        | 失败 retain 不写本地兼容发件箱 |
| `chinese_recall_quality`         | 中文查询返回中文结果           |

### 10.3 性能测试

| 测试                      | 目标                |
| ------------------------- | ------------------- |
| `recall_latency_p95`      | 单 bank < 500ms     |
| `retain_latency_p95`      | 单轮 < 2s           |
| `parallel_recall_latency` | 4 bank 并行 < 800ms |

---

## 11. 实施阶段

### 阶段 0：基础（1-2 周）

- [x] 重构 `memory.rs` 为模块目录
- [x] 实现 `MemoryBankResolver`
- [x] 实现 `HindsightClient`（retain/recall/reflect/mental-models）
- [x] 实现 `feedback_guard`
- [x] 扩展 `HindsightConfig`（不保留旧兼容配置面）
- [x] 单元测试
- 验证：`cargo test -p crawclaw-runtime memory::`

### 阶段 1：自动保留（1 周）

- [x] 实现 `retain_pipeline`
- [x] 接入 `after_turn` 自动 retain
- [x] 反馈环路防护
- [x] 离线降级为跳过本次 Hindsight 写入
- 验证：`cargo test -p crawclaw-runtime memory::retain`

### 阶段 2：自动召回（1 周）

- [x] 实现 `recall_pipeline`
- [x] 替代 `assemble()` 和旧关键词记忆片段
- [x] Observation 优先召回
- [x] 中文查询构建和双语展开
- 验证：`cargo test -p crawclaw-runtime memory::recall`

### 阶段 3：心智模型与反思（1 周）

- [x] 实现 `reflect_pipeline`
- [x] 预置默认心智模型
- [x] 梦境 → reflect → 心智模型刷新
- 验证：`cargo test -p crawclaw-runtime memory::reflect`

### 阶段 4：资源注入与知识工具（1 周）

- [x] 通过 `knowledge_ingest` 实现资源注入
- [x] 注册知识工具
- 验证：`cargo test -p crawclaw-runtime memory::tools`

### 阶段 5：中文优化（与其他阶段并行）

- [x] `languageHints` 配置
- [x] 中文查询截断
- [x] 双语术语展开
- [x] 中文心智模型默认值
- [x] Hindsight 部署文档（bge-m3、pgroonga）

---

## 12. 待决决策

| 编号 | 问题                             | 建议                                 |
| ---- | -------------------------------- | ------------------------------------ |
| D1   | Desktop 内嵌 `hindsight-embed`？ | 是（参考 Hermes 模式）               |
| D2   | 高频会话的保留节流？             | 每轮 + `retainAsync: true`           |
| D3   | 心智模型质量验证？               | 初期信任 Hindsight，后续加检查工具   |
| D4   | 提取用独立 LLM？                 | 是，用小模型（gpt-5-mini）控制成本   |
| D5   | 记忆衰减？                       | 初期不实现，Hindsight 时间检索已足够 |
| D6   | Directives 用于硬规则？          | 是，用 Directives 设置安全/合规约束  |
