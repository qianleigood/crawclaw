---
read_when:
  - 首次设置 CrawClaw
  - 查找常见配置模式
  - 导航到特定配置部分
summary: 配置概览：常见任务、快速设置及完整参考链接
title: 配置
x-i18n:
  generated_at: "2026-06-10T18:01:49Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: f2578b0f0bd66422264248e912dc86f508f30f4b68163d5ad672586e8a9740b0
  source_path: gateway/configuration.md
  workflow: 15
---

# 配置

CrawClaw 读取一个可选的 <Tooltip tip="JSON5 supports comments and trailing commas">**JSON5**</Tooltip> 配置文件来自 `~/.crawclaw/crawclaw.json`。

如果文件缺失，CrawClaw 使用安全默认值。添加配置的常见原因：

- 连接渠道并控制谁能向机器人发送消息
- 调整会话、媒体、网络或 UI

参见 [完整参考](/gateway/configuration-reference) 了解每个可用字段的详细信息。

<Tip>
**不熟悉配置？** 从 CrawClaw Desktop 或本地 Gateway 协议 API 开始进行交互式设置，或查看[配置示例](/gateway/configuration-examples)指南，获取可直接复制的完整配置。
</Tip>

## 最小配置

```json5
// ~/.crawclaw/crawclaw.json
{
  agents: { defaults: { workspace: "~/.crawclaw/workspace" } },
  channels: { feishu: { allowFrom: ["user:ou_xxx"] } },
}
```

## 编辑配置

<Tabs>
  <Tab title="Desktop">
    打开 **CrawClaw Desktop → 设置**，然后使用相关部分配置渠道、模型、插件、Gateway 或运行时设置。
  </Tab>
  <Tab title="Gateway API">
    自动化应使用本地 Gateway 协议 API。优先使用类型化的 JSON 方法，而非通过命令包装器调用。
  </Tab>
  <Tab title="Direct edit">
    直接编辑 `~/.crawclaw/crawclaw.json`。Gateway 会监听该文件并自动应用更改。
  </Tab>
</Tabs>

## 严格验证

<Warning>
CrawClaw 仅接受完全符合 schema 的配置。未知键名、类型格式错误或无效值都会导致 Gateway **拒绝启动**。唯一的根级例外是 `$schema`（字符串），以便编辑器附加 JSON Schema 元数据。
</Warning>

验证失败时：

- Gateway 无法启动
- 使用 CrawClaw Desktop 诊断或本地 Gateway 协议 API 查看具体问题
- 通过 Desktop 设置或写入修正后的 JSON 配置来应用修复

## 常见任务

<AccordionGroup>
  <Accordion title="Set up a channel">
    绑定的 TypeScript 渠道插件已被移除。仓库自有的渠道以 Rust 原生适配器的形式通过 Gateway 渠道 API 重新引入。当前原生目录包括 `ddingtalk`、`esp32`、`feishu`、`qqbot` 和 `weixin`。

    All channels share the same DM policy pattern:

    ```json5
    {
      channels: {
        feishu: {
          enabled: true,
          dmPolicy: "pairing",   // pairing | allowlist | open | disabled
          allowFrom: ["user:ou_xxx"], // only for allowlist/open
        },
      },
    }
    ```

  </Accordion>

  <Accordion title="Choose and configure models">
    设置主模型和可选回退模型：

    ```json5
    {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["openai/gpt-5.2"],
          },
          models: {
            "anthropic/claude-sonnet-4-6": { alias: "Sonnet" },
            "openai/gpt-5.2": { alias: "GPT" },
          },
        },
      },
    }
    ```

    - `agents.defaults.models` defines the model catalog and acts as the allowlist for `/model`.
    - Model refs use `provider/model` format (e.g. `anthropic/claude-opus-4-6`).
    - `agents.defaults.imageMaxDimensionPx` controls transcript/tool image downscaling (default `1200`); lower values usually reduce vision-token usage on screenshot-heavy runs.
    - See [Models](/concepts/models) for switching models in chat and [Model Failover](/concepts/model-failover) for auth rotation and fallback behavior.
    - For custom/self-hosted providers, see [Custom providers](/gateway/configuration-reference#custom-providers-and-base-urls) in the reference.

  </Accordion>

  <Accordion title="Control who can message the bot">
    私信访问权限由 `dmPolicy` 按渠道控制：

    - `"pairing"` (default): unknown senders get a one-time pairing code to approve
    - `"allowlist"`: only senders in `allowFrom` (or the paired allow store)
    - `"open"`: allow all inbound DMs (requires `allowFrom: ["*"]`)
    - `"disabled"`: ignore all DMs

    For groups, use `groupPolicy` + `groupAllowFrom` or channel-specific allowlists.

    See the [full reference](/gateway/configuration-reference#dm-and-group-access) for per-channel details.

  </Accordion>

  <Accordion title="Set up group chat mention gating">
    群组消息默认 **需要提及**。按智能体配置模式：

    ```json5
    {
      agents: {
        list: [
          {
            id: "main",
            groupChat: {
              mentionPatterns: ["@crawclaw", "crawclaw"],
            },
          },
        ],
      },
      channels: {
        weixin: {
          groups: { "*": { requireMention: true } },
        },
      },
    }
    ```

    - **Metadata mentions**: native @-mentions (Weixin tap-to-mention, Feishu @bot, etc.)
    - **Text patterns**: safe regex patterns in `mentionPatterns`
    - See [full reference](/gateway/configuration-reference#group-chat-mention-gating) for per-channel overrides and self-chat mode.

  </Accordion>

  <Accordion title="Tune gateway channel health monitoring">
    控制 Gateway 重启疑似无响应渠道的激进程度：

    ```json5
    {
      gateway: {
        channelHealthCheckMinutes: 5,
        channelStaleEventThresholdMinutes: 30,
        channelMaxRestartsPerHour: 10,
      },
      channels: {
        feishu: {
          healthMonitor: { enabled: false },
          accounts: {
            alerts: {
              healthMonitor: { enabled: true },
            },
          },
        },
      },
    }
    ```

    - Set `gateway.channelHealthCheckMinutes: 0` to disable health-monitor restarts globally.
    - `channelStaleEventThresholdMinutes` should be greater than or equal to the check interval.
    - Use `channels.<provider>.healthMonitor.enabled` or `channels.<provider>.accounts.<id>.healthMonitor.enabled` to disable auto-restarts for one channel or account without disabling the global monitor.
    - See [Health Checks](/gateway/health) for operational debugging and the [full reference](/gateway/configuration-reference#gateway) for all fields.

  </Accordion>

  <Accordion title="Configure sessions and resets">
    会话控制对话连续性和隔离：

    ```json5
    {
      session: {
        dmScope: "per-channel-peer",  // recommended for multi-user
        threadBindings: {
          enabled: true,
          idleHours: 24,
          maxAgeHours: 0,
        },
        reset: {
          mode: "daily",
          atHour: 4,
          idleMinutes: 120,
        },
      },
    }
    ```

    - `dmScope`: `main` (shared) | `per-peer` | `per-channel-peer` | `per-account-channel-peer`
    - `threadBindings`: global defaults for thread-bound session routing (QQBot supports `/focus`, `/unfocus`, `/agents`, `/session idle`, and `/session max-age`).
    - See [Session Management](/concepts/session) for scoping, identity links, and send policy.
    - See [full reference](/gateway/configuration-reference#session) for all fields.

  </Accordion>

  <Accordion title="Troubleshoot Chromium sandbox startup">
    保持 Chromium 沙箱隔离启用，除非浏览器运行时无法在你的主机环境中启动。如果 Chromium 因主机阻止沙箱设置而失败，则仅禁用浏览器沙箱相关标志：

    ```json5
    {
      browser: {
        noSandbox: true,
      },
    }
    ```

    - `browser.noSandbox` reduces Chromium process isolation; leave it unset
      unless browser startup fails.
    - See the [full reference](/gateway/configuration-reference#browser) for
      Browser fields.

  </Accordion>

  <Accordion title="Replace legacy heartbeat with cron">
    ```json5
    {
      cron: {
        enabled: true,
      },
    }
    ```

    Legacy periodic agent heartbeat is no longer configured by default. Use
    [Scheduled Tasks](/automation/cron-jobs) for new periodic checks and
    [Heartbeat](/gateway/heartbeat) for compatibility notes.

  </Accordion>

  <Accordion title="Configure cron jobs">
    ```json5
    {
      cron: {
        enabled: true,
        maxConcurrentRuns: 2,
        sessionRetention: "24h",
        runLog: {
          maxBytes: "2mb",
          keepLines: 2000,
        },
      },
    }
    ```

    - `sessionRetention`: prune completed isolated run sessions from `sessions.json` (default `24h`; set `false` to disable).
    - `runLog`: prune `cron/runs/<jobId>.jsonl` by size and retained lines.
    - See [Cron jobs](/automation/cron-jobs) for feature overview and Gateway API examples.

  </Accordion>

  <Accordion title="Set up webhooks (hooks)">
    在 Gateway 上启用 HTTP webhook 端点：

    ```json5
    {
      hooks: {
        enabled: true,
        token: "shared-secret",
        path: "/hooks",
        defaultSessionKey: "hook:ingress",
        allowRequestSessionKey: false,
        allowedSessionKeyPrefixes: ["hook:"],
        mappings: [
          {
            match: { path: "gmail" },
            action: "agent",
            agentId: "main",
            deliver: true,
          },
        ],
      },
    }
    ```

    Security note:
    - Treat all hook/webhook payload content as untrusted input.
    - Keep unsafe-content bypass flags disabled (`hooks.gmail.allowUnsafeExternalContent`, `hooks.mappings[].allowUnsafeExternalContent`) unless doing tightly scoped debugging.

    See [full reference](/gateway/configuration-reference#hooks) for all mapping options and Gmail integration.

  </Accordion>

  <Accordion title="Configure multi-agent routing">
    运行多个隔离的智能体，每个智能体拥有独立的工作空间和会话：

    ```json5
    {
      agents: {
        list: [
          { id: "home", default: true, workspace: "~/.crawclaw/workspace-home" },
          { id: "work", workspace: "~/.crawclaw/workspace-work" },
        ],
      },
      bindings: [
        { agentId: "home", match: { channel: "weixin", accountId: "personal" } },
        { agentId: "work", match: { channel: "weixin", accountId: "biz" } },
      ],
    }
    ```

    See [Multi-Agent](/concepts/multi-agent) and [full reference](/gateway/configuration-reference#multi-agent-routing) for binding rules and per-agent access profiles.

  </Accordion>

  <Accordion title="Split config into multiple files ($include)">
    使用 `$include` 来组织大型配置：

    ```json5
    // ~/.crawclaw/crawclaw.json
    {
      gateway: { port: 18789 },
      agents: { $include: "./agents.json5" },
      broadcast: {
        $include: ["./clients/a.json5", "./clients/b.json5"],
      },
    }
    ```

    - **Single file**: replaces the containing object
    - **Array of files**: deep-merged in order (later wins)
    - **Sibling keys**: merged after includes (override included values)
    - **Nested includes**: supported up to 10 levels deep
    - **Relative paths**: resolved relative to the including file
    - **Error handling**: clear errors for missing files, parse errors, and circular includes

  </Accordion>
</AccordionGroup>

## 配置 RPC（程序化更新）

<Note>
控制平面写 RPC（`config.apply`、`config.patch`、`update.run`）按 `deviceId+clientIp` 限速为 **每 60 秒 3 次请求**。触发限速时，RPC 返回 `UNAVAILABLE`，附带 `retryAfterMs`。
</Note>

<AccordionGroup>
  <Accordion title="config.apply (full replace)">
    验证并写入完整配置。部分设置会被动态读取以供后续操作使用；启动时绑定的 Gateway 设置在重启 CrawClaw Desktop 后生效。

    <Warning>
    `config.apply` replaces the **entire config**. Use `config.patch` for partial updates, or CrawClaw Desktop or the local Gateway API for single keys.
    </Warning>

    Params:

    - `raw` (string) — JSON5 payload for the entire config
    - `baseHash` (optional) — config hash from `config.get` (required when config exists)
    - `sessionKey` (optional) — session key for a follow-up wake ping
    - `note` (optional) — operator note stored with the write request

    ```json5
    {
      "raw": "{ agents: { defaults: { workspace: \"~/.crawclaw/workspace\" } } }",
      "baseHash": "<hash>",
      "sessionKey": "agent:main:weixin:direct:+15555550123",
    }
    ```

  </Accordion>

  <Accordion title="config.patch (partial update)">
    将部分更新合并到现有配置中（JSON 合并补丁语义）：

    - Objects merge recursively
    - `null` deletes a key
    - Arrays replace

    Params:

    - `raw` (string) — JSON5 with just the keys to change
    - `baseHash` (required) — config hash from `config.get`
    - `sessionKey`, `note` — same as `config.apply`

    Runtime behavior matches `config.apply`.

    ```json5
    {
      "raw": "{ channels: { feishu: { groups: { \"*\": { requireMention: false } } } } }",
      "baseHash": "<hash>",
    }
    ```

  </Accordion>
</AccordionGroup>

## 环境变量

CrawClaw 从父进程读取环境变量，另外还会读取：

- `.env` 当前工作目录中的 .env 文件（如存在）
- `~/.crawclaw/.env` （全局回退）

两个文件都不会覆盖已存在的环境变量。你也可以在配置中设置内联环境变量：

```json5
{
  env: {
    OPENROUTER_API_KEY: "sk-or-...",
    vars: { GROQ_API_KEY: "gsk-..." },
  },
}
```

<Accordion title="Shell env import (optional)">
  如果启用且未设置预期键名，CrawClaw 会运行你的登录 shell 并仅导入缺失的键名：

```json5
{
  env: {
    shellEnv: { enabled: true, timeoutMs: 15000 },
  },
}
```

环境变量等效： `CRAWCLAW_LOAD_SHELL_ENV=1`
</Accordion>

<Accordion title="Env var substitution in config values">
  在任何配置字符串值中使用 `${VAR_NAME}` 引用环境变量：

```json5
{
  gateway: { auth: { token: "${CRAWCLAW_GATEWAY_TOKEN}" } },
  models: { providers: { custom: { apiKey: "${CUSTOM_API_KEY}" } } },
}
```

规则：

- 仅匹配大写名称： `[A-Z_][A-Z0-9_]*`
- 缺失/空变量在加载时会抛出错误
- 用转义 `$${VAR}` 用于字面输出
- 可在内使用 `$include` 文件
- 内联替换： `"${BASE}/v1"` → `"https://api.example.com/v1"`

</Accordion>

<Accordion title="Secret refs (env, file, exec)">
  对于支持 SecretRef 对象的字段，你可以使用：

```json5
{
  models: {
    providers: {
      openai: { apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" } },
    },
  },
  skills: {
    entries: {
      "image-lab": {
        apiKey: {
          source: "file",
          provider: "filemain",
          id: "/skills/entries/image-lab/apiKey",
        },
      },
    },
  },
  channels: {
    feishu: {
      serviceAccountRef: {
        source: "exec",
        provider: "vault",
        id: "channels/feishu/serviceAccount",
      },
    },
  },
}
```

SecretRef 详情（包括 `secrets.providers` 用于 `env`/`file`/`exec`）的详情在 [密钥管理](/gateway/secrets)受支持的凭证路径列在 [SecretRef 凭证边界](/reference/secretref-credential-surface)。
</Accordion>

参见 [环境](/help/environment) 了解完整的优先级和来源。

## 完整参考

有关完整的逐字段参考，请参见 **[配置参考](/gateway/configuration-reference)**。

---

_相关： [配置示例](/gateway/configuration-examples) · [配置参考](/gateway/configuration-reference) · [Doctor](/gateway/doctor)_
