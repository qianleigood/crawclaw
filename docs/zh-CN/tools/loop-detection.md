---
title: "Tool-loop detection"
summary: "如何启用和调优用于检测重复 tool-call loops 的 guardrails"
read_when:
  - 用户报告 agents 卡在重复 tool calls 中
  - 你需要调优 repetitive-call protection
  - 你正在编辑 agent tool/runtime policies
x-i18n:
  generated_at: "2026-06-10T12:04:39Z"
  model: codex
  provider: openai
  source_hash: d05521f0fd34035cf4b35cad1955167c0a9f74a45418fb34f4f1fb60e58877a2
  source_path: tools/loop-detection.md
  workflow: 15
---

# Tool-loop detection

CrawClaw 可以防止 agents 卡在重复 tool-call patterns 中。该 guard **默认禁用**。

只在需要的地方启用它，因为严格设置可能会阻止合法的重复 calls。

## 为什么存在

- 检测没有进展的重复 sequences。
- 检测高频 no-result loops（相同 tool、相同 inputs、重复 errors）。
- 针对已知 polling tools 检测特定 repeated-call patterns。

## Configuration block

Global defaults：

```json5
{
  tools: {
    loopDetection: {
      enabled: false,
      historySize: 30,
      warningThreshold: 10,
      criticalThreshold: 20,
      globalCircuitBreakerThreshold: 30,
      detectors: {
        genericRepeat: true,
        knownPollNoProgress: true,
        pingPong: true,
      },
    },
  },
}
```

Per-agent override（可选）：

```json5
{
  agents: {
    list: [
      {
        id: "safe-runner",
        tools: {
          loopDetection: {
            enabled: true,
            warningThreshold: 8,
            criticalThreshold: 16,
          },
        },
      },
    ],
  },
}
```

### Field behavior

- `enabled`: Master switch。`false` 表示不执行 loop detection。
- `historySize`: 保留多少最近 tool calls 用于分析。
- `warningThreshold`: 将 pattern 归类为 warning-only 前的 threshold。
- `criticalThreshold`: 阻止 repetitive loop patterns 的 threshold。
- `globalCircuitBreakerThreshold`: 全局 no-progress breaker threshold。
- `detectors.genericRepeat`: 检测重复 same-tool + same-params patterns。
- `detectors.knownPollNoProgress`: 检测已知 polling-like patterns 且没有 state change。
- `detectors.pingPong`: 检测 alternating ping-pong patterns。

## 推荐设置

- 从 `enabled: true` 开始，保持 defaults 不变。
- 保持 thresholds 顺序为 `warningThreshold < criticalThreshold < globalCircuitBreakerThreshold`。
- 如果出现 false positives：
  - 提高 `warningThreshold` 和/或 `criticalThreshold`
  - 可选提高 `globalCircuitBreakerThreshold`
  - 只禁用导致问题的 detector
  - 减小 `historySize`，让 historical context 不那么严格

## Logs and expected behavior

当检测到 loop 时，CrawClaw 现在会把 detector output 映射为显式 policy actions，而不是把每个 critical hit 都当成同一种 generic block。

当前 actions：

- `warn`: 记录 signal 并继续
- `nudge`: 继续，但 signal no-progress / ping-pong behavior
- `soft_block_exact_repeat`: 阻止完全重复的 no-progress calls
- `require_plan_refresh`: 阻止当前 retry path，并强制制定新计划

这能保护用户免受 runaway token spend 和 lockups，同时保留正常 tool access。

- 优先使用 warning 和 temporary suppression。
- 只有在 repeated evidence 累积后才升级。

## Notes

- `tools.loopDetection` 会与 agent-level overrides 合并。
- Per-agent config 会完全 override 或扩展 global values。
- 如果没有 config，guardrails 保持关闭。
- Progress history 会被 normalized 为 loop progress envelopes，让 replay 和 harness tooling 检查与 live runtime 使用相同的 detector inputs。
- Legacy per-session tool-call arrays 不再是 loop source of truth；diagnostic state 只 mirror 最近 envelope window，用于 debugging。
- Harness reports 可以汇总 scenario outcomes，并 diff baseline vs candidate policy runs；这是在启用更严格 blocking 前验证 loop-tuning changes 的推荐方式。
- 当前 operator path 是：
  - 在全局或受影响 agent 下配置 `tools.loopDetection`。
  - 通过 CrawClaw Desktop diagnostics 或本地 Gateway API 检查 loop signals，然后用 harness reports 验证更严格 thresholds，再广泛 rollout。
