---
summary: "How to run tests locally (vitest) and when to use force/coverage modes"
read_when:
  - Running or fixing tests
title: "Tests"
---

# Tests

- Full testing kit (suites and live tests): [Testing](/help/testing)

- `pnpm test:force`: Kills any lingering gateway process holding the default control port, then runs the full Vitest suite with an isolated gateway port so server tests don’t collide with a running instance. Use this when a prior gateway run left port 18789 occupied.
- `pnpm test:coverage`: Runs the unit suite with V8 coverage (via `vitest.unit.config.ts`). Global thresholds are 70% lines/branches/functions/statements. Coverage excludes integration-heavy gateway/channel bridges to keep the target focused on unit-testable logic.
- `pnpm test:coverage:changed`: Runs unit coverage only for files changed since `origin/main`.
- `pnpm test:changed`: runs the wrapper with `--changed origin/main`. The base Vitest config treats the wrapper manifests/config files as `forceRerunTriggers` so scheduler changes still rerun broadly when needed.
- `pnpm test`: runs the full wrapper. It keeps only a small behavioral override manifest in git, then uses a checked-in timing snapshot to peel the heaviest measured unit files into dedicated lanes.
- Unit, channel, extension, and gateway wrapper lanes default to Vitest `forks`.
- `pnpm test:channels` runs through the wrapper and uses `forks`; channel-specific isolated and hotspot lanes are tracked in `test/fixtures/test-parallel.behavior.json`.
- `pnpm test:extensions` runs through the wrapper and uses `forks` for shared and isolated extension lanes.
- `pnpm test:extensions`: runs extension/plugin suites.
- `pnpm test:perf:imports`: enables Vitest import-duration + import-breakdown reporting for the wrapper.
- `pnpm test:perf:imports:changed`: same import profiling, but only for files changed since `origin/main`.
- `pnpm test:perf:profile:main`: writes a CPU profile for the Vitest main thread (`.artifacts/vitest-main-profile`).
- `pnpm test:perf:profile:runner`: writes CPU + heap profiles for the unit runner (`.artifacts/vitest-runner-profile`).
- `pnpm test:perf:update-timings`: refreshes the checked-in slow-file timing snapshot used by `scripts/test-parallel.mjs`.
- Gateway integration: opt-in via `CRAWCLAW_TEST_INCLUDE_GATEWAY=1 pnpm test` or `pnpm test:gateway`.
- `pnpm test:e2e`: Runs gateway end-to-end smoke tests (multi-instance WS/HTTP). Defaults to `forks` + adaptive workers in `vitest.e2e.config.ts`; tune with `CRAWCLAW_E2E_WORKERS=<n>` and set `CRAWCLAW_E2E_VERBOSE=1` for verbose logs.
  Generic embedded-agent E2E helpers now default to `minimax/MiniMax-M2.7`; provider-specific regression suites still keep their targeted provider configs.
- `pnpm test:live`: Runs provider live tests (minimax/zai). Requires API keys and `LIVE=1` (or provider-specific `*_LIVE_TEST=1`) to unskip.

## Local PR gate

For local PR land/gate checks, run:

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

If `pnpm test` flakes on a loaded host, rerun once before treating it as a regression, then isolate with `pnpm vitest run <path/to/test>`. For memory-constrained hosts, use:

- `CRAWCLAW_TEST_PROFILE=low CRAWCLAW_TEST_SERIAL_GATEWAY=1 pnpm test`
- `CRAWCLAW_VITEST_FS_MODULE_CACHE_PATH=/tmp/crawclaw-vitest-cache pnpm test:changed`

## Model latency bench (local keys)

Script: [`scripts/bench-model.ts`](https://github.com/qianleigood/crawclaw/blob/main/scripts/bench-model.ts)

Usage:

- `source ~/.profile && pnpm tsx scripts/bench-model.ts --runs 10`
- Optional env: `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL`, `ANTHROPIC_API_KEY`
- Default prompt: “Reply with a single word: ok. No punctuation or extra text.”

Last run (2025-12-31, 20 runs):

- minimax median 1279ms (min 1114, max 2431)
- opus median 2454ms (min 1224, max 3170)
