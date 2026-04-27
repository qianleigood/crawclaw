# 微信

[English](./README.md)

这是一个基于腾讯 iLink Bot 的 CrawClaw 内置个人微信插件，使用扫码完成登录。

## 当前范围

已支持：

- 扫码登录和重新登录
- 账号启动与停止
- 私聊消息接收
- 文本发送
- 本地文件路径或远程 URL 的媒体发送

暂不包含：

- 群聊处理
- 企业微信 / WeCom
- 旧宿主兼容加载

## 快速开始

```bash
crawclaw channels add --channel weixin
crawclaw channels login --channel weixin
crawclaw gateway
```

如果要绑定到命名本地账号槽位：

```bash
crawclaw channels login --channel weixin --account work
```

查看运行状态：

```bash
crawclaw channels status --probe
```

## 状态目录

- 默认本地账号 id：`default`
- 凭据目录：`~/.crawclaw/weixin/accounts/`
- 渠道重载标记：`~/.crawclaw/crawclaw.json`
- 配对 allowlist：沿用 CrawClaw 标准 pairing 存储

## 文档

- 渠道说明：https://docs.crawclaw.ai/channels/weixin
- 配对机制：https://docs.crawclaw.ai/channels/pairing
- 排障说明：https://docs.crawclaw.ai/channels/troubleshooting
