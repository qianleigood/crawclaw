---
read_when:
  - 你需要知道哪些环境变量被加载，以及加载顺序
  - 你在调试 Gateway 网关中缺失的 API 密钥
  - 你在编写提供商认证或部署环境的文档
summary: CrawClaw 从哪里加载环境变量以及优先级顺序
title: 环境变量
x-i18n:
  generated_at: "2026-02-03T07:47:11Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: b49ae50e5d306612f89f93a86236188a4f2ec23f667e2388b043832be3ac1546
  source_path: help/environment.md
  workflow: 15
---

# 环境变量

CrawClaw 从多个来源拉取环境变量。规则是**永不覆盖现有值**。

## 优先级（从高到低）

1. **进程环境**（Gateway 网关进程从父 shell/守护进程已有的内容）。
2. **当前工作目录中的 `.env`**（dotenv 默认；不覆盖）。
3. **全局 `.env`** 位于 `~/.crawclaw/.env`（即 `$CRAWCLAW_STATE_DIR/.env`；兼容旧版 `$CRAWCLAW_STATE_DIR/.env`；不覆盖）。
4. **配置 `env` 块** 位于 `~/.crawclaw/crawclaw.json`（兼容旧版 `~/.crawclaw/crawclaw.json`；仅在缺失时应用）。
5. **可选的登录 shell 导入**（`env.shellEnv.enabled` 或 `CRAWCLAW_LOAD_SHELL_ENV=1`；兼容旧版 `CRAWCLAW_LOAD_SHELL_ENV=1`），仅对缺失的预期键名应用。

如果配置文件完全缺失，步骤 4 将被跳过；如果启用了 shell 导入，它仍会运行。

## 配置 `env` 块

两种等效方式设置内联环境变量（都是非覆盖的）：

```json5
{
  env: {
    OPENROUTER_API_KEY: "sk-or-...",
    vars: {
      GROQ_API_KEY: "gsk-...",
    },
  },
}
```

## Shell 环境导入

`env.shellEnv` 运行你的登录 shell 并仅导入**缺失的**预期键名：

```json5
{
  env: {
    shellEnv: {
      enabled: true,
      timeoutMs: 15000,
    },
  },
}
```

环境变量等效项：

- `CRAWCLAW_LOAD_SHELL_ENV=1`（兼容 `CRAWCLAW_LOAD_SHELL_ENV=1`）
- `CRAWCLAW_SHELL_ENV_TIMEOUT_MS=15000`（兼容 `CRAWCLAW_SHELL_ENV_TIMEOUT_MS=15000`）

## 运行时注入的环境变量

CrawClaw 还会向子进程注入一些运行时标记：

- `CRAWCLAW_SHELL=exec`（兼容 `CRAWCLAW_SHELL=exec`）：通过 `exec` 工具启动的命令。
- `CRAWCLAW_SHELL=acp`（兼容 `CRAWCLAW_SHELL=acp`）：ACP 运行时后端进程。
- `CRAWCLAW_SHELL=acp-client`（兼容 `CRAWCLAW_SHELL=acp-client`）：`crawclaw acp client` 拉起 ACP bridge 时。
- `CRAWCLAW_SHELL=tui-local`（兼容 `CRAWCLAW_SHELL=tui-local`）：本地 TUI 的 `!` shell 命令。

## 终端环境变量

- `CRAWCLAW_THEME=light`（兼容 `CRAWCLAW_THEME=light`）：强制使用浅色 TUI 配色。
- `CRAWCLAW_THEME=dark`（兼容 `CRAWCLAW_THEME=dark`）：强制使用深色 TUI 配色。
- `COLORFGBG`：如果终端提供该变量，CrawClaw 会用它辅助判断 TUI 背景色。

这些是运行时标记，不是用户必须配置的变量。

## 路径相关环境变量

| 变量                                                  | 作用                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `CRAWCLAW_HOME`（兼容 `CRAWCLAW_HOME`）               | 覆盖所有内部路径解析使用的主目录。                   |
| `CRAWCLAW_STATE_DIR`（兼容 `CRAWCLAW_STATE_DIR`）     | 覆盖状态目录，默认 `~/.crawclaw`。                   |
| `CRAWCLAW_CONFIG_PATH`（兼容 `CRAWCLAW_CONFIG_PATH`） | 覆盖配置文件路径，默认 `~/.crawclaw/crawclaw.json`。 |
| `CRAWCLAW_OAUTH_DIR`（兼容 `CRAWCLAW_OAUTH_DIR`）     | 覆盖 OAuth 凭据目录。                                |

## 日志

| 变量                                              | 作用                           |
| ------------------------------------------------- | ------------------------------ |
| `CRAWCLAW_LOG_LEVEL`（兼容 `CRAWCLAW_LOG_LEVEL`） | 覆盖文件日志和控制台日志级别。 |

## nvm 用户：web_fetch TLS 失败

如果 Node.js 是通过 **nvm** 安装的，而不是系统包管理器，某些 Linux 环境里内置 `fetch()` 可能拿不到完整 CA 证书链，导致 `web_fetch` 报 `"fetch failed"`。

在 Linux 上，CrawClaw 会尽量自动修复：

- `crawclaw gateway install` 会把 `NODE_EXTRA_CA_CERTS` 写入 systemd 服务环境。
- `crawclaw` CLI 入口会在 Node 启动前带上 `NODE_EXTRA_CA_CERTS` 重新执行自己。

手动修复示例：

```bash
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
crawclaw gateway run
```

不要只把这个变量写进 `~/.crawclaw/.env`；Node 会在进程启动时读取它。

## 配置中的环境变量替换

你可以使用 `${VAR_NAME}` 语法在配置字符串值中直接引用环境变量：

```json5
{
  models: {
    providers: {
      "vercel-gateway": {
        apiKey: "${VERCEL_GATEWAY_API_KEY}",
      },
    },
  },
}
```

完整详情参见[配置：环境变量替换](/gateway/configuration#env-var-substitution-in-config)。

## 相关内容

- [Gateway 网关配置](/gateway/configuration)
- [常见问题：环境变量和 .env 加载](/help/faq#env-vars-and-env-loading)
- [模型概述](/concepts/models)
