---
summary: "Gateway runtime、生命周期和运维 runbook"
read_when:
  - Running or debugging the gateway process
title: "Gateway Runbook"
---

# Gateway runbook

本页用于本地 Rust Gateway runtime 的 day-1 启动和 day-2 运维。

<CardGroup cols={2}>
  <Card title="Deep troubleshooting" icon="siren" href="/gateway/troubleshooting">
    按症状组织的诊断步骤，包含具体命令梯度和日志特征。
  </Card>
  <Card title="Configuration" icon="sliders" href="/gateway/configuration">
    面向任务的设置指南和完整配置参考。
  </Card>
  <Card title="Secrets management" icon="key-round" href="/gateway/secrets">
    SecretRef contract、runtime snapshot 行为，以及 migrate/reload 操作。
  </Card>
  <Card title="Secrets plan contract" icon="shield-check" href="/gateway/secrets-plan-contract">
    精确的 `secrets apply` target/path 规则和 ref-only auth-profile 行为。
  </Card>
</CardGroup>

## 5-minute local startup

<Steps>
  <Step title="Start the Gateway">

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

  </Step>

  <Step title="Verify service health">

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

健康基线：`Runtime: running` 和 `RPC probe: ok`。

  </Step>

  <Step title="Validate channel readiness">

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

  </Step>
</Steps>

<Note>
CrawClaw Desktop 和 local Gateway API 负责受支持的 config writes。部分设置会在后续操作中动态读取；启动绑定的设置需要从应用内重启 desktop Gateway 后生效。
</Note>

## Runtime model

- 一个 always-on process 负责 routing、control plane 和 channel connections。
- 单端口复用：
  - WebSocket control/RPC
  - HTTP APIs，OpenAI compatible（`/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/tools/invoke`）
  - browser-origin checked clients and hooks
- 默认 bind mode: `loopback`。
- 默认要求 auth（`gateway.auth.token` / `gateway.auth.password`，或 `CRAWCLAW_GATEWAY_TOKEN` / `CRAWCLAW_GATEWAY_PASSWORD`）。

## OpenAI-compatible endpoints

CrawClaw 现在最高杠杆的 compatibility surface 是：

- `GET /v1/models`
- `GET /v1/models/{id}`
- `POST /v1/chat/completions`
- `POST /v1/responses`

这组端点重要的原因：

- 大多数 Open WebUI、LobeChat 和 LibreChat integration 会先探测 `/v1/models`。
- Agent-native clients 越来越偏好 `/v1/responses`。

Planning note:

- `/v1/models` 是 agent-first：返回 `crawclaw`, `crawclaw/default` 和 `crawclaw/<agentId>`。
- `crawclaw/default` 是 Rust-native `main` agent target 的稳定 alias。
- 后端 provider/model selection 属于所选 agent/provider configuration。

这些端点都运行在主 Gateway port 上，并使用与其余 Gateway HTTP API 相同的 trusted operator auth boundary。

### Port and bind precedence

| Setting      | Resolution order                                              |
| ------------ | ------------------------------------------------------------- |
| Gateway port | `--port` → `CRAWCLAW_GATEWAY_PORT` → `gateway.port` → `18789` |
| Bind mode    | CLI/override → `gateway.bind` → `loopback`                    |

## Operator command set

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

## Remote access

首选：Tailscale/VPN。
Fallback：SSH tunnel。

```bash
ssh -N -L 18789:127.0.0.1:18789 user@host
```

然后让客户端在本地连接 `ws://127.0.0.1:18789`。

<Warning>
如果配置了 gateway auth，客户端即使通过 SSH tunnel 也必须发送 auth（`token`/`password`）。
</Warning>

参见：[Remote Gateway](/gateway/remote)、[Authentication](/gateway/authentication)、[Tailscale](/gateway/tailscale)。

## Desktop lifecycle

CrawClaw Desktop 拥有默认本地 runtime lifecycle。应用会启动或发现 bundled Rust
Gateway，把 per-launch local session token 传给 renderer，并在 desktop app 退出时停止本地
runtime。集成场景应连接 local Gateway API，不要额外安装 OS supervisor entry。

## Multiple gateways on one host

大多数设置应该只运行 **一个** Gateway。
只有严格隔离/冗余时才使用多个实例（例如 rescue profile）。

每个实例的 checklist：

- 唯一的 `gateway.port`
- 唯一的 `CRAWCLAW_CONFIG_PATH`
- 唯一的 `CRAWCLAW_STATE_DIR`
- 唯一的 `agents.defaults.workspace`

示例：

```bash
CRAWCLAW_CONFIG_PATH=~/.crawclaw/a.json CRAWCLAW_STATE_DIR=~/.crawclaw-a <start via CrawClaw Desktop>
CRAWCLAW_CONFIG_PATH=~/.crawclaw/b.json CRAWCLAW_STATE_DIR=~/.crawclaw-b <start via CrawClaw Desktop>
```

参见：[Multiple gateways](/gateway/multiple-gateways)。

### Dev profile quick path

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

默认包含隔离的 state/config 和 base gateway port `19001`。

## Protocol quick reference (operator view)

- 第一个 client frame 必须是 `connect`。
- Gateway 返回 `hello-ok` snapshot（`presence`, `health`, `stateVersion`, `uptimeMs`, limits/policy）。
- Requests: `req(method, params)` → `res(ok/payload|error)`。
- Common events: `agent`, `chat`, `presence`, `tick`, `health`, `heartbeat`, `shutdown`。

Agent runs 分两阶段：

1. Immediate accepted ack（`status:"accepted"`）
2. Final completion response（`status:"ok"|"error"`），中间有 streamed `agent` events。

完整协议文档见：[Gateway Protocol](/gateway/protocol)。

## Operational checks

### Liveness

- 打开 WS 并发送 `connect`。
- 预期收到带 snapshot 的 `hello-ok` response。

### Readiness

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

### Gap recovery

Events 不会 replay。遇到 sequence gaps 时，先刷新 state（`health`, `system-presence`）再继续。

## Common failure signatures

| Signature                                                      | Likely issue                             |
| -------------------------------------------------------------- | ---------------------------------------- |
| `refusing to bind gateway ... without auth`                    | Non-loopback bind without token/password |
| `another gateway instance is already listening` / `EADDRINUSE` | Port conflict                            |
| `Gateway start blocked: set gateway.mode=local`                | Config set to remote mode                |
| `unauthorized` during connect                                  | Auth mismatch between client and gateway |

完整诊断 ladder 见 [Gateway Troubleshooting](/gateway/troubleshooting)。

## Safety guarantees

- Gateway protocol clients 在 Gateway 不可用时 fail fast（没有隐式 direct-channel fallback）。
- Invalid/non-connect first frames 会被拒绝并关闭。
- Graceful shutdown 会在 socket close 前发出 `shutdown` event。

---

Related:

- [Troubleshooting](/gateway/troubleshooting)
- [Background Process](/gateway/background-process)
- [Configuration](/gateway/configuration)
- [Health](/gateway/health)
- [Doctor](/gateway/doctor)
- [Authentication](/gateway/authentication)
