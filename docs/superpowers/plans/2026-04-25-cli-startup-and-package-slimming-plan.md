---
title: "CLI Startup And Package Slimming Plan"
summary: "Implementation plan for CLI cold-start and npm package size reductions"
read_when:
  - You are working on CLI startup performance
  - You are trimming the published npm package surface
---

# CLI Startup And Package Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce CLI cold-start latency on the slowest fast-path commands and shrink the published npm package without breaking plugin install/runtime behavior.

**Architecture:** Split the work into three PRs. PR1 removes avoidable module loading from fast CLI routes. PR2 makes configured-channel startup cheaper by separating setup-time metadata from full runtime registration, using Feishu as the first real target. PR3 trims the published package by moving heavy runtime dependencies and non-runtime assets out of the default tarball path.

**Tech Stack:** TypeScript, ESM, Commander, Vitest, existing plugin loader/runtime staging scripts, `npm pack --dry-run --json --ignore-scripts`

---

## Success Metrics

- `node crawclaw.mjs --help` with explicit plugin config: under `800ms`
- `node crawclaw.mjs status --json` with `feishu` configured: under `1200ms`
- `node crawclaw.mjs agents list --json`: under `1000ms`
- `npm pack --dry-run --json --ignore-scripts`: tarball under `28 MiB`, unpacked under `120 MiB`
- `pnpm build`: passes with no new `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings

## File Structure

### PR1: Startup fast paths

- Modify: `src/cli/program/routes.ts`
  - Stop importing the full `agents` barrel for `agents list`.
- Modify: `src/commands/agents.ts`
  - Keep public exports stable if route imports are narrowed.
- Modify: `src/cli/program/root-help.ts`
  - Remove config-triggered full plugin CLI loading from root help.
- Modify: `src/plugins/cli.ts`
  - Add a metadata-only path for plugin command descriptors.
- Create: `src/plugins/cli-metadata.ts`
  - Centralize lightweight plugin CLI descriptor resolution.
- Test: `src/cli/program/routes.test.ts`
- Test: `src/cli/program/root-help.test.ts`
- Test: `src/plugins/cli-metadata.test.ts`

### PR2: Configured channel startup deferral

- Modify: `src/commands/status.scan.json-core.ts`
  - Load setup-time channel metadata without forcing full plugin registration.
- Modify: `src/plugins/loader.ts`
  - Expose or reuse a metadata/setup-only registry load path for configured channels.
- Modify: `src/plugins/channel-plugin-ids.ts`
  - Keep configured-channel resolution compatible with deferred full load.
- Modify: `extensions/feishu/index.ts`
  - Remove heavy top-level imports from the default entry.
- Create: `extensions/feishu/full.runtime.ts`
  - Host the heavy tool registration path behind one lazy boundary.
- Modify: `extensions/feishu/package.json`
  - Opt in to configured-channel startup deferral.
- Test: `src/commands/status.scan.json-core.test.ts`
- Test: `src/plugins/loader.test.ts`
- Test: `extensions/feishu/index.test.ts`

### PR3: Publish package slimming

- Modify: `scripts/stage-bundled-plugin-runtime-deps.mjs`
  - Support a narrower staging policy for bundled plugin runtime deps.
- Modify: `scripts/runtime-postbuild.mjs`
  - Keep runtime staging aligned with the slimmer policy.
- Modify: `package.json`
  - Reduce `files` whitelist to runtime-required assets only.
- Modify: `extensions/diffs/package.json`
- Modify: `extensions/amazon-bedrock/package.json`
- Modify: `extensions/feishu/package.json`
  - Revisit `bundle.stageRuntimeDependencies` per plugin.
- Test: `scripts/stage-bundled-plugin-runtime-deps.test.mjs` or existing nearest script test surface
- Verify: `npm pack --dry-run --json --ignore-scripts`

## PR Breakdown

### PR1: `startup-fast-path`

**Scope:** Only CLI cold-start fast paths. No plugin runtime behavior change.

- [ ] **Step 1: Freeze the current baseline**
      Run:

  ```bash
  node --import tsx scripts/bench-cli-startup.ts --case help --case statusJson --case agentsListJson --runs 5 --warmup 1
  npm pack --dry-run --json --ignore-scripts > /tmp/crawclaw-pack-before.json
  ```

  Expected:
  - `help` is still multi-second with explicit plugin config
  - `agentsListJson` is still multi-second
  - pack output is the reference snapshot for later comparison

- [ ] **Step 2: Narrow the `agents list` route import**
      Files:
  - Modify: `src/cli/program/routes.ts`
  - Modify: `src/commands/agents.ts`
    Implement:
  - Route `agents list` to a narrow module that only exports `agentsListCommand`
  - Do not remove the public barrel export used elsewhere
    Verify:

  ```bash
  pnpm test -- src/cli/program/routes.test.ts
  node crawclaw.mjs agents list --json
  ```

  Expected:
  - Route test passes
  - `agents list --json` no longer pays the full agents barrel cost

- [ ] **Step 3: Add a metadata-only plugin CLI descriptor path**
      Files:
  - Create: `src/plugins/cli-metadata.ts`
  - Modify: `src/plugins/cli.ts`
    Implement:
  - Add a function that returns plugin command descriptors without forcing full plugin module registration
  - Restrict the returned surface to `name`, `description`, aliases if already supported, and locale-aware text
  - If a plugin cannot provide metadata cheaply, skip it from root help rather than loading the full runtime
    Verify:

  ```bash
  pnpm test -- src/plugins/cli-metadata.test.ts
  ```

  Expected:
  - Metadata-only helper returns descriptors for configured plugins without importing their heavy runtime path

- [ ] **Step 4: Move root help onto the metadata-only path**
      Files:
  - Modify: `src/cli/program/root-help.ts`
  - Modify: `src/plugins/cli.ts`
    Implement:
  - Replace the `loadConfig` plus `getPluginCliCommandDescriptors` branch with the metadata-only helper
  - Preserve zh-CN and English help behavior
    Verify:

  ```bash
  pnpm test -- src/cli/program/root-help.test.ts
  node crawclaw.mjs --help
  node --import tsx scripts/bench-cli-startup.ts --case help --case agentsListJson --runs 5 --warmup 1
  ```

  Expected:
  - Root help still lists configured plugin commands
  - `help` and `agentsListJson` both drop sharply

- [ ] **Step 5: Land PR1 with hard gate verification**
      Run:

  ```bash
  pnpm build
  ```

  Expected:
  - Build passes
  - No new ineffective dynamic import warnings

### PR2: `feishu-startup-deferral`

**Scope:** Make configured-channel startup cheap without changing end-user channel behavior after full runtime load completes.

- [ ] **Step 1: Freeze the current configured-channel baseline**
      Run:

  ```bash
  node --import tsx scripts/bench-cli-startup.ts --case statusJson --runs 5 --warmup 1
  node crawclaw.mjs status --json
  ```

  Expected:
  - `status --json` is still slow when `feishu` is configured

- [ ] **Step 2: Split `status --json` from full configured-channel registration**
      Files:
  - Modify: `src/commands/status.scan.json-core.ts`
  - Modify: `src/plugins/loader.ts`
  - Modify: `src/plugins/channel-plugin-ids.ts`
    Implement:
  - Introduce or reuse a setup-only load path for configured channels
  - Keep stdout JSON clean by preserving the existing stderr log redirection
  - Do not call the full configured-channel registry load when the status scan only needs metadata/probes
    Verify:

  ```bash
  pnpm test -- src/commands/status.scan.json-core.test.ts
  pnpm test -- src/plugins/loader.test.ts
  ```

  Expected:
  - Status JSON still contains the same semantic fields
  - Full plugin registration is no longer required for the status scan path

- [ ] **Step 3: Move Feishu heavy registration behind one runtime boundary**
      Files:
  - Modify: `extensions/feishu/index.ts`
  - Create: `extensions/feishu/full.runtime.ts`
    Implement:
  - Leave `index.ts` with the light plugin definition, runtime setter, probe exports, and any setup-safe exports
  - Move doc/wiki/drive/bitable/chat/perm/subagent registration into `full.runtime.ts`
  - Load that module only inside `registerFull`
    Verify:

  ```bash
  pnpm test -- extensions/feishu/index.test.ts
  pnpm build
  ```

  Expected:
  - Feishu still registers all tools after full load
  - Cold paths stop importing the heavy module graph

- [ ] **Step 4: Opt Feishu into deferred configured-channel full load**
      Files:
  - Modify: `extensions/feishu/package.json`
  - Modify: any loader tests that assert startup policy
    Implement:
  - Add the manifest startup deferral flag used by the loader
  - Keep `setupEntry` intact
    Verify:

  ```bash
  pnpm test -- src/plugins/loader.test.ts
  node crawclaw.mjs gateway status --json
  node --import tsx scripts/bench-cli-startup.ts --case statusJson --runs 5 --warmup 1
  ```

  Expected:
  - `status --json` falls close to the no-plugin baseline
  - Gateway status remains correct

- [ ] **Step 5: Run the PR2 landing gate**
      Run:

  ```bash
  pnpm build
  pnpm test -- src/commands/status.scan.json-core.test.ts src/plugins/loader.test.ts extensions/feishu/index.test.ts
  ```

  Expected:
  - Startup deferral works and touched surfaces stay green

### PR3: `package-slimming`

**Scope:** Shrink the published npm artifact without breaking default CLI install or the plugin runtime contract.

- [ ] **Step 1: Capture the current package composition**
      Run:

  ```bash
  npm pack --dry-run --json --ignore-scripts > /tmp/crawclaw-pack-before.json
  ```

  Expected:
  - Reference snapshot shows the heavy top-level areas: `dist`, `docs`, `skills`, and large `dist/extensions/*/node_modules`

- [ ] **Step 2: Audit staged runtime dependency policy for the top three plugins**
      Files:
  - Modify: `scripts/stage-bundled-plugin-runtime-deps.mjs`
  - Modify: `extensions/diffs/package.json`
  - Modify: `extensions/amazon-bedrock/package.json`
  - Modify: `extensions/feishu/package.json`
    Implement:
  - Add a narrower policy than unconditional `stageRuntimeDependencies: true`
  - Only keep staged runtime deps for plugins that must work from the packed CLI with no follow-up install
  - For plugins moved off the default tarball path, make the runtime install path explicit and deterministic
    Verify:

  ```bash
  npm pack --dry-run --json --ignore-scripts > /tmp/crawclaw-pack-after-stage.json
  ```

  Expected:
  - Tarball shrinks materially before touching docs or skills

- [ ] **Step 3: Trim the publish whitelist**
      Files:
  - Modify: `package.json`
    Implement:
  - Remove `docs/` from the published package unless a concrete runtime read path proves it is required
  - Remove `skills/` from the published package unless a concrete runtime read path proves it is required
  - Leave `dist/`, required install scripts, required assets, and any runtime manifests intact
    Verify:

  ```bash
  rg -n "\"docs/\"|\"skills/\"" package.json
  npm pack --dry-run --json --ignore-scripts > /tmp/crawclaw-pack-after-files.json
  ```

  Expected:
  - Tarball shrinks further
  - No runtime-required file was removed from the pack list

- [ ] **Step 4: Push heavy root dependencies back to the owning plugin boundary where applicable**
      Files:
  - Modify: `package.json`
  - Modify: nearest owning plugin `package.json` files only where the import graph proves the dependency is plugin-owned
    Implement:
  - Audit real import usage for `pdfjs-dist`, `@photostructure/sqlite`, `matrix-js-sdk`, `@mariozechner/pi-coding-agent`, `playwright-core`
  - Only move a dependency if core does not directly import it
    Verify:

  ```bash
  pnpm build
  npm pack --dry-run --json --ignore-scripts > /tmp/crawclaw-pack-after-deps.json
  ```

  Expected:
  - Build still passes
  - Package gets smaller again or at minimum install graph becomes cleaner

- [ ] **Step 5: Run the PR3 landing gate**
      Run:

  ```bash
  pnpm build
  npm pack --dry-run --json --ignore-scripts
  ```

  Expected:
  - Published tarball size is under the target or clearly trending toward it with exact remaining blockers called out

## Risks And Guardrails

- Root help metadata can drift from real plugin command registration.
  Guardrail: add a test that compares metadata-only descriptors against the real descriptors for bundled plugins that expose CLI commands.

- Deferred configured-channel load can hide readiness races.
  Guardrail: keep setup-time probes separate from full tool registration, and verify gateway/status behavior before and after full load.

- Removing staged runtime deps can break offline or packed installs.
  Guardrail: change the policy per plugin, not globally. Start with `diffs`, `amazon-bedrock`, and `feishu`, and keep a smoke path for plugin install/enable flows.

- Removing `docs/` or `skills/` from the npm package can break hidden runtime reads.
  Guardrail: search code for real runtime reads first; do not remove by assumption.

## Verification Checklist

- [ ] `node --import tsx scripts/bench-cli-startup.ts --case help --case statusJson --case agentsListJson --runs 5 --warmup 1`
- [ ] `node crawclaw.mjs --help`
- [ ] `node crawclaw.mjs status --json`
- [ ] `node crawclaw.mjs agents list --json`
- [ ] `node crawclaw.mjs gateway status --json`
- [ ] `pnpm build`
- [ ] `npm pack --dry-run --json --ignore-scripts`

## Execution Order

1. PR1 first because it is the lowest-risk startup win and does not alter plugin runtime semantics.
2. PR2 second because it changes real plugin startup behavior and needs isolated review.
3. PR3 last because packaging changes are easy to measure but easiest to break if done before the runtime boundaries are cleaned up.
