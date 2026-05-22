---
read_when:
  - 首次设置 CrawClaw
  - 查找常见配置模式
  - 导航到特定配置部分
summary: 配置概述：常见任务、快速设置以及完整参考文档链接
title: 配置
x-i18n:
  generated_at: "2026-05-22T02:52:22Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: ffd475ea950d3d0bd872dc306404d3acca18fb0e652b122eccfd684a3dc3dbbd
  source_path: gateway/configuration.md
  workflow: 15
---

# 配置

CrawClaw 从 `~/.crawclaw/crawclaw.json` 读取可选的 <Tooltip tip="JSON5 supports comments and trailing commas">**JSON5**</Tooltip> 配置文件。

如果文件不存在，CrawClaw 将使用安全的默认值。添加配置文件的常见原因：

- 连接渠道并控制谁可以向机器人发送消息
- 调整会话、媒体、网络或 UI 设置

请参阅[完整参考文档](/gateway/configuration-reference)了解所有可用字段。

<Tip>
**初次接触配置？** 请从 CrawClaw Desktop 或本地 Gateway API 开始交互式设置，或查看[配置示例](/gateway/configuration-examples)指南获取完整的可复制配置。
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
    打开 **CrawClaw Desktop → 设置** 并使用相关部分管理渠道、模型、插件、Gateway 或运行时设置。
  </Tab>
  <Tab title="Gateway API">
    自动化应使用本地 Gateway API。优先使用类型化的 JSON 方法，而不是通过命令包装器执行 shell 命令。
  </Tab>
  <Tab title="Direct edit">
    直接编辑 `~/.crawclaw/crawclaw.json`。Gateway 会监视文件并自动应用更改（请参阅[热重载](#config-hot-reload)）。
  </Tab>
</Tabs>

## 严格验证

<Warning>
CrawClaw 仅接受完全匹配架构的配置。未知键、格式错误的类型或无效值会导致 Gateway **拒绝启动**。唯一的根级例外是 `$schema`（字符串），以便编辑器附加 JSON Schema 元数据。
</Warning>

当验证失败时：

- Gateway 不会启动
- 使用 CrawClaw Desktop 诊断工具或本地 Gateway API 来查看具体问题
- 通过 Desktop 设置或编写修正后的 JSON 配置来应用修复

## 常见任务

<AccordionGroup>
  <Accordion title="设置渠道">
    已移除捆绑的 TypeScript 渠道插件。仓库托管的渠道作为 Rust 原生适配器通过 Gateway 渠道 API 重新引入。当前的原生目录包括 `ddingtalk`、`esp32`、`feishu`、`qqbot` 和 `weixin`。

    所有渠道共享相同的私信策略模式：

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

  <Accordion title="选择并配置模型">
    设置主模型和可选的回退模型：

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

    - `agents.defaults.models` 定义模型目录并作为 `/model` 的允许列表。
    - 模型引用使用 `provider/model` 格式（例如 `anthropic/claude-opus-4-6`）。
    - `agents.defaults.imageMaxDimensionPx` 控制转录/工具图像的缩小比例（默认 `1200`）；较低的值通常会减少截图密集型运行中的视觉 token 使用量。
    - 有关在聊天中切换模型的信息，请参阅[模型](/concepts/models)；有关认证轮换和回退行为，请参阅[模型故障转移](/concepts/model-failover)。
    - 有关自定义/自托管提供商的信息，请参阅参考文档中的[自定义提供商](/gateway/configuration-reference#custom-providers-and-base-urls)。

  </Accordion>

  <Accordion title="控制谁可以向机器人发送消息">
    私信访问通过 `dmPolicy` 按渠道控制：

    - `"pairing"`（默认）：未知发送者会收到一次性配对码以进行批准
    - `"allowlist"`：仅允许 `allowFrom` 中的发送者（或配对的允许存储）
    - `"open"`：允许所有入站私信（需要 `allowFrom: ["*"]`）
    - `"disabled"`：忽略所有私信

    对于群组，请使用 `groupPolicy` + `groupAllowFrom` 或渠道特定的允许列表。

    请参阅[完整参考文档](/gateway/configuration-reference#dm-and-group-access)了解每个渠道的详细信息。

  </Accordion>

  <Accordion title="设置群聊提及限制">
    群组消息默认**需要提及**。为每个智能体配置模式：

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

    - **元数据提及**：原生 @-提及（Weixin 点击提及、飞书 @机器人等）
    - **文本模式**：`mentionPatterns` 中的安全正则表达式模式
    - 请参阅[完整参考文档](/gateway/configuration-reference#group-chat-mention-gating)了解每个渠道的覆盖设置和自聊天模式。

  </Accordion>

  <Accordion title="调整网关渠道健康监控">
    控制 Gateway 重启看起来过时的渠道的激进程度：

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

    - 设置 `gateway.channelHealthCheckMinutes: 0` 可全局禁用健康监控重启。
    - `channelStaleEventThresholdMinutes` 应该大于或等于检查间隔。
    - 使用 `channels.<provider>.healthMonitor.enabled` 或 `channels.<provider>.accounts.<id>.healthMonitor.enabled` 可仅针对一个渠道或账户禁用自动重启，而不禁用全局监控器。
    - 有关操作调试，请参阅[健康检查](/gateway/health)；有关所有字段，请参阅[完整参考文档](/gateway/configuration-reference#gateway)。

  </Accordion>

  <Accordion title="配置会话和重置">
    会话控制对话的连续性和隔离性：

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

    - `dmScope`：`main`（共享）| `per-peer` | `per-channel-peer` | `per-account-channel-peer`
    - `threadBindings`：线程绑定会话路由的全局默认值（QQBot 支持 `/focus`、`/unfocus`、`/agents`、`/session idle` 和 `/session max-age`）。
    - 有关范围、身份链接和发送策略，请参阅[会话管理](/concepts/session)。
    - 有关所有字段，请参阅[完整参考文档](/gateway/configuration-reference#session)。

  </Accordion>

  <Accordion title="启用沙箱隔离">
    在隔离的 Docker 容器中运行智能体会话：

    ```json5
    {
      agents: {
        defaults: {
          sandbox: {
            mode: "non-main",  // off | non-main | all
            scope: "agent",    // session | agent | shared
          },
        },
      },
    }
    ```

    首先构建镜像：`scripts/sandbox-setup.sh`

    有关完整指南，请参阅[安全](/gateway/security)；有关所有选项，请参阅[完整参考文档](/gateway/configuration-reference#sandbox)。

  </Accordion>

  <Accordion title="使用 cron 替换传统心跳">
    ```json5
    {
      cron: {
        enabled: true,
      },
    }
    ```

    传统定期智能体心跳不再默认配置。使用
    [定时任务](/automation/cron-jobs)进行新的定期检查和
    [心跳](/gateway/heartbeat)了解兼容性说明。

  </Accordion>

  <Accordion title="配置定时任务">
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

    - `sessionRetention`：从 `sessions.json` 中清除已完成的隔离运行会话（默认 `24h`；设置为 `false` 可禁用）。
    - `runLog`：按大小和保留行数清除 `cron/runs/<jobId>.jsonl`。
    - 有关功能概述和 Gateway API 示例，请参阅[定时任务](/automation/cron-jobs)。

  </Accordion>

  <Accordion title="设置 Webhook（钩子）">
    在 Gateway 上启用 HTTP Webhook 端点：

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

    安全注意事项：
    - 将所有钩子/Webhook 负载内容视为不受信任的输入。
    - 除非进行严格范围的调试，否则保持禁用不安全内容绕过标志（`hooks.gmail.allowUnsafeExternalContent`、`hooks.mappings[].allowUnsafeExternalContent`）。

    有关所有映射选项和 Gmail 集成，请参阅[完整参考文档](/gateway/configuration-reference#hooks)。

  </Accordion>

  <Accordion title="配置多智能体路由">
    运行多个具有独立工作区和会话的隔离智能体：

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

    有关绑定规则和每个智能体的访问配置文件，请参阅[多智能体](/concepts/multi-agent)和[完整参考文档](/gateway/configuration-reference#multi-agent-routing)。

  </Accordion>

  <Accordion title="将配置拆分为多个文件（$include）">
    使用 `$include` 组织大型配置：

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

    - **单文件**：替换包含的对象
    - **文件数组**：按顺序深度合并（后者优先）
    - **同级键**：在包含后合并（覆盖包含的值）
    - **嵌套包含**：支持最多 10 层深度
    - **相对路径**：相对于包含文件进行解析
    - **错误处理**：对缺失文件、解析错误和循环包含提供清晰的错误信息

  </Accordion>
</AccordionGroup>

## 配置 RPC（程序化更新）

<Note>
控制平面写入 RPC（`config.apply`、`config.patch`、`update.run`）按 `deviceId+clientIp` 限制为**每 60 秒 3 个请求**。当受到限制时，RPC 返回 `UNAVAILABLE` 并附带 `retryAfterMs`。
</Note>

<AccordionGroup>
  <Accordion title="config.apply（完整替换）">
    验证并写入完整配置。某些设置会被动态读取以供将来操作使用；启动绑定的 Gateway 设置在重启 CrawClaw Desktop 后生效。

    <Warning>
    `config.apply` 替换**整个配置**。要进行部分更新，请使用 `config.patch`，或使用 CrawClaw Desktop 或本地 Gateway API 处理单个键。
    </Warning>

    参数：

    - `raw`（字符串）— 整个配置的 JSON5 负载
    - `baseHash`（可选）— 来自 `config.get` 的配置哈希（当配置存在时必需）
    - `sessionKey`（可选）— 用于后续唤醒 ping 的会话密钥
    - `note`（可选）— 与写请求一起存储的操作员备注

    ```json5
    {
      "raw": "{ agents: { defaults: { workspace: \"~/.crawclaw/workspace\" } } }",
      "baseHash": "<hash>",
      "sessionKey": "agent:main:weixin:direct:+15555550123",
    }
    ```

  </Accordion>

  <Accordion title="config.patch（部分更新）">
    将部分更新合并到现有配置中（JSON 合并补丁语义）：

    - 对象递归合并
    - `null` 删除一个键
    - 数组替换

    参数：

    - `raw`（字符串）— 仅包含要更改的键的 JSON5
    - `baseHash`（必需）— 来自 `config.get` 的配置哈希
    - `sessionKey`、`note` — 与 `config.apply` 相同

    运行时行为与 `config.apply` 相同。

    ```json5
    {
      "raw": "{ channels: { feishu: { groups: { \"*\": { requireMention: false } } } } }",
      "baseHash": "<hash>",
    }
    ```

  </Accordion>
</AccordionGroup>

## 环境变量

CrawClaw 从父进程读取环境变量，外加：

- 当前工作目录中的 `.env`（如果存在）
- `~/.crawclaw/.env`（全局回退）

两个文件都不会覆盖现有的环境变量。也可以在配置中设置内联环境变量：

```json5
{
  env: {
    OPENROUTER_API_KEY: "sk-or-...",
    vars: { GROQ_API_KEY: "gsk-..." },
  },
}
```

<Accordion title="Shell 环境导入（可选）">
  如果启用且未设置预期键，CrawClaw 会运行登录 shell 并仅导入缺失的键：

```json5
{
  env: {
    shellEnv: { enabled: true, timeoutMs: 15000 },
  },
}
```

环境变量等效项：`CRAWCLAW_LOAD_SHELL_ENV=1`
</Accordion>

<Accordion title="配置值中的环境变量替换">
  在任何配置字符串值中引用环境变量：

```json5
{
  gateway: { auth: { token: "${CRAWCLAW_GATEWAY_TOKEN}" } },
  models: { providers: { custom: { apiKey: "${CUSTOM_API_KEY}" } } },
}
```

规则：

- 仅匹配大写名称：`[A-Z_][A-Z0-9_]*`
- 缺失/空变量在加载时抛出错误
- 使用 `$${VAR}` 转义以输出字面量
- 在 `$include` 文件内有效
- 内联替换：`"${BASE}/v1"` → `"https://api.example.com/v1"`

</Accordion>

<Accordion title="密钥引用（env、file、exec）">
  对于支持 SecretRef 对象的字段，可以使用：

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

有关 SecretRef 的详细信息（包括用于 `env`/`file`/`exec` 的 `secrets.providers`），请参阅[密钥管理](/gateway/secrets)。
支持的凭证路径列在[密钥引用凭证表面](/reference/secretref-credential-surface)中。
</Accordion>

请参阅[环境](/help/environment)了解完整的优先级和来源。

## 完整参考

有关完整的逐字段参考，请参阅**[配置参考文档](/gateway/configuration-reference)**。

---

_相关文档：[配置示例](/gateway/configuration-examples) · [配置参考文档](/gateway/configuration-reference) · [Doctor](/gateway/doctor)_
