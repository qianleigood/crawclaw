---
read_when:
  - 想用一个统一文档跟踪 agent/runtime 还没完成的事项时
  - 想决定当前版本下一步先做什么时
  - 想看 verifier、Action Feed、Context Archive 还差哪些工作时
summary: 当前 CrawClaw agent/runtime 体系的未完成项目清单
title: Agent Runtime 未完成项目
---

# Agent Runtime 未完成项目

这份文档是当前 CrawClaw agent/runtime 架构的**统一 backlog**。

它只记录**还没收口的工作**，不重复已经完成的一期、二期、三期改造。

## 当前状态

下面这些已经落地：

- task-backed agent runtime
- subagent / ACP 任务化接入
- guard 第一、二阶段
- completion evidence / completion guard
- loop policy / replay / report / promotion gate
- inspect / status / gateway inspection RPC / CLI
- `/verify` 作为公开验证入口
- Context Archive 基础能力
- Action Feed 基础能力
- durable auto-write 的后台 `memory_extractor` 主链
- shared special-agent substrate，已覆盖 `session_summary`、`memory_extractor`、`dream` 和 verifier

真正还值得继续推进的缺口，主要就是下面这些。

## 优先级 1：统一 lifecycle spine

当前 run-loop 生命周期语义仍然分散在多条面上。

- [x] 收出一条统一的 run-loop lifecycle spine。
  - 目标 phase：
    - `turn_started`
    - `post_sampling`
    - `settled_turn`
    - `stop`
    - `stop_failure`
    - `pre_compact`
    - `post_compact`
    - `subagent_start`
    - `subagent_stop`
- [x] 让 run-loop helper 在当前已落地的 phase 上成为唯一生命周期发射点。
- [x] 把 session summary 迁成 spine subscriber。
- [x] 把 durable extraction 和 auto-dream 迁成 spine subscriber。
- [x] 把 compaction lifecycle adapter 收成 `pre_compact` / `post_compact` 订阅者。
- [x] 把 internal hooks 和 plugin hooks 降成适配层，而不是并列生命周期来源。
- [x] 让 Action Feed 和 Context Archive 订阅同一条 lifecycle spine。
- [x] 删除 `MemoryRuntime` 上残留的 lifecycle callback ownership。

设计文档：

- [`Run-loop Lifecycle Spine`](/zh-CN/debug/run-loop-lifecycle-spine)

## 优先级 0：shared special-agent substrate

lifecycle spine 已经统一。下一步的 agent/runtime 收口重点，是把
special agent 的运行机制也收成一套公共底座，但不把各自职责压平。

- [x] 增加一层共享 runtime substrate，用于维护型 special agent。
  - 已落地：
    - 共享 `SpecialAgentDefinition`
    - 双执行模式：`spawned_session` 和 `embedded_fork`
    - 在 definition 上显式声明 transcript policy
    - 通过共享 registry 解析 special-agent tool policy
    - Claude 风格的 special-agent runtime deny 工具限制
    - 在 definition 上显式声明 provider 级 cache policy
    - 按 `runId` 持久化 parent-run `cacheSafeParams` snapshot
    - 共享 spawn / embedded-run / completion capture runtime
    - 在 runtime runner 内建共享 event / history / usage hooks
    - `session_summary` 已迁到 `embedded_fork`
    - `memory_extractor` 已迁入共享 substrate
    - `dream` 已迁入共享 substrate
    - embedded memory special run 现在会把 usage/history/action 观测写进 Context Archive
    - embedded memory special run 现在会把 usage，包括 cache read/write，带回 Action Feed 的完成态 detail
    - verifier 已迁入
- [x] 明确未来 task-specific special agent 继续按 case-by-case 接入 substrate。
  - fire-and-forget 的后台维护型 agent 默认优先走 `embedded_fork`
  - 面向用户、需要独立 session 状态的 task agent 默认保持 `spawned_session`
- [x] 在 embedded-fork substrate 上补显式 cache-write suppression（`skipCacheWrite` 等价物）。
  - embedded memory special agent 现在会通过共享 substrate 显式声明 cache-write suppression
  - runtime 会把它映射到 provider 支持的“避免创建新 cache entry”控制，并尽量保留 prompt-cache read
- [x] 把 parent-run cache snapshot 从 hash/key 级元数据扩成更完整的 cache-safe prompt envelope。
  - 已落地：
    - tool prompt payload 和 tool-inventory digest
    - thinking config
    - fork-context messages
    - embedded memory special agent 现在会继承捕获到的 parent system-prompt envelope
    - cache-safe snapshot 现在会带一份 canonical cache-identity hash
    - embedded fork 在没有显式 parent key 时，会优先基于这份 canonical envelope identity 派生 prompt-cache key
    - embedded memory special run 现在会在 live tool/thinking/fork-context 和 inherited envelope 漂移时自动停用 inherited prompt-cache key
    - cache owner 现在已经明确拆成：
      - `CacheEnvelope` identity + snapshot 持久化
      - fork-cache 规划 / drift 校验
      - provider cache hints
  - 剩余差异：
    - CrawClaw 还没有逐字复用 Claude 那种 in-process `CacheSafeParams` 对象；虽然 inherited envelope 现在已经足够形成稳定 cache identity 和 drift 保护，但当前 request 重建仍然是适配层语义。
- [x] 引入结构化 `QueryContext` 作为 prompt assembly 的唯一 owner。
  - 已落地：
    - base system prompt 现在会先产出结构化 sections，而不是只拼一整段字符串
    - memory assembly 现在只产出结构化 `systemContextSections`
    - memory `systemContextSections` 现在带 machine-readable section schema（`session_memory` / `durable_memory` / `knowledge` / `routing`），不再只依赖文本块和松散 metadata
    - prompt-build hook 现在直接返回结构化 `QueryContextPatch`
    - cache identity 现在直接从结构化 query context 派生，而不是散落在 prompt assembly 各处
    - query-context 的 tool payload 归一化已和 query-layer cache contract 共用实现，减少重复的 cache 形态逻辑
    - Context Archive 的 model-visible capture 现在会记录结构化 query-context diagnostics

设计文档：

- [`Special-Agent Substrate`](/zh-CN/debug/special-agent-substrate)

## 优先级 0：verifier 完善

verifier 现在能用，但还是 MVP。

- [x] 把 verifier 输出从 `VERDICT + summary` 升级成结构化报告。
  - 已落地字段：
    - `verdict`
    - `summary`
    - `checks[]`
    - `failingCommands[]`
    - `warnings[]`
    - `artifacts[]`
  - 结构化报告现在已经接进：
    - verifier parser
    - `/verify` 工具返回
    - 父 Action Feed 的 verification detail
    - task trajectory 的 completion detail / archive payload
- [ ] 让 verifier 失败正式影响 completion。
  - 现在 `PASS` 已经能回流 evidence。
  - 但 `FAIL / PARTIAL` 还没有正式成为父任务 completion 的一等信号。
- [ ] 增加 verifier policy。
  - 明确哪些任务默认要求验证。
  - 建议先从 `fix` 和 `code` 任务开始。
- [ ] 让 completion policy 可以自动触发 verifier。
  - 现在主要还是靠手动 `/verify`。
  - 后续应该支持命中 `verification_missing` 时自动拉起 verifier。
- [ ] 继续收紧 verifier capability。
  - 保持只读
  - 不允许改代码
  - 不允许继续 spawn 子 agent
- [ ] 强化 verifier 动作回流。
  - 父聊天现在能看到高层状态。
  - 但还看不到 verifier 子任务里的关键 checks。

## 优先级 1：Action Feed 收口

Action Feed 已经上线，但还没完全产品化。

- [ ] 把聊天里的 detail 展示做得更适合正常用户。
  - 现在的 `<details>` 更像 debug 视图。
- [ ] 把 verifier 子任务动作更完整地汇总回父聊天流。
- [ ] 补齐这些动作类型的稳定覆盖：
  - memory recall
  - provider/model fallback
  - completion blocker
  - compaction retry / rewrite
- [ ] 让 Action Feed 真正成为这些面的统一语义源：
  - live chat
  - inspect
  - export-context
  - Context Archive replay
- [ ] 给长任务做 detail panel / drawer。
- [ ] 做 channel-specific 展示。
  - 例如飞书应优先用持续更新卡片，而不是刷很多条消息。

## 优先级 1：Context Archive 收口

Context Archive 现在已经有用，但还没完全成为长期 replay 真相层。

- [ ] 把 model-visible capture 覆盖到所有主要 run path。
- [ ] 确保每类关键动作都有 archive 记录：
  - tool admission/result
  - guard decision
  - loop action
  - verifier action
  - completion decision
- [ ] 提升 export 的可用性。
  - 导出的包要更容易读、更容易内部共享。
- [ ] 提升 replay 的可用性。
  - 让 replay 尽量直接吃 archive，而不是人工再拼很多额外数据。
- [ ] 继续收 storage / retention 策略。
  - size limit
  - cleanup
  - large blob handling
  - secret redaction 校验
- [ ] 增加 archive 覆盖测试：
  - parent agent
  - subagent
  - ACP
  - verifier

## 优先级 1：UI / 运维面

后端 runtime 能力已经明显领先于现有运维 UI。

- [ ] 在 Control UI 里增加 agent runtime 详情面板。
  - runtime state
  - trajectory
  - completion
  - verifier result
  - loop / guard actions
- [ ] 给现有 UI 加独立的 Action Feed 视图，而不只是聊天内联块。
- [ ] 在 UI 里暴露 Context Archive refs。
- [ ] 给 operator 增加更清晰的卡住任务、等待审批、验证 blocker 视图。
- [ ] 做更友好的 inspect 页面，而不是主要依赖 CLI 和 raw JSON。

## 优先级 2：memory/runtime 后续

memory 当前已经按简化模型收口，但还有后续工作。

- [x] 把 durable auto-write 主链升级成后台 `memory_extractor` agent。
  - 当前已完成：
    - cursor-based 增量窗口
    - 显式 durable write/delete 优先
    - `write_knowledge_note` 不再抑制 durable extraction
    - `feedback` 双向 guidance
    - task-backed background special agent
    - Action Feed / Context Archive 记录
  - 设计与背景：
    - [`Memory Extractor Agent 设计`](/debug/memory-extractor-agent)
    - [`Claude 式 Durable Memory 重构方案`](/debug/claude-memory-refactor)
- [ ] 给 `write_knowledge_note` 补一段和 durable memory 对等质量的
      agent-scoped routing guidance。
- [ ] 重新定位 candidate extraction，只保留为未来建议层。
  - 不要再把它变回隐藏写入链。
- [ ] 决定后续要不要把 dreaming / dream runs 做成新的 runtime pipeline。
- [ ] 如果以后引入 dreaming：
  - 继续保持 NotebookLM 写入走显式 tool
  - 保持自动 consolidation 和 formal knowledge write 分离

## 优先级 2：多 agent 治理

多 agent 架构已经落地，但治理还能继续加强。

- [ ] 让 agent-specific capability policy 更容易 inspect 和比较。
- [ ] 补强父子 evidence 聚合规则。
- [ ] 提升 background agent 的运维可见性。
- [ ] 给 subagent / ACP 失败补更明确的 failure reason。

## 优先级 2：回归和 live 验证

当前 targeted regression 已经不错，但下一步应该更系统化。

- [ ] 增加可重复的 live smoke：
  - main agent
  - subagent
  - ACP
  - verifier
  - Action Feed
  - Context Archive export/replay
- [ ] 增加 replay 数据集，专门覆盖：
  - false complete
  - false loop block
  - verification failure
  - approval-unavailable
- [ ] 把这些数据集接进 promotion workflow，服务后续策略迭代。

## 当前不应该重开的话题

这些现在**不是** backlog：

- 恢复旧的 knowledge review queue
- 让 NotebookLM 写回重新走隐藏审批链
- 用一个新 store 替换 transcript / runtime store / trajectory
- 让 LLM 直接负责 hard guard allow/deny
- 让在线 agent 自改 guard 安全边界

## 后续工作顺序

新增这条线的工作时，优先按这个顺序推进：

1. verifier
2. Action Feed
3. Context Archive
4. UI / operator surfaces
5. memory follow-ups

这个顺序的目的，是先把 runtime 真相层和验证层做扎实，再继续做产品化外观。
