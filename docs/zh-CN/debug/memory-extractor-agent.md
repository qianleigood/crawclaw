---
read_when:
  - 想把 durable memory 自动补写重构成后台 agent 时
  - 想看 memory_extractor 的输入、触发规则、能力边界和 rollout 顺序时
  - 想把 Claude 式补写规则映射到 CrawClaw 当前 runtime 时
summary: CrawClaw durable memory 自动补写重构成后台 memory_extractor agent 的设计方案
title: Memory Extractor Agent 设计
---

# Memory Extractor Agent 设计

这份文档记录的是已经落地的重构方向：

**把 CrawClaw 的 durable memory 自动补写，从原先的 `afterTurn -> structured extraction worker`，重构成一个受限的后台 `memory_extractor` agent。**

这条线的目标不是模仿 Claude 的全部实现细节，而是借它的两个优点：

- 补写规则更完整
- 执行形态更适合后台维护，不阻塞主链

## 为什么要重构

原先那条 durable auto-write 路径有三个结构性问题：

1. 触发点过早  
   现在主要挂在 `afterTurn`，更像“有新消息就考虑提炼”，不够像“本轮已经稳定结束，再做补写”。

2. 窗口过窄  
   现在实际输入接近“本轮新增消息里的最后 8 条 user/assistant 可见文本”，容易漏掉本轮前半段的重要反馈。

3. `feedback` 语义不完整  
   现在更偏纠错，而 Claude 的规则更接近：
   - 错误纠正要记
   - 非显然但被确认有效的成功做法也要记

所以这次重构的核心不是“换个 prompt”，而是：

**同时重做 lifecycle、窗口定义和执行载体。**

## 最终目标

最终 durable auto-write 应该变成：

- 只在顶层稳定回合结束后触发
- 只处理 extraction cursor 之后新增的 model-visible messages
- 显式 durable write/delete 优先，后台补写自动跳过
- `write_experience_note` 不再抑制 durable extraction
- `feedback` 支持 corrective + reinforcing
- 运行在一个 task-backed 的后台 special agent 里
- Action Feed、Context Archive、inspect 都能看到这条后台工作

一句话：

**它应该是一个受限的 memory maintenance agent，不是一个裸 LLM helper。**

## 当前实现状态

截至当前版本，这条线的主链已经落地：

- 已切成 cursor-based 增量窗口
- 已去掉 `write_experience_note` 对 durable extraction 的抑制
- 已补上 `feedback` 双向 guidance
- 已改成 task-backed background `memory_extractor`
- extraction agent 现在有 `maxTurns: 5` 的硬上限
- 提示词流程已对齐 Claude：先看 manifest、先判断候选更新项，再在 5 回合预算内集中完成 durable 写入
- Claude 风格的 scoped memory file tools 也已经接进去：
  - `memory_manifest_read`
  - `memory_note_read`
  - `memory_note_write`
  - `memory_note_edit`
  - `memory_note_delete`
- 已接上 Action Feed 和 Context Archive
- memory_extraction child session 现在会显式继承 durable scope

对这次主重构本身来说，现在已经没有阻塞性 follow-up。

当前触发语义已经更严格地对齐到“顶层稳定回合结束”：

- `afterTurn` 只会在 post-turn finalization 之后被调用
- 只有当这一轮新增消息里已经出现最终 assistant 回复时，才会调度
  `memory_extractor`
- 如果最新 assistant 还停在 tool call 阶段，或者以 `error` / `aborted`
  结束，这一轮就直接跳过 durable extraction
- worker-manager 会直接拒绝 subagent session，所以自动 durable extraction
  仍然只跑在顶层 session 主链

后续剩下的是可观测性和产品化打磨，不再是另一轮核心架构改造。

## 形态选择

### 为什么不继续保留原先的 structured extraction worker

当前 worker 的优点是：

- 实现简单
- 结构化输出稳定
- 本地 upsert 容易控制

但它的局限也很明显：

- 没有完整 agent 级可观测性
- 没有独立 task
- 很难自然接进 Action Feed
- 更像 runtime 内部 helper，而不是一个真正后台维护任务

### 为什么不用照搬 Claude 的 file-native forked extractor

Claude 的 forked agent 直接写 memory 文件，这在 Claude 那边成立，但 CrawClaw 已经有更好的底座：

- task-backed runtime
- guard / capability policy
- Action Feed
- Context Archive
- durable store upsert

所以更合理的做法是：

- **执行形态学 Claude**
- **存储与 upsert 继续用 CrawClaw 现有 durable store**

## 核心设计

### Agent 身份

新增一个特殊内建 agent profile：

- `agentId: memory_extractor`
- `spawnSource: "memory-extraction"`
- `mode: background`
- task-backed
- 默认不出现在普通聊天 transcript 中

它和 verifier 的关系类似：

- verifier 是只读验证 agent
- memory_extractor 是只写 durable memory 的维护 agent

### 触发规则

只有满足这些条件时才触发：

1. 当前是顶层主 session
2. durable auto-write 已启用
3. 一次稳定回合结束
4. 自上次 extraction cursor 之后存在新增 model-visible messages
5. 本轮没有显式 durable write 或 delete

明确 **不** 作为 skip 条件：

- `write_experience_note`

### 输入契约

传给 `memory_extractor` 的上下文必须是窄且结构化的：

```ts
type MemoryExtractorInput = {
  sessionId: string;
  sessionKey: string;
  scope: {
    scopeKey: string;
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
  cursorAfter?: {
    messageId?: string;
    turn?: number;
  };
  recentModelVisibleMessages: Array<{
    id?: string;
    role: "user" | "assistant";
    text: string;
    turnIndex?: number;
  }>;
  existingManifest: Array<{
    title: string;
    durableType: "user" | "feedback" | "project" | "reference";
    description: string;
    dedupeKey?: string;
    relativePath: string;
  }>;
  explicitSignals: {
    explicitRememberAsked: boolean;
    explicitForgetAsked: boolean;
    hadDurableWriteThisTurn: boolean;
    hadDurableDeleteThisTurn: boolean;
    hadKnowledgeWriteThisTurn: boolean;
  };
};
```

这里最重要的是：

- 不传整个聊天 transcript
- 不传完整项目上下文
- 只传“本次 durable 提炼真正需要的增量消息 + manifest”

### 能力边界

这个 agent 比 verifier 还要窄。

允许：

- `memory_manifest_read`
- `memory_note_read`
- `memory_note_write`
- `memory_note_edit`
- `memory_note_delete`

禁止：

- 读项目源码
- `exec`
- `browser`
- `web`
- `write_experience_note`
- `sessions_spawn`
- scope 外写入

也就是说，它本质上是一个：

**只会维护 durable memory 目录的小 agent。**

### 输出契约

这个 agent 完成后应该产出结构化结果：

```ts
type MemoryExtractorResult = {
  status: "written" | "skipped" | "no_change" | "failed";
  writtenPaths: string[];
  updatedPaths: string[];
  deletedPaths: string[];
  extractedTypes: Array<"user" | "feedback" | "project" | "reference">;
  reason?: string;
};
```

这份结果不要求直接回给用户，但必须进：

- Action Feed
- Context Archive
- inspect

## 补写规则

### 只看 model-visible 增量消息

窗口定义改成：

- extraction cursor 之后新增的 `user/assistant`
- 再加一个保护上限，例如 20 到 30 条

这里的上限只是防失控，不应该再是主规则。

### 显式 durable write/delete 优先

如果本轮已经发生：

- `memory_manifest_read`
- `memory_note_read`
- `memory_note_write`
- `memory_note_edit`
- `memory_note_delete`

那么这轮 memory_extractor 直接跳过，并推进 cursor。

### `write_experience_note` 不再抑制 durable extraction

理由很简单：

- NotebookLM experience 写入和 durable collaboration memory 不是同一层
- 一轮里既写 experience，又值得补 durable feedback/project，是完全合理的

### `feedback` 改成双向

`feedback` 不再只是“纠错记忆”。

应该同时支持：

- corrective
  - “以后不要这样做”
  - “默认不要这么回答”
- reinforcing
  - “刚才这种做法是对的，以后继续这样”
  - “这个不明显的判断已经被用户确认过”

第一阶段不必先新加顶层 type。

更稳的方式是：

- 顶层仍然是 `feedback`
- 在 prompt 和 note schema 里强化这两种语义

### 优先 update，不 duplicate

这点直接对齐 Claude：

- 有同主题 note 时优先 update
- 没有再 create
- 明确忘记/撤销时允许 delete

## 状态设计

需要新增 per-session extraction cursor。

```ts
type DurableExtractionCursor = {
  sessionKey: string;
  lastExtractedMessageId?: string;
  lastExtractedTurn?: number;
  lastRunAt?: number;
};
```

推进规则：

- 成功写入后推进
- 因显式 durable write/delete 跳过时也推进
- agent 失败时不推进，留给下次补做

## 和现有系统的关系

### 和 Action Feed

memory_extractor 应该天然出现在 Action Feed 里。

至少要有这些动作：

- `memory extraction scheduled`
- `memory extraction running`
- `memory extraction skipped`
- `memory extraction wrote 2 notes`
- `memory extraction failed`

### 和 Context Archive

这条线必须完整落入 Context Archive。

至少记录：

- 输入窗口
- manifest snapshot
- skip reason
- 最终写入结果

### 和 inspect

`agent inspect` 后续应该能看到：

- 最近一次 memory extraction 是否触发
- 输入窗口大小
- 是否 skip
- 写了哪些 note

## rollout 结果

这次 rollout 已经完成，实际是按两阶段收口的。

### 第一阶段：先改规则

已完成：

- cursor-based 增量窗口
- 去掉 `knowledge_write` skip
- `feedback` 双向化

这一阶段过渡期里短暂复用了旧的 structured extraction + upsert 链。

### 第二阶段：切成后台 memory_extractor agent

已完成：

- durable auto-write 从 worker 升级成 task-backed background agent
- `memory_extractor` 内部已从旧的高层 durable write tools 切到 Claude 风格的 scoped memory file tools
- Action Feed / Archive / inspect 全接上

当前最终状态：

- 原先的 structured extraction worker 已从 durable auto-write 主链退场
- `memory_extractor` 是唯一的自动 durable 写入路径

## 已完成的 PR 拆分

### PR-A

cursor-based durable extraction window

### PR-B

remove knowledge-write suppression

### PR-C

bidirectional feedback guidance

### PR-D

background memory_extractor agent

### PR-E

Action Feed / Archive / inspect integration

## 结论

这条线最值得做的，不是继续给当前 after-turn extractor 加更多 prompt，而是：

**把 durable auto-write 升级成一个 Claude 风格规则、CrawClaw 风格运行时的后台 special agent。**

最重要的设计选择是：

- 规则学 Claude
- 运行时接 CrawClaw 现有 task/runtime/action/archive
- 存储继续用现有 durable store/upsert

这样既能拿到 Claude 那套“更全面的补写规则”，又不会把 CrawClaw 现有 runtime 体系绕开。
