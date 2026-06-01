---
read_when:
  - 调试模型认证或 OAuth 过期
  - 编写有关认证或凭证存储的文档
summary: 模型认证：OAuth、API key 和 setup-token
title: 认证
x-i18n:
  generated_at: "2026-03-16T06:22:17Z"
  model: gpt-5.4
  provider: openai
  source_hash: 219ac1acd7d192a5a12779e204cca65dae77a852fdc668271c45c01e0c69b7c9
  source_path: gateway/authentication.md
  workflow: 15
---

# 认证

CrawClaw 支持模型提供商使用 OAuth 和 API key。对于始终在线的 Gateway 网关
主机，API key 通常是最可预测的选项。当它们与你的提供商账号模型匹配时，
也支持订阅/OAuth 流程。

完整的 OAuth 流程和存储布局，请参阅 [/concepts/oauth](/concepts/oauth)。
关于基于 SecretRef 的认证（`env`/`file`/`exec` 提供商），请参阅 [Secrets Management](/gateway/secrets)。
关于 `models status --probe` 使用的凭证资格/原因码规则，请参阅
[Auth Credential Semantics](/auth-credential-semantics)。

## 推荐设置（API key，任意提供商）

如果你正在运行长期存活的 Gateway 网关，请先为你选择的
提供商配置一个 API key。
对于 Anthropic，API key 认证是更稳妥的方式，推荐优先于
订阅 setup-token 认证。

1. 在你的提供商控制台中创建一个 API key。
2. 将它放在 **Gateway 网关主机** 上（运行 CrawClaw Desktop 或本地 Gateway API 的机器）。

```bash
export <PROVIDER>_API_KEY="..."
```

导出变量后重启 CrawClaw Desktop 或 Gateway 进程，让 runtime 读取新的环境变量。

3. 如果 Gateway 通过 systemd/launchd 运行，建议将 key 放入
   `~/.crawclaw/.env`，这样守护进程就可以读取它：

```bash
cat >> ~/.crawclaw/.env <<'EOF'
<PROVIDER>_API_KEY=...
EOF
```

然后重启守护进程（或重启你的 Gateway 网关进程）并重新检查：

使用 CrawClaw Desktop 进行交互式检查，或调用本地 Gateway API 进行自动化检查。

如果你不想自己管理环境变量，设置向导可以为守护进程使用场景存储
API key：CrawClaw Desktop 或本地 Gateway API。

有关环境继承（`env.shellEnv`、
`~/.crawclaw/.env`、systemd/launchd）的详细信息，请参阅 [Help](/help)。

## Anthropic：setup-token（订阅认证）

如果你使用的是 Claude 订阅，则支持 setup-token 流程。请在
**Gateway 网关主机** 上运行：

```bash
claude setup-token
```

然后通过 CrawClaw Desktop 或本地 Gateway API 将它粘贴到 CrawClaw 中。

如果 token 是在另一台机器上创建的，也使用 Desktop 或 Gateway API 手动粘贴。

如果你看到类似这样的 Anthropic 错误：

```
This credential is only authorized for use with Claude Code and cannot be used for other API requests.
```

……请改用 Anthropic API key。

<Warning>
Anthropic setup-token 支持仅是技术兼容性。Anthropic 过去曾阻止
Claude Code 之外的某些订阅用法。只有在你认为相关策略风险可接受时才使用它，
并请你自行核实 Anthropic 当前的条款。
</Warning>

手动输入 token（任意提供商；会写入 `auth-profiles.json` + 更新配置）：使用 CrawClaw Desktop 或本地 Gateway API。

静态凭证也支持凭证配置文件引用：

- `api_key` 凭证可以使用 `keyRef: { source, provider, id }`
- `token` 凭证可以使用 `tokenRef: { source, provider, id }`

适合自动化的检查：使用 CrawClaw Desktop 或本地 Gateway API 读取 provider/auth 状态。

可选的运维脚本（systemd/Termux）记录在这里：[Auth monitoring scripts](/help/scripts#auth-monitoring-scripts)。

> `claude setup-token` 需要交互式 TTY。

## 检查模型认证状态

使用 CrawClaw Desktop 或本地 Gateway API 检查模型认证状态和 doctor 诊断。

## API key 轮换行为（Gateway 网关）

某些提供商支持在 API 调用触发提供商限流时，使用替代 key 重试请求。

- 优先级顺序：
  - `CRAWCLAW_LIVE_<PROVIDER>_KEY`（单个覆盖值）
  - `<PROVIDER>_API_KEYS`
  - `<PROVIDER>_API_KEY`
  - `<PROVIDER>_API_KEY_*`
- Google 提供商还将 `GOOGLE_API_KEY` 作为额外回退项。
- 使用前会对同一组 key 列表去重。
- 仅当出现限流错误时，CrawClaw 才会使用下一个 key 重试（例如
  `429`、`rate_limit`、`quota`、`resource exhausted`）。
- 非限流错误不会使用替代 key 重试。
- 如果所有 key 都失败，则返回最后一次尝试的最终错误。

## 控制使用哪个凭证

### 每个会话（聊天命令）

使用 `/model <alias-or-id>@<profileId>` 为当前会话固定使用特定的提供商凭证（示例配置文件 id：`anthropic:default`、`anthropic:work`）。

使用 `/model`（或 `/model list`）查看紧凑选择器；使用 `/model status` 查看完整视图（候选项 + 下一个凭证配置文件，以及在已配置时显示提供商端点详情）。

### 每个智能体

为智能体设置显式的凭证配置文件顺序覆盖（存储在该智能体的 `auth-profiles.json` 中）：

使用 CrawClaw Desktop 或本地 Gateway API。选择目标 agent 时使用对应 agent id；未指定时使用已配置的默认 agent。

## 故障排除

### “No credentials found”

如果缺少 Anthropic token 配置文件，请在
**Gateway 网关主机** 上运行 `claude setup-token`，然后重新检查：

使用 CrawClaw Desktop 或本地 Gateway API 重新检查。

### Token 即将过期/已过期

使用 CrawClaw Desktop 或本地 Gateway API 确认哪个配置文件即将过期。如果该配置文件缺失，请重新运行 `claude setup-token` 并再次粘贴 token。

## 要求

- Anthropic 订阅账号（用于 `claude setup-token`）
- 已安装 Claude Code CLI（`claude` 命令可用）
