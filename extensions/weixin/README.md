# Weixin

[简体中文](./README.zh_CN.md)

Bundled CrawClaw plugin for personal Weixin through Tencent iLink Bot QR login.

## Scope

Current support:

- QR login and re-login
- start and stop account runtime
- direct-message receive path
- text send
- media send from a local file path or remote URL

Not included:

- group chat handling
- enterprise WeCom support
- legacy host compatibility loading

## Quick start

```bash
crawclaw channels add --channel weixin
crawclaw channels login --channel weixin
crawclaw gateway
```

For a named local account slot:

```bash
crawclaw channels login --channel weixin --account work
```

Verify runtime state:

```bash
crawclaw channels status --probe
```

## State model

- Default local account id: `default`
- Credentials: `~/.crawclaw/weixin/accounts/`
- Channel reload marker: `~/.crawclaw/crawclaw.json`
- Pairing allowlists: standard CrawClaw pairing store

## Docs

- Channel guide: https://docs.crawclaw.ai/channels/weixin
- Pairing: https://docs.crawclaw.ai/channels/pairing
- Troubleshooting: https://docs.crawclaw.ai/channels/troubleshooting
