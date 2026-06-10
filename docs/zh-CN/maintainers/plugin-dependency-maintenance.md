---
title: "Dependency Maintenance"
summary: "plugin 依赖基线和核心 skill 依赖的维护者工作流"
read_when:
  - 你添加、删除、重命名、发布或重新打包捆绑 plugin
  - 你修改 plugin package 依赖或捆绑核心 skill 的运行时需求
  - 你需要验证 Python requirement lockfiles
x-i18n:
  generated_at: "2026-06-10T10:39:08Z"
  model: codex
  provider: openai
  source_hash: 0eb0dc1956d5d8b6836df7c2d5631277475b2ce154cff2b5fc0b5a3cd5fcf3a6
  source_path: maintainers/plugin-dependency-maintenance.md
  workflow: 15
---

# Dependency Maintenance

plugin dependency plan 是只读的生成基线，用来记录捆绑 plugin 和捆绑核心 skill helper runtime 拥有的依赖 surface。

它从源码元数据生成。它不会安装 packages、启用 plugins、导入 plugin runtime 代码，也不会修改运行时状态。

## 覆盖范围

`pnpm plugin-deps:gen` 会写入：

- `docs/.generated/plugin-dependency-plan.json`
- `docs/.generated/plugin-dependency-plan.jsonl`

该 plan 覆盖：

- `package.json` 中的 root package dependency sections 和 Node engine policy
- `pnpm-workspace.yaml` 中的 pnpm workspace package patterns 和 build-script allowlists
- `extensions/*/crawclaw.plugin.json` 下已跟踪的捆绑 plugin manifests
- 每个已跟踪捆绑 plugin 的 `package.json` dependency section
- 已发布 plugin 的 `crawclaw.install.npmSpec` 元数据
- `skills/.runtime/requirements.lock.txt` 中的捆绑核心 skill Python package pins
- `skills/openai-whisper/runtime/requirements.macos-arm64.lock.txt` 中的 `openai-whisper` Apple Silicon package pins

scanner 优先使用 `git ls-files` 查找 plugin manifests。本地未跟踪的 plugin 实验不会进入已提交基线。

## 命令

当有意修改依赖 surface 时，使用 generator：

```bash
pnpm plugin-deps:gen
```

在 CI 或本地 review 中使用 check：

```bash
pnpm plugin-deps:check
```

该 check 会把生成内容与已提交的 JSON 和 JSONL artifacts 比较。失败意味着依赖元数据发生了有意变更且需要重新生成基线，
或者这次依赖变更应该被回退或修正。

## 安装层

把 plugin 依赖设置拆成四个独立层：

- Core runtime dependencies 位于 root `package.json`。
- 捆绑 plugin development dependencies 位于各 plugin package，不得变成已发布运行时的 `node_modules` trees。
- Python sidecars 和 external tools 必须由 Rust/native runtime descriptors 或显式用户配置拥有，而不是由 install-time TS repair flows 拥有。

除非 core code 直接 import，否则不要把 plugin-only dependencies 移到 root package。

## Python Requirement Policy

生成 plan 会记录已提交 requirement lockfiles 中锁定的 Python packages。CrawClaw 不再有 install-time managed plugin
runtime installer；runtime launch 和 sidecar ownership 必须留在 Rust/native runtime code 或显式用户配置中。

如果 Python policy 发生变化，先更新拥有方的 Rust/native runtime descriptor 和 locked requirements，再运行
`pnpm plugin-deps:gen`。

## Review Checklist

落地 plugin dependency changes 前：

1. 确认依赖 ownership：core dependency、plugin dependency、staged runtime dependency 或 managed runtime。
2. 对有意的 dependency surface changes 运行 `pnpm plugin-deps:gen`。
3. 检查 `docs/.generated/plugin-dependency-plan.json` 中是否出现意外的 plugin count、runtime count 或 version-split changes。
4. 运行 `pnpm plugin-deps:check`。
5. 对 install/runtime changes，还要运行最近的 installer 或 runtime test。
