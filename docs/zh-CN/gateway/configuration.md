---
read_when:
  - 首次设置 CrawClaw
  - 查找常见配置模式
  - 导航到特定配置部分
summary: 配置概览：常见任务、快速设置和完整参考链接
title: 配置
x-i18n:
  generated_at: "2026-06-05T14:17:07Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 7c4a8ea525dcba479ea58f85f3115f8992b5acbd99a89915f0538ebdab7788f5
  source_path: gateway/configuration.md
  workflow: 15
---

# 配置

CrawClaw 从 `~/.crawclaw/crawclaw.json` 读取可选的 <Tooltip tip="JSON5 支持注释和尾随逗号">**JSON5**</Tooltip> 配置。

如果文件缺失，CrawClaw 使用安全默认值。添加配置的常见原因：

- 连接渠道并控制谁可以向机器人发送消息
- 调整会话、媒体、网络或 UI

有关每个可用字段，请参阅[完整参考](/gateway/configuration-reference)。

<Tip>
**不熟悉配置？** 从 CrawClaw Desktop 或本地 Gateway API 交互式设置开始，或查看[配置示例](/gateway/configuration-examples)指南获取完整的复制粘贴配置。
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
    打开 **CrawClaw Desktop → 设置**，使用相关部分配置渠道、模型、插件、Gateway 或运行时设置。
  </Tab>
  <Tab title="Gateway API">
    自动化应使用本地 Gateway API。优先使用类型化 JSON 方法，而不是调用命令包装器。
  </Tab>
  <Tab title="直接编辑">
    直接编辑 `~/.crawclaw/crawclaw.json`。Gateway 会监视文件并自动应用更改。
  </Tab>
</Tabs>

## 严格验证

<Warning>
CrawClaw 仅接受完全匹配 schema 的配置。未知键、格式错误的类型或无效值会导致 Gateway **拒绝启动**。唯一的根级例外是 `$schema`（字符串），因此编辑器可以附加 JSON Schema 元数据。
</Warning>

验证失败时：

- Gateway 不会启动
- 使用 CrawClaw Desktop 诊断或本地 Gateway API 查看具体问题
- 从 Desktop 设置应用修复或通过编写更正后的 JSON 配置

## 常见任务

<AccordionGroup>
  <Accordion title="设置渠道">
    捆绑的 TypeScript 渠道插件已被移除。仓库拥有的渠道通过 Gateway 渠道 API 作为 Rust 原生适配器重新引入。当前的原生目录是 `ddingtalk`、`esp32`、`feishu`、`qqbot` 和 `weixin`。

    所有渠道共享相同的私信策略模式：

    ```json5
    {
      channels: {
        feishu: {
          enabled: true,
          dmPolicy: "pairing",   // pairing | allowlist | open | disabled
          allowFrom: ["user:ou_xxx"], // 仅适用于 allowlist/open
        },
      },
    }
    ```

  </Accordion>

  <Accordion title="选择和配置模型">
    设置主模型和可选后备：

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

    - `agents.defaults.models` 定义模型目录并作为 `/model` 的白名单。
    - 模型引用使用 `provider/model` 格式（例如 `anthropic/claude-opus-4-6`）。
    - `agents.defaults.imageMaxDimensionPx` 控制记录/工具图片缩放（默认 `1200`）；较低的值通常会减少截图密集型运行的视觉 token 使用量。
    - 有关在聊天中切换模型，请参阅[模型](/concepts/models)；有关认证轮换和后备行为，请参阅[模型故障转移](/concepts/model-failover)。
    - 有关自定义/自托管提供商，请参阅参考中的[自定义提供商](/gateway/configuration-reference#custom-providers-and-base-urls)。

  </Accordion>

  <Accordion title="控制谁可以向机器人发送消息">
    私信访问通过 `dmPolicy` 按渠道控制：

    - `"pairing"`（默认）：未知发送者收到一次性配对码以批准
    - `"allowlist"`：仅允许 `allowFrom`（或配对白名单存储）中的发送者
    - `"open"`：允许所有入站私信（需要 `allowFrom: ["*"]`）
    - `"disabled"`：忽略所有私信

    对于群组，使用 `groupPolicy` + `groupAllowFrom` 或渠道特定白名单。

    有关每个渠道的详细信息，请参阅[完整参考](/gateway/configuration-reference#dm-and-group-access)。

  </Accordion>

  <Accordion title="设置群聊提及门控">
    群组消息默认**需要提及**。按智能体配置模式：

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

    - **元数据提及**：原生 @-提及（微信点击提及、飞书 @机器人等）
    - **文本模式**：`mentionPatterns` 中的安全正则表达式模式
    - 有关渠道覆盖和自聊模式，请参阅[完整参考](/gateway/configuration-reference#group-chat-mention-gating)。

  </Accordion>

  <Accordion title="调整网关渠道健康监控">
    控制网关重启看起来陈旧的渠道的激进程度：

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

    - 设置 `gateway.channelHealthCheckMinutes: 0` 全局禁用健康监控重启。
    - `channelStaleEventThresholdMinutes` 应该大于或等于检查间隔。
    - 使用 `channels.<provider>.healthMonitor.enabled` 或 `channels.<provider>.accounts.<id>.healthMonitor.enabled` 为单个渠道或账户禁用自动重启，而不禁用全局监控。
    - 有关操作调试，请参阅[健康检查](/gateway/health)；有关所有字段，请参阅[完整参考](/gateway/configuration-reference#gateway)。

  </Accordion>

  <Accordion title="配置会话和重置">
    会话控制对话连续性和隔离：

    ```json5
    {
      session: {
        dmScope: "per-channel-peer",  // 多用户推荐
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
    - 有关所有字段，请参阅[完整参考](/gateway/configuration-reference#session)。

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

    有关完整指南，请参阅[安全](/gateway/security)。

  </Accordion>

  <Accordion title="用 cron 替换传统 heartbeat">
    ```json5
    {
      cron: {
        enabled: true,
      },
    }
    ```

    传统周期性智能体 heartbeat 不再默认配置。新的定期检查请使用[定时任务](/automation/cron-jobs)，兼容性说明请参阅[Heartbeat](/gateway/heartbeat)。

  </Accordion>

  <Accordion title="配置 cron 任务">
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

    - `sessionRetention`：从 `sessions.json` 修剪已完成的隔离运行会话（默认 `24h`；设置为 `false` 禁用）。
    - `runLog`：按大小和保留行数修剪 `cron/runs/<jobId>.jsonl`。
    - 有关功能概览和 Gateway API 示例，请参阅[Cron 任务](/automation/cron-jobs)。

  </Accordion>

  <Accordion title="设置 webhook（钩子）">
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

    安全注意事项：
    - 将所有 hook/webhook 负载内容视为不可信输入。
    - 保持禁用不安全内容绕过标志（`hooks.gmail.allowUnsafeExternalContent`、`hooks.mappings[].allowUnsafeExternalContent`），除非进行严格限定的调试。

    有关所有映射选项和 Gmail 集成，请参阅[完整参考](/gateway/configuration-reference#hooks)。

  </Accordion>

  <Accordion title="配置多智能体路由">
    运行具有独立工作空间和会话的多个隔离智能体：

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

    有关绑定规则和每个智能体的访问配置，请参阅[多智能体](/concepts/multi-agent)和[完整参考](/gateway/configuration-reference#multi-agent-routing)。

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

    - **单个文件**：替换包含的对象
    - **文件数组**：按顺序深度合并（后者优先）
    - **同级键**：在包含之后合并（覆盖包含的值）
    - **嵌套包含**：最多支持 10 层深度
    - **相对路径**：相对于包含文件解析
    - **错误处理**：对缺失文件、解析错误和循环包含的清晰错误

  </Accordion>
</AccordionGroup>

## Config RPC（编程式更新）

<Note>
控制平面写 RPC（`config.apply`、`config.patch`、`update.run`）每个 `deviceId+clientIp` 限速为 **60 秒内 3 次请求**。达到限制时，RPC 返回 `UNAVAILABLE` 并带有 `retryAfterMs`。
</Note>

<AccordionGroup>
  <Accordion title="config.apply（完整替换）">
    验证并写入完整配置。某些设置会被动态读取以供未来操作使用；启动绑定的 Gateway 设置在重启 CrawClaw Desktop 后生效。

    <Warning>
    `config.apply` 替换**整个配置**。部分更新请使用 `config.patch`，或使用 CrawClaw Desktop 或本地 Gateway API 处理单个键。
    </Warning>

    参数：

    - `raw`（字符串）— 整个配置的 JSON5 负载
    - `baseHash`（可选）— 来自 `config.get` 的配置哈希（配置存在时必需）
    - `sessionKey`（可选）— 后续唤醒 ping 的会话键
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
    将部分更新合并到现有配置中（JSON 合并修补语义）：

    - 对象递归合并
    - `null` 删除键
    - 数组替换

    参数：

    - `raw`（字符串）— 仅包含要更改的键的 JSON5
    - `baseHash`（必需）— 来自 `config.get` 的配置哈希
    - `sessionKey`、`note` — 与 `config.apply` 相同

    运行时行为与 `config.apply` 匹配。

    ```json5
    {
      "raw": "{ channels: { feishu: { groups: { \"*\": { requireMention: false } } } } }",
      "baseHash": "<hash>",
    }
    ```

  </Accordion>
</AccordionGroup>

## 环境变量

CrawClaw 从父进程以及以下位置读取环境变量：

- 当前工作目录中的 `.env`（如果存在）
- `~/.crawclaw/.env`（全局后备）

这两个文件都不会覆盖现有的环境变量。你也可以在配置中设置内联环境变量：

```json5
{
  env: {
    OPENROUTER_API_KEY: "sk-or-...",
    vars: { GROQ_API_KEY: "gsk-..." },
  },
}
```

<Accordion title="Shell 环境导入（可选）">
  如果启用且未设置预期键，CrawClaw 会运行你的登录 shell 并仅导入缺失的键：

```json5
{
  env: {
    shellEnv: { enabled: true, timeoutMs: 15000 },
  },
}
```

环境变量等效：`CRAWCLAW_LOAD_SHELL_ENV=1`
</Accordion>

<Accordion title="配置值中的环境变量替换">
  使用 `${VAR_NAME}` 在任何配置字符串值中引用环境变量：

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
- 适用于 `$include` 文件内
- 内联替换：`"${BASE}/v1"` → `"https://api.example.com/v1"`

</Accordion>

<Accordion title="密钥引用（env、file、exec）">
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

SecretRef 详情（包括 `env`/`file`/`exec` 的 `secrets.providers`）请参阅[密钥管理](/gateway/secrets)。
支持的凭证路径列在[SecretRef 凭证表面](/reference/secretref-credential-surface)中。
</Accordion>

有关完整的优先级和来源，请参阅[环境](/help/environment)。

## 完整参考

有关逐字段的完整参考，请参阅**[配置参考](/gateway/configuration-reference)**。

---

_相关：[配置示例](/gateway/configuration-examples) · [配置参考](/gateway/configuration-reference) · [Doctor](/gateway/doctor)_
