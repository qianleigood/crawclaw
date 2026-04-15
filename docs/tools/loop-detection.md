---
title: "Tool-loop detection"
summary: "How to enable and tune guardrails that detect repetitive tool-call loops"
read_when:
  - A user reports agents getting stuck repeating tool calls
  - You need to tune repetitive-call protection
  - You are editing agent tool/runtime policies
---

# Tool-loop detection

CrawClaw can keep agents from getting stuck in repeated tool-call patterns.
The guard is **disabled by default**.

Enable it only where needed, because it can block legitimate repeated calls with strict settings.

## Why this exists

- Detect repetitive sequences that do not make progress.
- Detect high-frequency no-result loops (same tool, same inputs, repeated errors).
- Detect specific repeated-call patterns for known polling tools.

## Configuration block

Global defaults:

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

Per-agent override (optional):

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

- `enabled`: Master switch. `false` means no loop detection is performed.
- `historySize`: number of recent tool calls kept for analysis.
- `warningThreshold`: threshold before classifying a pattern as warning-only.
- `criticalThreshold`: threshold for blocking repetitive loop patterns.
- `globalCircuitBreakerThreshold`: global no-progress breaker threshold.
- `detectors.genericRepeat`: detects repeated same-tool + same-params patterns.
- `detectors.knownPollNoProgress`: detects known polling-like patterns with no state change.
- `detectors.pingPong`: detects alternating ping-pong patterns.

## Recommended setup

- Start with `enabled: true`, defaults unchanged.
- Keep thresholds ordered as `warningThreshold < criticalThreshold < globalCircuitBreakerThreshold`.
- If false positives occur:
  - raise `warningThreshold` and/or `criticalThreshold`
  - (optionally) raise `globalCircuitBreakerThreshold`
  - disable only the detector causing issues
  - reduce `historySize` for less strict historical context

## Logs and expected behavior

When a loop is detected, CrawClaw now maps detector output into explicit policy
actions instead of treating every critical hit as the same generic block.

Current actions:

- `warn`: record the signal and continue
- `nudge`: continue, but signal no-progress / ping-pong behavior
- `soft_block_exact_repeat`: block exact repeated no-progress calls
- `require_plan_refresh`: block the current retry path and force a new plan

This protects users from runaway token spend and lockups while preserving
normal tool access.

- Prefer warning and temporary suppression first.
- Escalate only when repeated evidence accumulates.

## Notes

- `tools.loopDetection` is merged with agent-level overrides.
- Per-agent config fully overrides or extends global values.
- If no config exists, guardrails stay off.
- Progress history is normalized into loop progress envelopes so replay and
  harness tooling inspect the same detector inputs used by the live runtime.
- Legacy per-session tool-call arrays are no longer the loop source of truth;
  diagnostic state only mirrors the recent envelope window for debugging.
- Harness reports can summarize scenario outcomes and diff baseline vs candidate
  policy runs, which is the preferred way to validate loop-tuning changes
  before enabling stricter blocking behavior.
- The current operator path is:
  - `crawclaw agents harness report`
  - `crawclaw agents harness promote-check --baseline ... --candidate ...`
