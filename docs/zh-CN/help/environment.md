---
read_when:
  - 你需要了解加载了哪些环境变量以及加载顺序
  - 你在调试 Gateway 中缺失的 API 密钥
  - 你在编写提供商认证或部署环境文档
summary: CrawClaw 加载环境变量的位置及优先级顺序
title: 环境变量
x-i18n:
  generated_at: "2026-06-05T14:31:44Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d9deaa38de2afeba7e5fd04e6db17b90c8fc8a73fd9fc314447a054b8a73ab47
  source_path: help/environment.md
  workflow: 15
---

# 环境变量

CrawClaw 从多个来源获取环境变量。规则是**永远不会覆盖已存在的值**。

## 优先级（从高到低）

1. **进程环境**（Gateway 进程从父 shell/守护进程已继承的环境）。
2. **当前工作目录下的 `.env`**（dotenv 默认配置；不覆盖）。
3. **全局 `.env`** 位于 `~/.crawclaw/.env`（即 `$CRAWCLAW_STATE_DIR/.env`，旧版：`$CRAWCLAW_STATE_DIR/.env`；不覆盖）。
4. **配置中的 `env` 块** 位于 `~/.crawclaw/crawclaw.json`（旧版：`~/.crawclaw/crawclaw.json`；仅在缺失时应用）。
5. **可选的登录 shell 导入**（`env.shellEnv.enabled` 或 `CRAWCLAW_LOAD_SHELL_ENV=1`，旧版：`CRAWCLAW_LOAD_SHELL_ENV=1`），仅对缺失的预期键名应用。

如果配置文件完全缺失，则跳过步骤 4；shell 导入在启用时仍会运行。

## 配置 `env` 块

两种等效的设置内联环境变量方式（均不覆盖）：

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

环境变量等效配置：

- `CRAWCLAW_LOAD_SHELL_ENV=1`（旧版：`CRAWCLAW_LOAD_SHELL_ENV=1`）
- `CRAWCLAW_SHELL_ENV_TIMEOUT_MS=15000`（旧版：`CRAWCLAW_SHELL_ENV_TIMEOUT_MS=15000`）

## 运行时注入的环境变量

CrawClaw 还会将上下文标记注入到生成的子进程中：

- `CRAWCLAW_SHELL=exec`（旧版：`CRAWCLAW_SHELL=exec`）：为通过 `exec` 工具运行的命令设置。
- `CRAWCLAW_SHELL=acp`（旧版：`CRAWCLAW_SHELL=acp`）：为 ACP 运行时后端进程生成设置（例如 `acpx`）。
- `CRAWCLAW_SHELL=acp-client`（旧版：`CRAWCLAW_SHELL=acp-client`）：为 CrawClaw Desktop 或本地 Gateway API 生成 ACP 网桥进程时设置。

这些是运行时标记（非必需的用户配置）。你可以在 shell/profile 逻辑中使用它们来应用特定于上下文的规则。

## 终端环境变量

- `CRAWCLAW_LANG=zh-CN`：当未设置 `--lang` 和 `cli.language` 时，设置 CLI 语言。

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

详情请参阅[配置：环境变量替换](/gateway/configuration-reference#env-var-substitution)。

## Secret 引用与 `${ENV}` 字符串

CrawClaw 支持两种环境驱动的模式：

- 配置值中的 `${VAR}` 字符串替换。
- SecretRef 对象（`{ source: "env", provider: "default", id: "VAR" }`），用于支持 secret 引用的字段。

两者均在激活时从进程环境解析。SecretRef 详情请参阅[密钥管理](/gateway/secrets)。

## 路径相关环境变量

| 变量                                             | 用途                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `CRAWCLAW_HOME`（`CRAWCLAW_HOME`）               | 覆盖用于所有内部路径解析的主目录（`~/.crawclaw/`、智能体目录、会话、凭证）。在以专用服务用户身份运行 CrawClaw 时很有用。 |
| `CRAWCLAW_STATE_DIR`（`CRAWCLAW_STATE_DIR`）     | 覆盖状态目录（默认 `~/.crawclaw`）。                                                                                     |
| `CRAWCLAW_CONFIG_PATH`（`CRAWCLAW_CONFIG_PATH`） | 覆盖配置文件路径（默认 `~/.crawclaw/crawclaw.json`）。                                                                   |
| `CRAWCLAW_OAUTH_DIR`（`CRAWCLAW_OAUTH_DIR`）     | 覆盖 OAuth 凭证目录。                                                                                                    |

## 日志记录

| 变量                                         | 用途                                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRAWCLAW_LOG_LEVEL`（`CRAWCLAW_LOG_LEVEL`） | 覆盖文件和控制台两者的日志级别（例如 `debug`、`trace`）。优先于配置中的 `logging.level` 和 `logging.consoleLevel`。无效值会被忽略并附带警告。 |

### `CRAWCLAW_HOME`

设置后，`CRAWCLAW_HOME` 将替换所有内部路径解析使用的系统主目录（`$HOME` / `os.homedir()`）。旧版 `CRAWCLAW_HOME` 仍被接受。这可以为无头服务账户启用完整的文件系统隔离。

**优先级：** `CRAWCLAW_HOME` > `CRAWCLAW_HOME` > `$HOME` > `USERPROFILE` > `os.homedir()`

**示例**（macOS LaunchDaemon）：

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>CRAWCLAW_HOME</key>
  <string>/Users/user</string>
</dict>
```

`CRAWCLAW_HOME` 也可以设置为波浪号路径（例如 `~/svc`），在使用前会使用 `$HOME` 展开。

## nvm 用户：web_fetch TLS 失败

如果 Node.js 是通过 **nvm**（而非系统包管理器）安装的，则内置的 `fetch()` 使用 nvm 绑定的 CA 存储，可能缺少现代根证书（Let's Encrypt 的 ISRG Root X1/X2、DigiCert Global Root G2 等）。这会导致 `web_fetch` 在大多数 HTTPS 网站上失败并显示 `"fetch failed"`。

在 Linux 上，CrawClaw 会自动检测 nvm 并在实际启动环境中应用修复：

- CrawClaw Desktop 或本地 Gateway API 将 `NODE_EXTRA_CA_CERTS` 写入 systemd 服务环境
- CrawClaw Desktop 和 Gateway API 客户端从其主机运行时环境继承受信任的 CA 设置

**手动修复**（适用于旧版本或直接 `node ...` 启动）：

在启动 CrawClaw 前导出该变量：

```bash
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
```

不要依赖仅写入 `~/.crawclaw/.env` 来设置此变量；Node 在进程启动时读取 `NODE_EXTRA_CA_CERTS`。

## 相关

- [Gateway 配置](/gateway/configuration)
- [常见问题：环境变量和 .env 加载](/help/faq#env-vars-and-env-loading)
- [模型概述](/concepts/models)
