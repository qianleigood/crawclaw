# Skills 审计

当前仓库共有 `69` 个 skill，分布在：

- [`skills/`](/Users/qianleilei/crawclaw-source-shallow/skills)：默认 bundled core skills
- [`skills-optional/`](/Users/qianleilei/crawclaw-source-shallow/skills-optional)：optional skills

这轮审计按当前 `skill-creator` 标准执行：

- `SKILL.md` 保持精简，并带标准 frontmatter
- 辅助材料下沉到 `references/`
- skill 目录顶层尽量不再放额外说明文档
- 先修结构错误，再做内容压缩

## 本轮已修复

- 修正 `taskflow-inbox-triage/SKILL.md` 的 frontmatter，之后该示例 skill 已被删除
- 给下面两个 skill 补上 `references/` 入口：
  - [tikhub/SKILL.md](/Users/qianleilei/crawclaw-source-shallow/skills-optional/tikhub/SKILL.md)
- 将顶层多余 `README.md` 下沉到 `references/README.md`：
  - [feishu-file-sender](/Users/qianleilei/crawclaw-source-shallow/skills-optional/feishu-file-sender)
  - [feishu-office-toolkit](/Users/qianleilei/crawclaw-source-shallow/skills-optional/feishu-office-toolkit)
  - [humanizer-zh](/Users/qianleilei/crawclaw-source-shallow/skills-optional/humanizer-zh)
  - [minimax-pdf](/Users/qianleilei/crawclaw-source-shallow/skills-optional/minimax-pdf)
  - [redbook-skills](/Users/qianleilei/crawclaw-source-shallow/skills-optional/redbook-skills)
  - `tavily-web-search-for-crawclaw`
  - [transnetv2-scene-detect](/Users/qianleilei/crawclaw-source-shallow/skills-optional/transnetv2-scene-detect)
  - [vercel-react-best-practices](/Users/qianleilei/crawclaw-source-shallow/skills-optional/vercel-react-best-practices)

## 最终状态

当前审计结果：

- 缺少 `SKILL.md`：`0`
- 缺少 frontmatter：`0`
- 顶层多余说明文件（`README.md` / `CHANGELOG.md` / `TODO.md`）：`0`
- 有 `references/` 但没在 `SKILL.md` 里挂入口：`0`
- 过长 `SKILL.md`（>120 行）：`0`

也就是说，这一轮已经把全部 skill 收成了“薄 `SKILL.md` + 更深 `references/`”的结构。

## 后续优先级

1. 后续新增或更新 skill 继续维持“薄 `SKILL.md` + 厚 `references/`”模式。
2. 不要再在 skill 目录顶层重新引入 `README.md` 这类重复说明。
3. 细节优先放 `references/` 和脚本，不要重新把大段示例堆回主说明。

## 最终清理中删除的 skill

- `graph-memory-writeback`
- `low-fan-content-lab`
- `crawclaw-release-maintainer`
- `feishu-doc`
- `feishu-drive`
- `feishu-wiki`
- `feishu-bitable`
- `feishu-calendar`
- `feishu-task`
- `feishu-im-read`
- `clawhub`
- `exa-web-search-free`
- `seedance`
- `seedance-2-prompt-engineering-skill`
- `seedance2-skill`
- `xiaohongshuskills`
- `office`
- `tavily-web-search-for-crawclaw`
- `taskflow-inbox-triage`
- `scene-detect`
- `frontend-design`
- `xhs-transcriber`
- `ai-goofish-monitor-client`
- `jimeng-seedance-web`
- `video-frames`
- `bing-search-cn`
- `scrapling-official`
- `xhs-auto-import`
- `ima-skill`
- `gpt-best-image`
- `gemini`
