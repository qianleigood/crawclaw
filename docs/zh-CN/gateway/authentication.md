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
  source_hash: 59b1296de2b9b173b0c0f5b6f4caeb9369f016d622ab7bd85afe09a8ae3a6784
  source_path: gateway/authentication.md
  workflow: 15
---

# 身份验证（模型提供商）

<Note>
本页涵盖**模型提供商**身份验证（API 密钥、OAuth、setup token）。关于**网关连接**身份验证（token、密码、trusted-proxy），请参阅[配置](/gateway/configuration)和[受信任代理身份验证](/gateway/trusted-proxy-auth)。
</Note>

CrawClaw 支持 OAuth 和 API 密钥进行模型提供商身份验证。对于常驻网关主机，API 密钥通常是最可预测的选项。当与你的提供商账户模式匹配时，也支持订阅/OAuth 流程。

有关完整的 OAuth 流程和存储布局，请参阅 [/concepts/oauth](/concepts/oauth)。关于基于 SecretRef 的认证（`env`/`file`/`exec` 提供商），请参阅[密钥管理](/gateway/secrets)。关于 `models status --probe` 使用的凭证资格/原因代码规则，请参阅[认证凭证语义](/auth-credential-semantics)。

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

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

如果你不想自己管理环境变量，onboarding 可以存储供守护进程使用的 API 密钥：CrawClaw Desktop 或本地 Gateway API。

有关环境继承的详细信息（`env.shellEnv`、`~/.crawclaw/.env`、systemd/launchd），请参阅[帮助](/help)。

## Anthropic：setup-token（订阅身份验证）

如果你使用的是 Claude 订阅，则支持 setup-token 流程。在**网关主机**上运行：

```bash
claude setup-token
```

然后将其粘贴到 CrawClaw：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

如果令牌是在另一台机器上创建的，请手动粘贴：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

如果你看到类似以下 Anthropic 错误：

```
This credential is only authorized for use with Claude Code and cannot be used for other API requests.
```

…请改用 Anthropic API 密钥。

<Warning>
Anthropic setup-token 支持仅为技术兼容性。Anthropic 过去曾在 Claude Code 外部阻止某些订阅使用。仅在你认为策略风险可接受时才使用，并自行验证 Anthropic 的当前条款。
</Warning>

手动令牌输入（任何提供商；写入 `auth-profiles.json` + 更新配置）：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

认证配置文件引用也支持静态凭证：

- `api_key` 凭证可以使用 `keyRef: { source, provider, id }`
- `token` 凭证可以使用 `tokenRef: { source, provider, id }`
- OAuth 模式的配置文件不支持 SecretRef 凭证；如果 `auth.profiles.<id>.mode` 设置为 `"oauth"`，则拒绝该配置文件的 SecretRef 支持的 `keyRef`/`tokenRef` 输入。

自动化友好检查（过期/缺失时退出 `1`，即将过期时退出 `2`）：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

可选的运维脚本（systemd/Termux）在此处记录：
[认证监控脚本](/help/scripts#auth-monitoring-scripts)

> `claude setup-token` 需要交互式 TTY。

## 检查模型身份验证状态

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

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

### 按智能体（CLI 覆盖）

为智能体设置显式认证配置文件顺序覆盖（存储在该智能体的 `auth-profiles.json` 中）：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

使用 `--agent <id>` 定位特定智能体；省略它以使用配置的默认智能体。

## 故障排除

### "No credentials found"

如果缺少 Anthropic 令牌配置文件，请在**网关主机**上运行 `claude setup-token`，然后重新检查：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

### Token 过期/已过期

运行 CrawClaw Desktop 或本地 Gateway API 确认哪个配置文件即将过期。如果配置文件缺失，请重新运行 `claude setup-token` 并重新粘贴令牌。

## 要求

- Anthropic 订阅账户（用于 `claude setup-token`）
- 已安装 Claude Code CLI（`claude` 命令可用）
