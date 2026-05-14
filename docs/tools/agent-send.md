---
summary: "Run agent turns from the CLI and optionally deliver replies to channels"
read_when:
  - You want to trigger agent runs from scripts or the command line
  - You need to deliver agent replies to a chat channel programmatically
title: "Agent Send"
---

# Agent Send

CrawClaw Desktop or the local Gateway API runs a single agent turn from the command line without needing
an inbound chat message. Use it for scripted workflows, testing, and
programmatic delivery.

## Quick start

<Steps>
  <Step title="Run a simple agent turn">
    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    This sends the message through the Gateway and prints the reply.

  </Step>

  <Step title="Target a specific agent or session">
    ```bash
    # Target a specific agent
    # Use CrawClaw Desktop or the local Gateway API for this operation.

    # Target a phone number (derives session key)
    # Use CrawClaw Desktop or the local Gateway API for this operation.

    # Reuse an existing session
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

  </Step>

  <Step title="Deliver the reply to a channel">
    ```bash
    # Deliver to WhatsApp (default channel)
    # Use CrawClaw Desktop or the local Gateway API for this operation.

    # Deliver to Slack
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

  </Step>
</Steps>

## Flags

| Flag                          | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `--message \<text\>`          | Message to send (required)                                  |
| `--to \<dest\>`               | Derive session key from a target (phone, chat id)           |
| `--agent \<id\>`              | Target a configured agent (uses its `main` session)         |
| `--session-id \<id\>`         | Reuse an existing session by id                             |
| `--local`                     | Force local embedded runtime (skip Gateway)                 |
| `--deliver`                   | Send the reply to a chat channel                            |
| `--channel \<name\>`          | Delivery channel (whatsapp, telegram, discord, slack, etc.) |
| `--reply-to \<target\>`       | Delivery target override                                    |
| `--reply-channel \<name\>`    | Delivery channel override                                   |
| `--reply-account \<id\>`      | Delivery account id override                                |
| `--thinking \<level\>`        | Set thinking level (off, minimal, low, medium, high, xhigh) |
| `--verbose \<on\|full\|off\>` | Set verbose level                                           |
| `--timeout \<seconds\>`       | Override agent timeout                                      |
| `--json`                      | Output structured JSON                                      |

## Behavior

- By default, the CLI goes **through the Gateway**. Add `--local` to force the
  embedded runtime on the current machine.
- If the Gateway is unreachable, the CLI **falls back** to the local embedded run.
- Session selection: `--to` derives the session key (group/channel targets
  preserve isolation; direct chats collapse to `main`).
- Thinking and verbose flags persist into the session store.
- Output: plain text by default, or `--json` for structured payload + metadata.

## Examples

```bash
# Simple turn with JSON output
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Turn with thinking level
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Deliver to a different channel than the session
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## Related

- [Agent Gateway API](/tools/agent-send)
- [Sub-agents](/tools/subagents) — background sub-agent spawning
- [Sessions](/concepts/session) — how session keys work
