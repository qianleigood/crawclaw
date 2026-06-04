---
read_when:
  - 你想配置 CrawClaw 记忆
  - 你想启用 Hindsight 支持的经验回忆
  - 你想调优会话摘要或梦境整合
summary: Hindsight 原生记忆运行时和会话摘要的配置键
title: 记忆配置参考
x-i18n:
  generated_at: "2026-06-04T03:24:21Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 0816a2e375b88524fbacdff0f6c81898d9d8e174ff936cf8f97d6b7c7f36f18a
  source_path: reference/memory-config.md
  workflow: 15
---

# 记忆配置参考

CrawClaw 记忆配置位于顶级 `memory` 键下。旧的每个智能体搜索配置已被移除。

关于概念模型，请从以下内容开始：

- [记忆概览](/concepts/memory)
- [内置记忆运行时](/concepts/memory-builtin)

## 运行时存储

| 键                           | 类型     | 默认值                          | 描述              |
| ---------------------------- | -------- | ------------------------------- | ----------------- |
| `memory.runtimeStore.dbPath` | `string` | `~/.crawclaw/memory-runtime.db` | SQLite 数据库路径 |

```json5
{
  memory: {
    runtimeStore: {
      dbPath: "~/.crawclaw/memory-runtime.db",
    },
  },
}
```

## Hindsight

Hindsight 是面向提示词的经验回忆和经验回写的提供商。当前回写通过 Hindsight 知识摄取路径，不保留重复的本地载荷。Hindsight 负责经验回忆期间的语义相关性和排序；CrawClaw 保留提供商顺序，仅应用本地防护栏，如源过滤、去重、空内容检查和提示词预算限制。

Hindsight 作为 sidecar 或远程服务运行。CrawClaw 仅存储端点、bank 名称、超时和回忆策略；Python、Postgres、嵌入模型和 reranker 属于 Hindsight 部署。对于中文密集型回忆，请使用多语言 Hindsight 配置，如 `BAAI/bge-m3` 嵌入加上 `BAAI/bge-reranker-v2-m3` 重排序，并配置最能支持中文关键词分词的 Hindsight 文本搜索扩展。

对于中文和混合中英文项目，CrawClaw 还在 Hindsight 调用前后应用本地质量防护。长的保留载荷按中英文句子边界拆分，并附带小重叠元数据；当 `memory.hindsight.languageHints.bilingualTechnicalTerms` 启用时，回忆查询通过双语技术别名重写，返回项目在进入提示词预算前通过最小相关性评分本地过滤。这些默认值无需调优即可工作，高级部署可以在 `memory.hindsight.quality` 下覆盖它们。

当未配置显式 Hindsight 端点时，CrawClaw Desktop 准备本地 `hindsight-embed` sidecar。Desktop 打包将固定的 Hindsight 发布二进制文件暂存到嵌入式运行时，并在构建应用包之前验证其 sha256；构建操作员可以用 `CRAWCLAW_HINDSIGHT_EMBED_BIN` 覆盖源。Desktop 策略覆盖可以向运行时提供本地 `baseUrl` 和生命周期状态。如果 sidecar 二进制文件缺失，Desktop 保持 Hindsight 禁用并报告不可用的生命周期，而不是创建永久失败的发件箱。

| 键                                                       | 类型      | 默认值              | 描述                                                  |
| -------------------------------------------------------- | --------- | ------------------- | ----------------------------------------------------- |
| `memory.hindsight.enabled`                               | `boolean` | `false`             | 启用 Hindsight 回忆和回写                             |
| `memory.hindsight.baseUrl`                               | `string`  | `""`                | Hindsight HTTP API 基础 URL                           |
| `memory.hindsight.apiKey`                                | `string`  | `""`                | Hindsight API 的可选 bearer 令牌                      |
| `memory.hindsight.apiKeyEnv`                             | `string`  | `""`                | 包含 bearer 令牌的环境变量名                          |
| `memory.hindsight.bankPrefix`                            | `string`  | `crawclaw`          | 派生 Hindsight banks 的前缀                           |
| `memory.hindsight.bankGranularity`                       | `array`   | `agent`             | 用于派生 bank ID 的维度                               |
| `memory.hindsight.sharedMode`                            | `boolean` | `false`             | 使用一个共享 Hindsight bank                           |
| `memory.hindsight.sharedBankId`                          | `string`  | `crawclaw:shared`   | 共享模式启用时的共享 bank ID                          |
| `memory.hindsight.memoryMode`                            | `string`  | `hybrid`            | `hybrid`、`context` 或 `tools` 回忆模式               |
| `memory.hindsight.autoRetain`                            | `boolean` | `true`              | 自动保留符合条件的已完成轮次                          |
| `memory.hindsight.retainRoles`                           | `array`   | `user`、`assistant` | 符合保留载荷条件的角色                                |
| `memory.hindsight.retainEveryNTurns`                     | `number`  | `1`                 | 自动保留的符合条件的轮次间隔                          |
| `memory.hindsight.retainOverlapTurns`                    | `number`  | `0`                 | 保留时包含的先前轮次                                  |
| `memory.hindsight.retainAsync`                           | `boolean` | `false`             | 兼容性标志；轮次结束保留使用运行时发件箱              |
| `memory.hindsight.defaultBudget`                         | `string`  | `mid`               | 回忆预算：`low`、`mid` 或 `high`                      |
| `memory.hindsight.maxTokens`                             | `number`  | `2048`              | Hindsight 回忆的最大令牌数                            |
| `memory.hindsight.recallContextTurns`                    | `number`  | `1`                 | 用于组合回忆查询的最近轮次                            |
| `memory.hindsight.recallMaxQueryChars`                   | `number`  | `800`               | 最大回忆查询字符数                                    |
| `memory.hindsight.recallTypes`                           | `array`   | `observation`       | 回忆中请求的 Hindsight 记忆类型                       |
| `memory.hindsight.recallInjectionPosition`               | `string`  | `prepend`           | 回忆注入到模型上下文的位置                            |
| `memory.hindsight.autoReflect`                           | `boolean` | `true`              | 启用梦境时间反思                                      |
| `memory.hindsight.reflectBudget`                         | `string`  | `high`              | 反思调用的 Hindsight 预算                             |
| `memory.hindsight.reflectMaxTokens`                      | `number`  | `2048`              | 反思输出的最大令牌数                                  |
| `memory.hindsight.defaultMentalModels`                   | `boolean` | `true`              | 维护默认心智模型 banks                                |
| `memory.hindsight.enableKnowledgeTools`                  | `boolean` | `false`             | 在非 context-only 模式下允许配置的 knowledge 工具访问 |
| `memory.hindsight.tagsMatch`                             | `string`  | `all_strict`        | 回忆过滤器的标签匹配模式                              |
| `memory.hindsight.tags`                                  | `array`   | `agent:main`        | 随 Hindsight 操作发送的基本标签                       |
| `memory.hindsight.timeoutMs`                             | `number`  | `15000`             | Hindsight 调用的 HTTP 超时                            |
| `memory.hindsight.languageHints.primaryLanguage`         | `string`  | `auto`              | bank 描述的语言提示                                   |
| `memory.hindsight.languageHints.bilingualTechnicalTerms` | `boolean` | `true`              | 扩展中文和英文技术术语                                |
| `memory.hindsight.quality.retainChunkMaxChars`           | `number`  | 按语言默认          | 覆盖最大保留块字符数                                  |
| `memory.hindsight.quality.retainChunkOverlapChars`       | `number`  | 按语言默认          | 覆盖保留块重叠字符数                                  |
| `memory.hindsight.quality.recallMinScore`                | `number`  | 按语言默认          | 覆盖本地最小回忆相关性评分                            |
| `memory.hindsight.quality.recallRerankTopK`              | `number`  | 按语言默认          | 在提示词预算修剪前覆盖 top reranked 回忆项目数        |
| `memory.hindsight.quality.queryRewrite`                  | `boolean` | 按语言默认          | 覆盖中文密集型确定性查询重写                          |

`memory.hindsight.memoryMode` 控制提示词回忆和工具访问：

- `hybrid`：启用提示词回忆，配置的 knowledge 工具可被允许的运行时面使用。
- `context`：启用提示词回忆，knowledge 工具访问被禁用。
- `tools`：禁用提示词回忆，配置的 knowledge 工具是显式访问路径。

自动轮次结束保留与此提示词回忆模式分开。当 Hindsight 启用且自动保留启用时，符合条件的已完成轮次排队 Hindsight `experience` 保留任务。网关运行自动发件箱工作器；`memory.outbox.process` 是手动排出入口。

## 梦境和摘要

| 键                                              | 描述                     |
| ----------------------------------------------- | ------------------------ |
| `memory.dreaming.enabled`                       | 启用 Hindsight 反思任务  |
| `memory.dreaming.minHours`                      | 梦境扫描之间的最小小时数 |
| `memory.dreaming.minSessions`                   | 整合前的最小会话数       |
| `memory.sessionSummary.enabled`                 | 启用会话摘要维护         |
| `memory.sessionSummary.minTokensToInit`         | 首次摘要前的令牌阈值     |
| `memory.sessionSummary.minTokensBetweenUpdates` | 更新之间的令牌增长阈值   |
| `memory.sessionSummary.toolCallsBetweenUpdates` | 更新之间的工具调用阈值   |
