---
title: "Trusted Proxy Auth"
summary: "将 gateway authentication 委托给 trusted reverse proxy（Pomerium、Caddy、nginx + OAuth）"
read_when:
  - 在 identity-aware proxy 后运行 CrawClaw
  - 在 CrawClaw 前设置 Pomerium、Caddy 或 nginx with OAuth
  - 修复 reverse proxy setups 中的 WebSocket 1008 unauthorized errors
  - 决定在哪里设置 HSTS 和其他 HTTP hardening headers
x-i18n:
  generated_at: "2026-06-10T12:15:35Z"
  model: codex
  provider: openai
  source_hash: 82e75886927f2795e9057b2e7b6b58b7e89c34ed821e420666643f91c5ce9e97
  source_path: gateway/trusted-proxy-auth.md
  workflow: 15
---

# Trusted Proxy Auth

> **Security-sensitive feature.** 这个 mode 会把 authentication 完全委托给你的 reverse proxy。配置错误可能让 Gateway 暴露给未授权访问。启用前请仔细阅读本页。

## When to Use

在以下情况使用 `trusted-proxy` auth mode：

- 你在 **identity-aware proxy** 后运行 CrawClaw（Pomerium、Caddy + OAuth、nginx + oauth2-proxy、Traefik + forward auth）
- 你的 proxy 处理所有 authentication，并通过 headers 传递 user identity
- 你在 Kubernetes 或 container environment 中，proxy 是通往 Gateway 的唯一路径
- 你遇到 WebSocket `1008 unauthorized` errors，因为 browsers 无法在 WS payloads 中传 tokens

## When NOT to Use

- 如果你的 proxy 不认证 users（只是 TLS terminator 或 load balancer）
- 如果存在绕过 proxy 到 Gateway 的任何路径（firewall holes、internal network access）
- 如果你不确定 proxy 是否正确 strip/overwrite forwarded headers
- 如果你只需要个人 single-user access（更简单的 setup 可考虑 Tailscale Serve + loopback）

## How It Works

1. Reverse proxy 认证 users（OAuth、OIDC、SAML 等）
2. Proxy 添加包含 authenticated user identity 的 header，例如 `x-forwarded-user: nick@example.com`
3. CrawClaw 检查 request 是否来自 **trusted proxy IP**（在 `gateway.trustedProxies` 中配置）
4. CrawClaw 从配置的 header 中提取 user identity
5. 所有检查通过后，request 被 authorized

## Browser client pairing behavior

当 `gateway.auth.mode = "trusted-proxy"` 激活且 request 通过 trusted-proxy checks 时，browser-client WebSocket sessions 可以在没有 device pairing identity 的情况下连接。

Implications：

- 在此 mode 中，pairing 不再是 browser-client access 的主要 gate。
- Reverse proxy auth policy 和 `allowUsers` 会成为有效 access control。
- 保持 gateway ingress 只锁定到 trusted proxy IPs（`gateway.trustedProxies` + firewall）。

## Configuration

```json5
{
  gateway: {
    // Use loopback for same-host proxy setups; use lan/custom for remote proxy hosts
    bind: "loopback",

    // CRITICAL: Only add your proxy's IP(s) here
    trustedProxies: ["10.0.0.1", "172.17.0.1"],

    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        // Header containing authenticated user identity (required)
        userHeader: "x-forwarded-user",

        // Optional: headers that MUST be present (proxy verification)
        requiredHeaders: ["x-forwarded-proto", "x-forwarded-host"],

        // Optional: restrict to specific users (empty = allow all)
        allowUsers: ["nick@example.com", "admin@company.org"],
      },
    },
  },
}
```

如果 `gateway.bind` 是 `loopback`，请在 `gateway.trustedProxies` 中包含 loopback proxy address（`127.0.0.1`、`::1` 或等效 loopback CIDR）。

### Configuration Reference

| Field                                       | Required | Description                                                              |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `gateway.trustedProxies`                    | Yes      | 要 trust 的 proxy IP addresses array。来自其他 IP 的 requests 会被拒绝。 |
| `gateway.auth.mode`                         | Yes      | 必须是 `"trusted-proxy"`                                                 |
| `gateway.auth.trustedProxy.userHeader`      | Yes      | 包含 authenticated user identity 的 header name                          |
| `gateway.auth.trustedProxy.requiredHeaders` | No       | request 被 trust 前必须存在的 additional headers                         |
| `gateway.auth.trustedProxy.allowUsers`      | No       | User identities allowlist。空值表示允许所有 authenticated users。        |

## TLS termination and HSTS

使用一个 TLS termination point，并在那里应用 HSTS。

### Recommended pattern: proxy TLS termination

当你的 reverse proxy 为 `https://control.example.com` 处理 HTTPS 时，在该 domain 的 proxy 上设置 `Strict-Transport-Security`。

- 适合 internet-facing deployments。
- 将 certificate + HTTP hardening policy 保持在一个地方。
- CrawClaw 可以在 proxy 后保持 loopback HTTP。

Example header value：

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Gateway TLS termination

如果 CrawClaw 自己直接提供 HTTPS（没有 TLS-terminating proxy），设置：

```json5
{
  gateway: {
    tls: { enabled: true },
    http: {
      securityHeaders: {
        strictTransportSecurity: "max-age=31536000; includeSubDomains",
      },
    },
  },
}
```

`strictTransportSecurity` 接受 string header value，或用 `false` 显式禁用。

### Rollout guidance

- 验证 traffic 时先使用较短 max age（例如 `max-age=300`）。
- 只有在信心足够高后，才增加到 long-lived values（例如 `max-age=31536000`）。
- 只有当每个 subdomain 都 HTTPS-ready 时才添加 `includeSubDomains`。
- 只有当你有意满足整个 domain set 的 preload requirements 时才使用 preload。
- Loopback-only local development 不会从 HSTS 中获益。

## Proxy Setup Examples

### Pomerium

Pomerium 会在 `x-pomerium-claim-email`（或其他 claim headers）中传递 identity，并在 `x-pomerium-jwt-assertion` 中传 JWT。

```json5
{
  gateway: {
    bind: "lan",
    trustedProxies: ["10.0.0.1"], // Pomerium's IP
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-pomerium-claim-email",
        requiredHeaders: ["x-pomerium-jwt-assertion"],
      },
    },
  },
}
```

Pomerium config snippet：

```yaml
routes:
  - from: https://crawclaw.example.com
    to: http://crawclaw-gateway:18789
    policy:
      - allow:
          or:
            - email:
                is: nick@example.com
    pass_identity_headers: true
```

### Caddy with OAuth

Caddy 配合 `caddy-security` plugin 可以认证 users 并传递 identity headers。

```json5
{
  gateway: {
    bind: "lan",
    trustedProxies: ["127.0.0.1"], // Caddy's IP (if on same host)
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
      },
    },
  },
}
```

Caddyfile snippet：

```text
crawclaw.example.com {
    authenticate with oauth2_provider
    authorize with policy1

    reverse_proxy crawclaw:18789 {
        header_up X-Forwarded-User {http.auth.user.email}
    }
}
```

### nginx + oauth2-proxy

oauth2-proxy 会认证 users，并在 `x-auth-request-email` 中传递 identity。

```json5
{
  gateway: {
    bind: "lan",
    trustedProxies: ["10.0.0.1"], // nginx/oauth2-proxy IP
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-auth-request-email",
      },
    },
  },
}
```

nginx config snippet：

```nginx
location / {
    auth_request /oauth2/auth;
    auth_request_set $user $upstream_http_x_auth_request_email;

    proxy_pass http://crawclaw:18789;
    proxy_set_header X-Auth-Request-Email $user;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### Traefik with Forward Auth

```json5
{
  gateway: {
    bind: "lan",
    trustedProxies: ["172.17.0.1"], // Traefik container IP
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
      },
    },
  },
}
```

## Mixed token configuration

CrawClaw 会拒绝同时启用 `gateway.auth.token`（或 `CRAWCLAW_GATEWAY_TOKEN`）和 `trusted-proxy` mode 的 ambiguous configurations。Mixed token configs 可能导致 loopback requests 静默走错 auth path。

如果 startup 时看到 `mixed_trusted_proxy_token` error：

- 使用 trusted-proxy mode 时移除 shared token，或
- 如果你想使用 token-based auth，将 `gateway.auth.mode` 切换为 `"token"`。

Loopback trusted-proxy auth 也会 fail closed：same-host callers 必须通过 trusted proxy 提供配置的 identity headers，而不是被静默 authenticated。

## Security Checklist

启用 trusted-proxy auth 前，验证：

- [ ] **Proxy is the only path**: Gateway port 已对除 proxy 之外的所有来源 firewalled
- [ ] **trustedProxies is minimal**: 只包含实际 proxy IPs，不包含整个 subnets
- [ ] **Proxy strips headers**: proxy 会 overwrite（不是 append）clients 传入的 `x-forwarded-*` headers
- [ ] **TLS termination**: proxy 处理 TLS；users 通过 HTTPS 连接
- [ ] **allowUsers is set**（推荐）: 限制为已知 users，而不是允许任何 authenticated user
- [ ] **No mixed token config**: 不要同时设置 `gateway.auth.token` 和 `gateway.auth.mode: "trusted-proxy"`

## Security Audit

CrawClaw Desktop 或本地 Gateway API 会用 **critical** severity finding 标记 trusted-proxy auth。这是有意的，它提醒你正在把 security 委托给 proxy setup。

Audit 检查：

- 缺少 `trustedProxies` configuration
- 缺少 `userHeader` configuration
- 空 `allowUsers`（允许任何 authenticated user）

## Troubleshooting

### "trusted_proxy_untrusted_source"

Request 不是来自 `gateway.trustedProxies` 中的 IP。检查：

- Proxy IP 是否正确？
- Proxy 前是否还有 load balancer？
- 使用 process manager 或 orchestration layer 查找实际 IPs。

### "trusted_proxy_user_missing"

User header 为空或缺失。检查：

- Proxy 是否配置为传递 identity headers？
- Header name 是否正确？（case-insensitive，但 spelling 很重要）
- User 是否真的已在 proxy 认证？

### "trusted*proxy_missing_header*\*"

某个 required header 不存在。检查：

- 这些 specific headers 的 proxy configuration
- Headers 是否在 chain 中某处被 stripped

### "trusted_proxy_user_not_allowed"

User 已认证，但不在 `allowUsers` 中。添加该 user，或移除 allowlist。

### WebSocket Still Failing

确保你的 proxy：

- 支持 WebSocket upgrades（`Upgrade: websocket`、`Connection: upgrade`）
- 在 WebSocket upgrade requests 上传递 identity headers（不仅是 HTTP）
- 没有为 WebSocket connections 使用单独的 auth path

## Migration from Token Auth

如果你从 token auth 迁移到 trusted-proxy：

1. 配置 proxy 认证 users 并传递 headers
2. 独立测试 proxy setup（curl with headers）
3. 用 trusted-proxy auth 更新 CrawClaw config
4. 重启 Gateway
5. 从 browser-facing client 测试 WebSocket connections
6. 运行 CrawClaw Desktop 或本地 Gateway API 并 review findings

## Related

- [Security](/gateway/security) -- 完整 security guide
- [Configuration](/gateway/configuration) -- config reference
- [Remote Access](/gateway/remote) -- 其他 remote access patterns
- [Tailscale](/gateway/tailscale) -- tailnet-only access 的更简单替代方案
