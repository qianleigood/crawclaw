---
read_when:
  - 想把 CrawClaw 的 durable memory 自动补写改得更像 Claude Code 时
  - 想理解 Claude 的 memory extraction 规则和 CrawClaw durable-memory 演进差异时
  - 想决定 durable memory 这条线下一步应该小修还是重构时
summary: 基于 Claude Code 源码，对 CrawClaw durable memory 自动补写的重构方案
title: Claude 式 Durable Memory 重构方案
---

# Claude 式 Durable Memory 重构方案

这份文档回答一个很具体的问题：

**如果要让 CrawClaw 的 durable memory 自动补写更像 Claude Code，应该怎么改？**

这里不是抽象讨论，而是基于两边当前源码的实际行为来设计：

- Claude Code：
  - `src/memdir/memoryTypes.ts`
  - `src/services/extractMemories/extractMemories.ts`
  - `src/services/extractMemories/prompts.ts`
- CrawClaw：
  - `src/memory/engine/context-memory-runtime.ts`
  - `src/memory/durable/extraction.ts`
  - `src/memory/durable/worker-manager.ts`
  - `src/memory/context/render-routing-guidance.ts`

## Claude 现在的补写规则

Claude 的 durable memory 自动补写，有 6 个关键特征。

### 1. 它是回合结束时触发，不是任意 after-turn 都跑

Claude 的 `extractMemories` 挂在 stop hooks 上：

- `src/query/stopHooks.ts`

触发语义是：

- 一次完整 query loop 结束
- 模型已经产出最终回复
- 这一轮没有继续往下 tool call

这意味着 Claude 的自动补写更接近：

**“这一轮工作结束了，现在补做 dream。”**

而不是：

**“只要 afterTurn 收到新消息，就试着抽 durable note。”**

### 2. 它只看“上次提取之后新增的 model-visible messages”

Claude 明确只看：

- `user`
- `assistant`

不看：

- tool
- progress
- system
- attachment

关键代码在 `src/services/extractMemories/extractMemories.ts`：

- `isModelVisibleMessage(...)`
- `countModelVisibleMessagesSince(...)`
- `lastMemoryMessageUuid`

也就是说，Claude 不是“最后固定 8 条消息”，而是：

**从上次 extraction cursor 往后，取新增的 user/assistant。**

### 3. 如果主线程已经显式写了 memory，这一轮自动补写直接跳过

Claude 有一条非常重要的互斥规则：

- `hasMemoryWritesSince(...)` in `src/services/extractMemories/extractMemories.ts`

如果主对话这一轮已经自己写了 memory 文件：

- 后台 extractor 不再重复提取
- 直接推进 cursor

这条规则避免了：

- 同一轮双写
- 主线程显式写入和后台自动补写互相打架

### 4. `feedback` 是双向的

Claude 源码里对 `feedback` 的定义非常明确：

- 记录 **failure AND success**

见 `src/memdir/memoryTypes.ts`。

它不只记录：

- “不要这样做”

也记录：

- “这次这种不明显的做法是对的，以后继续这样”

这是 Claude memory 质量比较高的关键原因之一。

### 5. 它是 forked memory extractor agent，不是结构化 note 提取器

Claude 的自动补写不是内部 helper 直接出 JSON，而是：

- fork 一个 memory extraction subagent
- 让它直接写 memory 文件
- 然后更新 `MEMORY.md`

见：

- `src/services/extractMemories/extractMemories.ts`
- `src/services/extractMemories/prompts.ts`

### 6. 它有第二层更重的 consolidation：auto-dream

Claude 不止有 turn-end extraction，还有后台 consolidation：

- `src/services/autoDream/autoDream.ts`

所以它其实是两层：

- 轻量增量补写
- 更重的周期性整合

## CrawClaw 之前怎么做，以及现在改成了什么

CrawClaw 现在已经把 durable auto-write 主链切到了 `memory_extractor`，但旧实现仍然值得拿来对照 Claude。

### 1. 旧入口挂在 `afterTurn`

CrawClaw 当前是在：

- `src/memory/engine/context-memory-runtime.ts`

的 `afterTurn()` 里，把 `newMessages` 提交给：

- `src/memory/durable/worker-manager.ts`

### 2. 旧窗口是“本轮新增消息里的最后 8 条 user/assistant 可见文本”

真正做提炼时，CrawClaw 会调用：

- `collectRecentDurableConversation(...)` in `src/memory/durable/extraction.ts`

规则是：

- 只保留 `user` / `assistant`
- 只取可见文本
- 最后 `.slice(-8)`

所以它当前是：

**本轮新增消息里的最后 8 条可见 user/assistant。**

这比 Claude 更短窗口，也更容易漏掉“本轮前半段发生的有效反馈”。

### 3. 旧自动补写是结构化 LLM 提炼，不是 forked subagent

旧路径会：

- 在 `src/memory/durable/extraction.ts` 里调用 `callStructuredOutput(...)`
- 让模型返回 `notes[]`
- 再通过 `src/memory/durable/store.ts` 做 upsert

当前主路径已经不再走这条进程内提炼链，而是改成后台 `memory_extractor` agent，再继续复用 durable store。

### 4. 旧 skip 规则过宽

现在 CrawClaw 这条逻辑：

- `classifyAfterTurnDurableSkipReason(...)` in `src/memory/durable/extraction.ts`

会因为这两类情况跳过：

- 显式 durable memory write
- 成功的 `write_knowledge_note`

第二条是有问题的。

`knowledge write` 和 `durable memory write` 不是同一层。
用户这一轮成功写了 NotebookLM，不代表 durable memory 就不需要补写。

### 5. 旧的 `feedback` 语义不够强

CrawClaw 当前 guidance 里已经写了 `feedback` 应保存长期协作方式和约束，但没有像 Claude 那样明确强调：

- 成功确认也应保存
- 不只是纠错

这导致当前 `feedback` 更偏：

- corrective memory

而不是：

- corrective + reinforcing

## 不建议直接照搬 Claude 的地方

这里有一个重要判断：

**不要把 Claude 的实现整块搬进 CrawClaw。**

最不应该直接复制的是：

- forked memory extraction subagent 直接改 memory 文件

原因很直接：

CrawClaw 已经有这些更强的基础设施：

- 结构化 note 归一化
- durable store upsert
- prompt journal
- Context Archive
- agent/runtime/task 体系

所以对 CrawClaw 来说，更合理的是：

**借 Claude 的“触发规则和语义边界”，保留 CrawClaw 的 durable store/upsert 模型，但不再保留旧的进程内 structured 提炼主路径。**

一句话：

- 借 Claude 的 lifecycle 和 policy
- 不抄 Claude 的 file-native executor

## 建议的目标形态

我建议把 CrawClaw durable memory 自动补写重构成下面这套。

### 1. 改成“回合结束增量提炼”，不是“裸 afterTurn 最近 8 条”

目标行为：

- 只对顶层交互 session 运行
- 在一次完整主回合结束后判断是否触发
- 使用 per-session extraction cursor
- 只处理上次 extraction 之后新增的 model-visible messages

也就是说，目标不是：

- `newMessages.slice(-8)`

而是：

- `messages since lastExtractionCursor`

### 2. 保留“显式写入优先”，但收紧 skip 规则

建议的新 skip 规则：

- 显式 durable write：跳过自动补写
- 显式 durable delete：跳过自动补写
- `write_knowledge_note`：**不再作为 durable extraction 的 skip 条件**

原因：

- knowledge write 和 durable write 是两条不同链
- 成功写 knowledge，不应该抑制长期协作偏好或 project context 的 durable 提取

### 3. 把 `feedback` 明确升级成双向规则

建议直接把 CrawClaw durable `feedback` 改成和 Claude 一样的语义：

- corrective
- reinforcing

但第一阶段不一定要先加新的顶层 type。

更稳的做法是：

- 顶层仍然是 `feedback`
- prompt 和 note schema 支持：
  - 纠错建立/修正规则
  - 成功确认增强已有规则

也就是：

- “以后别这样做” 要记
- “刚才这种不明显的做法是对的，以后继续这样” 也要记

### 4. 用 extraction cursor 替代“最近 8 条”

我建议新增一条 per-session 状态：

```ts
type DurableExtractionCursor = {
  sessionKey: string;
  lastExtractedMessageId?: string;
  lastExtractedTurn?: number;
  lastRunAt?: number;
};
```

然后 durable extraction 的输入改成：

- 从 runtime store 里读取 cursor 之后的 model-visible messages
- 再做一次最大窗口裁剪

这个“最大窗口裁剪”应该只是防失控，不应该是主规则。

建议上限：

- 最多 20 到 30 条 model-visible messages
- 超过时优先保留最近连续 turn

### 5. 顶层 session 跑，subagent 默认不跑

Claude 只在主线程跑，CrawClaw 当前也已经跳过 subagent session：

- `src/memory/durable/worker-manager.ts`

这条我建议保留。

原因：

- subagent 更容易产生局部任务噪音
- durable memory 更应该代表顶层协作关系

后面如果要扩，也应该先扩到“顶层多 agent”，而不是所有子 agent 都开。

### 6. 把 automatic extraction 和 dream/consolidation 明确分层

建议未来 memory 体系明确拆成两层：

- `turn-end extraction`
  - 增量
  - 快
  - 保守
- `dreaming / consolidation`
  - 周期性
  - 更大窗口
  - 专门做归并、降重、增强

不要让 turn-end extraction 承担“长期整理全部 memory”的职责。

## 推荐重构路径

我建议分 4 个 PR，不要一把梭。

### PR1：把窗口从“最后 8 条”改成 cursor-based 增量窗口

目标：

- durable extraction 输入不再来自 `newMessages.slice(-8)`
- 改成从 runtime store 读取 `lastExtractedCursor` 之后的 model-visible messages

建议改动：

- `src/memory/runtime/runtime-store.ts`
- `src/memory/runtime/sqlite-runtime-store.ts`
- `src/memory/durable/worker-manager.ts`
- `src/memory/durable/extraction.ts`

重点：

- 新增 cursor state
- 新增按 cursor 取 model-visible message 的 store query
- `collectRecentDurableConversation(...)` 不再自己决定主窗口语义

### PR2：收紧 skip 规则，移除 `knowledge_write -> skip durable extraction`

目标：

- durable extraction 只和 durable write 互斥
- 不再被 NotebookLM 写入抑制

建议改动：

- `src/memory/durable/extraction.ts`
- 相关测试

这是一个小改，但收益很直接。

### PR3：把 `feedback` 升级成双向规则

目标：

- prompt 里明确：
  - corrections 要记
  - confirmations of non-obvious successful approaches 也要记

建议改动：

- `src/memory/context/render-routing-guidance.ts`
- `src/memory/durable/extraction.ts`
- durable memory 文档

这一步先不用强推 schema 变更，也可以先从 prompt 和 examples 开始。

### PR4：把 lifecycle 从裸 afterTurn 收口成“顶层回合结束触发”

这是唯一算得上“重构”的一块。

目标：

- 不再只是 `afterTurn 有消息就排队`
- 而是更接近 Claude 的 stop-hook 语义：
  - 顶层回合结束
  - 主线程
  - 没有继续 tool loop

如果当前主链不好直接接 stop-hook 级语义，也可以先折中：

- 继续用 `afterTurn`
- 但只有在主 run 进入稳定终态时才提交 extraction candidate

这一层如果不好一次做完，可以晚一点做。

## 建议不要做的事

### 不要把 CrawClaw 改成 Claude 那种“forked memory agent 直接改文件”

这会丢掉 CrawClaw 现在这些已经很值钱的东西：

- 结构化提炼
- 类型归一化
- note upsert
- prompt journal
- Context Archive 对接

### 不要把 turn-end extraction 和 dream 合并

这两个职责不同：

- 一个做轻量增量补写
- 一个做大窗口 consolidation

混在一起，最后会又慢又不稳定。

### 不要让 subagent 默认参与 durable auto-write

这会显著增加局部任务噪音。

## 最终建议

如果只用一句话概括，我建议这样改：

**把 CrawClaw 的 durable memory 自动补写，重构成“Claude 风格的回合结束、cursor 驱动、显式写入优先、双向 feedback 提炼”，但继续保留 CrawClaw 自己的结构化提炼和本地 upsert 实现。**

最值得先做的顺序是：

1. cursor-based 增量窗口
2. 去掉 `knowledge_write` 的 skip 抑制
3. feedback 双向化
4. 再考虑 stop-hook 级 lifecycle 重构

这个顺序能先把收益最大的行为修正拿到手，同时避免一开始就把 memory 主链翻得太大。
