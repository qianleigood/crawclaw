---
summary: bundled、optional 和 extension-scoped skills 的仓库级地图
read_when:
  - 你在判断新的 skill 应该放在哪里
  - 你需要查看当前仓库已有 skills 的统一清单
title: Skills Catalog
x-i18n:
  generated_at: "2026-06-10T10:39:08Z"
  model: codex
  provider: openai
  source_hash: 6d6768d2273bf7df17cb089b55a901053f77f0fd7954b573a3dd35a38b5446c8
  source_path: maintainers/skills-catalog.md
  workflow: 15
---

# Skills Catalog

本文解释 skills 在仓库中的组织方式，以及维护者在添加、移动或废弃某个 skill 前应该先查看哪里。

简要版本：

- `skills/` 是默认捆绑 skill surface
- `skills-optional/` 是仓库内 optional catalog
- `extensions/*/skills/` 加上少量 extension 根目录 `SKILL.md` 文件，是由对应 extension 拥有的 extension-local skill surface

如果你在判断新的 skill 应该放在哪里，先看 ownership，再看分发模型：

1. 只有和某个 extension 的 tools 或 config 一起才有意义时，放到 `extensions/*/skills/`。
2. 属于默认捆绑 skill surface 且具备广泛用途时，放到 `skills/`。
3. 值得留在仓库中，但不应该作为默认捆绑集发布时，放到 `skills-optional/`。

## 当前清单

仓库当前有三类 skill surface：

- `skills/`：18 个 bundled core skills
- `skills-optional/`：35 个 optional catalog skills
- `extensions/` 下 extension-owned surfaces：2 个 skills

把它们当作不同的分发 surface，而不是三个随机目录。

## Bundled Core Skills

`skills/` 是 CrawClaw 的默认捆绑 skill surface。
它会随发布安装包一起分发，运行时从该 install root 解析 bundled skills。这里的删除或 publish-whitelist
变更属于 package surface changes，不是普通清理。

这个目录适合放 repo-wide、广泛可复用，并且适合作为默认运行时体验一部分的 skills。

当前 bundled set：

- `coding-agent`
- `find-skills`
- `frontend-dev`
- `fullstack-dev`
- `gh-issues`
- `github`
- `healthcheck`
- `link-checker`
- `node-connect`
- `openai-whisper`
- `pptx-generator`
- `react`
- `session-logs`
- `skill-creator`
- `skill-vetter`
- `summarize`
- `superpowers`
- `weather`

判断规则：

- 保持 bundled set 有意精简。
- 只有大概率能跨很多 workspace 使用的通用 skills，才优先放入 bundled。
- 不要把 `skills/` 当作实验、一-off integration 或 extension-owned instructions 的暂存区。

## Optional Catalog Skills

`skills-optional/` 是仓库内 catalog，用于保存有价值但不属于默认捆绑 surface 的 skills。

适用场景：

- optional capability packs
- 值得保留的实验
- 应留在仓库内但不应成为默认 runtime surface 的 domain-specific skills

当前 optional catalog：

- `1password`
- `android-native-dev`
- `apple-notes`
- `apple-reminders`
- `canvas`
- `feishu-bitable-attachment-uploader`
- `feishu-channel-rules`
- `feishu-create-doc`
- `feishu-fetch-doc`
- `feishu-file-sender`
- `feishu-office-toolkit`
- `feishu-troubleshoot`
- `feishu-update-doc`
- `flutter-dev`
- `gemini-browser-image`
- `gif-sticker-maker`
- `gog`
- `humanizer-zh`
- `ios-application-dev`
- `markdown-converter`
- `minimax-xlsx`
- `qwen3-tts-apple-silicon`
- `react-native-dev`
- `redbook-skills`
- `security-triage`
- `suno-api-client`
- `taskflow`
- `tikhub`
- `transnetv2-scene-detect`
- `ui-ux-pro-max`
- `vercel-react-best-practices`
- `video-analysis-workflow`
- `video-clip-skill`
- `video-understand`
- `word-processor`

判断规则：

- 当 skill specialized、optional、experimental 或 ecosystem-specific 时，优先使用这个目录，而不是 `skills/`。
- 不要把这个目录描述成产品运行时架构。
- 如果某个 skill 晋升为默认体验，应有意移动到 `skills/`，不要把两个目录当作可互换。

## Extension-Scoped Skills

Extension-local skills 通常位于 `extensions/*/skills/`，也有少数在 extension 根目录直接定义，因为 package
本身就是 skill surface。

当说明与某个 extension 的 tooling、config、identity 或 workflow boundary 紧密绑定时，使用这个 surface。
这类 skills 应靠近拥有它的 extension，而不是复制到 repo-wide bundled surface。

当前 extension-scoped set：

- `extensions/acpx/skills/acp-router`
- `extensions/open-prose/skills/prose`

判断规则：

- 把 extension-owned skills 留在拥有对应 tools 和 config 的 extension 中。
- 不要为了让 repo root 看起来更简单，就把 extension-local skills 移到 `skills/`。
- 如果 skill 依赖某个 extension 的用户/bot identity split、tool names 或 config contract，它就属于该 extension。
- 多 skill extensions 优先使用 `extensions/<name>/skills/<skill>/SKILL.md`；只有当 extension package 本身就是唯一
  skill surface 时，才保留 root-level `extensions/<name>/SKILL.md`。

## Ownership 和阅读顺序

需要理解仓库 skill surface 时，按下面顺序阅读：

1. `docs/tools/skills.md`：load order、precedence 和 gating behavior
2. `skills/README.md`：bundled core surface
3. `skills-optional/README.md`：optional catalog boundary
4. `extensions/README.md` 加上 owning extension package：extension-local skills

这能把 packaging 问题和 runtime loading 问题分开。

## 维护规则

添加或重组 skills 时：

- 修改某个 skill surface 的含义时，更新最近的 local README。
- skill placement 要和 ownership 对齐，而不是只看命名相似度。
- 在大批量移动 skills 之前，优先先用 docs 澄清边界。
- 把 extension-local skills 当作 extension contract 的一部分，而不是通用 repo clutter。

如果仓库未来引入专门的 catalog root，应把它视为边界已经写清楚之后的 packaging move。
