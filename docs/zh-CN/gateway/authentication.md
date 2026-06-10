---
read_when:
  - 调试模型身份验证或 OAuth 过期
  - 记录身份验证或凭证存储
summary: 模型身份验证：OAuth、API 密钥和 setup-token
title: 身份验证
x-i18n:
  generated_at: "2026-06-05T14:16:10Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 428825d256c655cec3dee457ac5c7cf8bb7a48f2a3958612b710192925672112
  source_path: gateway/authentication.md
  workflow: 15
---

# 身份验证（模型提供商）

<Note>
本页涵盖**模型提供商**身份验证（API 密钥、OAuth、setup token）。关于**网关连接**身份验证（token、密码、trusted-proxy），请参阅[配置](/gateway/configuration)和[受信任代理身份验证](/gateway/trusted-proxy-auth)。
</Note>

CrawClaw 支持 OAuth 和 API 密钥进行模型提供商身份验证。对于常驻网关主机，API 密钥通常是最可预测的选项。当与你的提供商账户模式匹配时，也支持订阅/OAuth 流程。

有关完整的 OAuth 流程和存储布局，请参阅 [/concepts/oauth](/concepts/oauth)。关于基于 SecretRef 的认证（`env`/`file`/`exec` 提供商），请参阅[密钥管理](/gateway/secrets)。关于 model status surfaces 使用的凭证资格和 reason-code 规则，请参阅[认证凭证语义](/auth-credential-semantics)。

## 推荐设置（API 密钥，任何提供商）

如果你要运行长期存在的网关，请从为你选择的提供商设置 API 密钥开始。
对于 Anthropic，API 密钥身份验证是安全路径，比订阅 setup-token 身份验证更推荐。

1. 在提供商控制台创建 API 密钥。
2. 将其放在**网关主机**上（运行 CrawClaw Desktop 或本地 Gateway API 的机器）。

```bash
export <PROVIDER>_API_KEY="..."
```

导出变量后重启 CrawClaw Desktop 或 Gateway 进程，以便运行时可以读取它。

3. 如果 Gateway 在 systemd/launchd 下运行，优先将密钥放在 `~/.crawclaw/.env` 中，以便守护进程可以读取：

```bash
cat >> ~/.crawclaw/.env <<'EOF'
<PROVIDER>_API_KEY=...
EOF
```

然后重启守护进程（或重启 Gateway 进程）并重新检查：

使用 CrawClaw Desktop 的 model status surface、active chat 中的 `/model status`，或 Gateway
`usage.status` RPC 确认 provider 对 runtime 可见：

```bash
curl -sS http://127.0.0.1:18789/api/gateway/rpc \
  -H 'Authorization: Bearer <gateway-token-or-password>' \
  -H 'Content-Type: application/json' \
  -d '{ "method": "usage.status", "params": {} }'
```

如果你不想自己管理环境变量，onboarding 可以存储供 daemon 使用的 API keys。在 CrawClaw
Desktop 中使用**设置** → **模型与回复** → **添加模型**；Desktop 会先 probe provider，再保存，并将 key 作为 local file SecretRef 存到 desktop runtime config 下。headless hosts 可以通过 `config.patch` patch `models.providers.<provider>.apiKey`，或使用 `env` / `file` / `exec` SecretRef。

有关环境继承的详细信息（`env.shellEnv`、`~/.crawclaw/.env`、systemd/launchd），请参阅[帮助](/help)。

## Anthropic：setup-token（订阅身份验证）

如果你使用的是 Claude 订阅，则支持 setup-token 流程。在**网关主机**上运行：

```bash
claude setup-token
```

然后将其粘贴到 CrawClaw：

在 CrawClaw Desktop 的**设置** → **模型与回复**中选择 Anthropic setup-token auth path。

如果令牌是在另一台机器上创建的，请手动粘贴：

对于 headless hosts，更新目标 agent 的 `auth-profiles.json`，写入 Anthropic token profile，并通过 `crawclaw.json` 中的 `auth.profiles` / `auth.order` 路由。参见 [OAuth](/concepts/oauth) 和 [Model failover](/concepts/model-failover)。

如果你看到类似以下 Anthropic 错误：

```
This credential is only authorized for use with Claude Code and cannot be used for other API requests.
```

…请改用 Anthropic API 密钥。

<Warning>
Anthropic setup-token 支持仅为技术兼容性。Anthropic 过去曾在 Claude Code 外部阻止某些订阅使用。仅在你认为策略风险可接受时才使用，并自行验证 Anthropic 的当前条款。
</Warning>

手动令牌输入（任何提供商；写入 `auth-profiles.json` + 更新配置）：

优先使用 CrawClaw Desktop。自动化时，只通过 `config.patch` 写入 static credential metadata；credential material 应保存在 `auth-profiles.json`、环境变量或 SecretRefs 中。不要把 live tokens 放入共享 docs、scripts 或 repository config。

认证配置文件引用也支持静态凭证：

- `api_key` 凭证可以使用 `keyRef: { source, provider, id }`
- `token` 凭证可以使用 `tokenRef: { source, provider, id }`
- OAuth 模式的配置文件不支持 SecretRef 凭证；如果 `auth.profiles.<id>.mode` 设置为 `"oauth"`，则拒绝该配置文件的 SecretRef 支持的 `keyRef`/`tokenRef` 输入。

自动化友好检查（过期/缺失时退出 `1`，即将过期时退出 `2`）：

交互式状态视图使用 `/model status`。自动化场景调用 `usage.status` 并解析返回的 provider snapshots；legacy shell wrappers 仍可将 missing/expired profiles 映射为监控脚本使用的 exit codes。

可选的运维脚本（systemd/Termux）在此处记录：
[认证监控脚本](/help/scripts#auth-monitoring-scripts)

> `claude setup-token` 需要交互式 TTY。

## 检查模型身份验证状态

CrawClaw Desktop 是常规 status surface。chat 中使用 `/model status` 查看 active model、candidate providers、auth profile、endpoint 和 API mode。外部监控可调用：

```bash
curl -sS http://127.0.0.1:18789/api/gateway/rpc \
  -H 'Authorization: Bearer <gateway-token-or-password>' \
  -H 'Content-Type: application/json' \
  -d '{ "method": "models.list", "params": {} }'
```

如果只需要 configured provider usage/auth windows，而不是完整 model catalog，请使用 `usage.status`。

## API 密钥轮换行为（网关）

某些提供商支持在 API 调用遇到提供商速率限制时使用备用密钥重试请求。

- 优先级顺序：
  - `CRAWCLAW_LIVE_<PROVIDER>_KEY`（单一覆盖）
  - `<PROVIDER>_API_KEYS`
  - `<PROVIDER>_API_KEY`
  - `<PROVIDER>_API_KEY_*`
- Google 提供商还包括 `GOOGLE_API_KEY` 作为额外后备。
- 相同的密钥列表在使用前去重。
- CrawClaw 仅针对速率限制错误使用下一个密钥重试（例如
  `429`、`rate_limit`、`quota`、`resource exhausted`）。
- 非速率限制错误不会使用备用密钥重试。
- 如果所有密钥都失败，则返回最后一次尝试的最终错误。

## 控制使用的凭证

### 按会话（聊天命令）

使用 `/model <alias-or-id>@<profileId>` 为当前会话固定特定提供商凭证（例如 profile id：`anthropic:default`、`anthropic:work`）。

使用 `/model`（或 `/model list`）获取紧凑选择器；使用 `/model status` 获取完整视图（候选 + 下一个认证配置文件，以及配置时的提供商端点详情）。

### 按智能体配置覆盖

为 provider 设置显式 auth profile order：

在 `crawclaw.json` 中设置 `auth.order[provider]`，自动化时通过 `config.patch` 写入。实际 credential values 仍应保存在目标 agent 的 `auth-profiles.json` 或 SecretRefs 中。

对于 isolated agents，更新该 agent 自己的 `auth-profiles.json`，并让它的 credential store
与 default agent 分离。

## 故障排除

### "No credentials found"

如果缺少 Anthropic 令牌配置文件，请在**网关主机**上运行 `claude setup-token`，然后重新检查：

通过 CrawClaw Desktop 粘贴 setup token，或更新目标 agent 的 token profile，并用 `/model status` 或 Gateway `usage.status` RPC 确认。

### Token 过期/已过期

运行 CrawClaw Desktop 或本地 Gateway API 确认哪个配置文件即将过期。如果配置文件缺失，请重新运行 `claude setup-token` 并重新粘贴令牌。

## 要求

- Anthropic 订阅账户（用于 `claude setup-token`）
- 已安装 Claude Code CLI（`claude` 命令可用）
