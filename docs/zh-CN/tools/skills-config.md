---
read_when:
  - 添加或修改 Skills 配置
  - 调整捆绑允许列表或安装行为
summary: Skills 配置 schema 和示例
title: Skills 配置
x-i18n:
  generated_at: "2026-06-05T14:52:16Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: df68124333b0fb01e3dad5d53d6dcabe2c40457fe3196339c9be8c18d68a0c19
  source_path: tools/skills-config.md
  workflow: 15
---

# Skills 配置

所有与 Skills 相关的配置都位于 `~/.crawclaw/crawclaw.json` 的 `skills` 下。

```json5
{
  skills: {
    allowBundled: ["gemini", "peekaboo"],
    load: {
      extraDirs: ["~/Projects/agent-scripts/skills", "~/Projects/oss/some-skill-pack/skills"],
      watch: true,
      watchDebounceMs: 250,
    },
    install: {
      preferBrew: true,
      nodeManager: "npm", // npm | pnpm | yarn | bun（Gateway 运行时仍是 Node；不建议使用 bun）
    },
    entries: {
      "image-lab": {
        enabled: true,
        apiKey: { source: "env", provider: "default", id: "GEMINI_API_KEY" }, // 或明文字符串
        env: {
          GEMINI_API_KEY: "GEMINI_KEY_HERE",
        },
      },
      peekaboo: { enabled: true },
      sag: { enabled: false },
    },
  },
}
```

`skills.entries.*` 仅用于自定义或第三方 Skill 工作流。

## 字段

- 内置 Skill 根目录始终包含 `~/.crawclaw/skills`、`~/.agents/skills`、`<workspace>/.agents/skills` 和 `<workspace>/skills`。
- `allowBundled`：仅针对**捆绑** Skills 的可选允许列表。设置后，仅列表中的捆绑 Skills 符合条件（受管、智能体和工作区 Skills 不受影响）。
- `load.extraDirs`：要扫描的附加 Skill 目录（最低优先级）。
- `load.watch`：监视 Skill 文件夹并刷新 Skills 快照（默认：true）。
- `load.watchDebounceMs`：Skill 监视器事件的防抖时间（毫秒，默认：250）。
- `install.preferBrew`：在可用时优先使用 brew 安装程序（默认：true）。
- `install.nodeManager`：node 安装程序偏好（`npm` | `pnpm` | `yarn` | `bun`，默认：npm）。
  这仅影响 **Skill 安装**；Gateway 运行时仍应为 Node（Weixin/Feishu 不建议使用 Bun）。
- `entries.<skillKey>`：每个 Skill 的覆盖。

每个 Skill 的字段：

- `enabled`：设置为 `false` 可禁用 Skill，即使它已捆绑/安装。
- `env`：为智能体运行注入的环境变量（仅在未设置时）。
- `apiKey`：对声明主要 env 变量的 Skills 的可选便捷选项。
  支持明文字符串或 SecretRef 对象（`{ source, provider, id }`）。

## 注意事项

- `entries` 下的键默认映射到 Skill 名称。如果 Skill 定义了 `metadata.crawclaw.skillKey`，请改用该键。
- 加载优先级为 `<workspace>/skills` → `<workspace>/.agents/skills` → `~/.agents/skills` → `~/.crawclaw/skills` → 捆绑 Skills → `skills.load.extraDirs`。
- 启用监视器时，对 Skills 的更改会在下一个智能体轮次时生效。
- 捆绑的核心 Skill 辅助依赖由原生运行时拥有并提交需求锁文件。
  每个 Skill 的安装程序元数据用于可选的外部工具，不用于核心 Skill Python 包引导。

使用以下其中之一：

全局 `env` 和 `skills.entries.<skill>.env/apiKey` 仅适用于**主机**运行。
