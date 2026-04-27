---
read_when:
  - 在 CrawClaw 中设置个人 Weixin 时
  - 排查 Weixin 二维码登录或私聊投递问题时
summary: "通过 Tencent iLink Bot 二维码登录支持个人 Weixin"
title: "Weixin"
x-i18n:
  generated_at: "2026-04-27T00:00:00Z"
  model: manual
  provider: codex
  source_path: channels/weixin.md
  workflow: manual
---

# Weixin

状态：通过 Tencent iLink Bot 支持个人 Weixin 的内置插件。v1 仅支持私聊。

<CardGroup cols={3}>
  <Card title="配对" icon="link" href="/zh-CN/channels/pairing">
    未知发送者默认使用配对 DM 策略。
  </Card>
  <Card title="渠道故障排查" icon="wrench" href="/zh-CN/channels/troubleshooting">
    跨渠道诊断和修复流程。
  </Card>
  <Card title="Gateway 配置" icon="settings" href="/zh-CN/gateway/configuration">
    完整渠道配置模式和示例。
  </Card>
</CardGroup>

## 快速设置

<Steps>
  <Step title="启用 Weixin 渠道">

```bash
crawclaw channels add --channel weixin
```

  </Step>

  <Step title="开始二维码登录">

```bash
crawclaw channels login --channel weixin
```

对于具名本地账号槽：

```bash
crawclaw channels login --channel weixin --account work
```

  </Step>

  <Step title="在微信中扫描二维码">

登录命令会打印终端二维码和备用二维码 URL。扫码完成后，CrawClaw 会把已关联的 bot token 存入本地渠道状态。

  </Step>

  <Step title="启动或重启 Gateway">

```bash
crawclaw gateway
```

验证状态：

```bash
crawclaw channels status --probe
```

  </Step>
</Steps>

## 配置形状

最小渠道配置：

```json5
{
  channels: {
    weixin: {
      name: "Personal Weixin",
      enabled: true,
    },
  },
}
```

具名账号覆盖：

```json5
{
  channels: {
    weixin: {
      accounts: {
        work: {
          name: "Work Weixin",
          enabled: true,
        },
      },
    },
  },
}
```

## 当前 v1 范围

- 二维码登录和重新登录
- 启动和停止账号运行时
- 受配对保护的私聊访问
- 私聊接收并进入常规回复流水线
- 文本发送
- 从本地文件路径或远程 URL 发送媒体

v1 不包含：

- 可配置的 DM 策略变体
- 群聊处理
- 企业微信支持
- OpenClaw 兼容加载

## 状态和运维

- 默认本地账号 id 是 `default`。
- 账号凭据存储在 `~/.crawclaw/weixin/accounts/` 下。
- 渠道 reload 标记会写入 `~/.crawclaw/crawclaw.json`。
- 配对允许列表使用 [Pairing](/zh-CN/channels/pairing) 中记录的标准渠道配对存储。

## 备注

- 此渠道使用 Tencent iLink Bot，并依赖它的二维码登录流程。
- 如果二维码登录成功但回复没有启动，请重新运行 `crawclaw channels status --probe` 并检查 Gateway 日志。
- 跨渠道诊断请参阅[渠道故障排查](/zh-CN/channels/troubleshooting)。
