# Optional Skills 目录说明

这个目录是 CrawClaw 仓库内的可选 skills 目录。

如果你想看整个仓库里 bundled、optional、extension-owned 三类 skill 的
整体分布，请看：
https://docs.crawclaw.ai/maintainers/skills-catalog

`skills-optional/` 不属于主运行时代码路径，不应该被当成产品核心架构来理解。
这里的内容更适合被视为能力资产或内容资产，后续可以被安装、引用、适配，或者
在成熟后再提升到别的 skill surface。

## 这里应该放什么

适合放进这个目录的内容：

- 不应该作为默认 bundled set 一起发出的 optional skills
- 值得保留在仓库里、但偏垂直或偏场景化的 skills
- skill 打包方式或能力设计方向的实验
- 未来可能迁移到独立 catalog 或 extension surface 的 workflow pack

不应该放进这个目录的内容：

- 应该进入 `../skills/` 的默认 bundled skills
- 应该跟随所属扩展放在 `../extensions/*/skills/` 下的 extension-owned skills
- `src/` 下的产品运行时代码

## 当前目录内容

当前目录一共有 38 个 optional skills。下面的分组只是为了方便阅读，不代表运行时
加载语义。

### 生产力与个人工具

- `1password`
- `apple-notes`
- `apple-reminders`
- `gog`
- `markdown-converter`
- `word-processor`

### 飞书与办公自动化

- `feishu-bitable-attachment-uploader`
- `feishu-channel-rules`
- `feishu-create-doc`
- `feishu-fetch-doc`
- `feishu-file-sender`
- `feishu-office-toolkit`
- `feishu-troubleshoot`
- `feishu-update-doc`

### 应用开发与 UI 工作

- `android-native-dev`
- `flutter-dev`
- `ios-application-dev`
- `react-native-dev`
- `ui-ux-pro-max`
- `vercel-react-best-practices`

### 媒体生成、分析与本地处理

- `canvas`
- `gemini-browser-image`
- `gif-sticker-maker`
- `minimax-pdf`
- `minimax-xlsx`
- `qwen3-tts-apple-silicon`
- `suno-api-client`
- `transnetv2-scene-detect`
- `video-analysis-workflow`
- `video-clip-skill`
- `video-understand`

### 社媒、创作者与平台工作流

- `grok-video-web`
- `humanizer-zh`
- `platform-login-helper`
- `redbook-skills`
- `tikhub`

### 工作流、运维与安全

- `security-triage`
- `taskflow`

## 放置规则

判断一个 skill 该不该继续放在这里时，参考下面的规则：

- 如果它偏专用、偏实验、偏操作员场景，或者不适合默认 bundled experience，就继续放在 `skills-optional/`
- 如果它已经足够通用，适合默认一起发出，再考虑迁到 `../skills/`
- 如果它强依赖某个 extension 的工具、配置、身份边界或 workflow contract，就迁到 `../extensions/*/skills/`

## 本地打包说明

有些 optional skill 会自带额外本地资产，例如：

- `_meta.json`，用于 catalog 元数据
- `AGENTS.md`，用于局部协作说明
- skill 目录下的脚本、模板或 references

这些资产应该跟着所属 skill 放在一起。除非真的出现跨 skill 的共享契约，否则不要
额外拆出新的共享层。

## 维护建议

- 优先先做文档整理，再做大批量目录迁移。
- 除非确实有迁移计划，否则尽量保持 skill 名称稳定。
- 如果某个 skill “毕业”了，需要同步更新这个 README 和
  `docs/maintainers/skills-catalog.md`。

如果仓库后续继续重组，这个目录更适合被移动到一个更明确的 catalog 型父目录下，
而不是长期停留在仓库根目录。
