---
summary: "Weixin personal account support through Tencent iLink Bot QR login"
read_when:
  - Setting up personal Weixin in CrawClaw
  - Troubleshooting QR login or direct-message delivery for Weixin
title: "Weixin"
---

# Weixin

Status: bundled plugin for personal Weixin via Tencent iLink Bot. Direct messages
only in v1.

<CardGroup cols={3}>
  <Card title="Pairing" icon="link" href="/channels/pairing">
    Default DM policy is pairing for unknown senders.
  </Card>
  <Card title="Channel troubleshooting" icon="wrench" href="/channels/troubleshooting">
    Cross-channel diagnostics and repair playbooks.
  </Card>
  <Card title="Gateway configuration" icon="settings" href="/gateway/configuration">
    Full channel config patterns and examples.
  </Card>
</CardGroup>

## Quick setup

<Steps>
  <Step title="Enable the Weixin channel">

```bash
crawclaw channels add --channel weixin
```

  </Step>

  <Step title="Start QR login">

```bash
crawclaw channels login --channel weixin
```

For a named local account slot:

```bash
crawclaw channels login --channel weixin --account work
```

  </Step>

  <Step title="Scan the QR code in WeChat">

The login command prints a terminal QR code and a fallback QR URL. After the
scan completes, CrawClaw stores the linked bot token in the local channel state.

  </Step>

  <Step title="Start or restart the gateway">

```bash
crawclaw gateway
```

Verify with:

```bash
crawclaw channels status --probe
```

  </Step>
</Steps>

## Config shape

Minimal channel config:

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

Named account override:

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

## Current v1 scope

- QR login and re-login
- Start and stop account runtime
- Pairing-gated direct-message access
- Direct-message receive path into the normal reply pipeline
- Text send
- Media send from a local file path or remote URL

Not included in v1:

- configurable DM policy variants
- group chat handling
- enterprise WeCom support
- OpenClaw compatibility loading

## State and operations

- Default local account id is `default`.
- Account credentials are stored under `~/.crawclaw/weixin/accounts/`.
- Channel reload markers are written into `~/.crawclaw/crawclaw.json`.
- Pairing allowlists follow the standard channel pairing store documented in
  [Pairing](/channels/pairing).

## Notes

- This channel uses Tencent iLink Bot and depends on its QR login flow.
- If QR login succeeds but replies do not start, re-run `crawclaw channels status --probe`
  and inspect the gateway logs.
- For cross-channel diagnostics, see [Channel troubleshooting](/channels/troubleshooting).
