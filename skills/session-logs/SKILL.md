---
name: session-logs
description: Search and analyze your own session logs with jq and rg. Use when a user references an older conversation, a parent session, or a prior reply that is no longer in current context.
metadata:
  {
    "crawclaw":
      {
        "emoji": "📜",
        "requires": { "bins": ["jq", "rg"] },
        "install":
          [
            {
              "id": "brew-jq",
              "kind": "brew",
              "formula": "jq",
              "bins": ["jq"],
              "label": "Install jq (brew)",
            },
            {
              "id": "brew-rg",
              "kind": "brew",
              "formula": "ripgrep",
              "bins": ["rg"],
              "label": "Install ripgrep (brew)",
            },
          ],
      },
  }
---

# session-logs

Search conversation history stored in session JSONL files.

## Location

Session logs live under:
`$CRAWCLAW_STATE_DIR/agents/<agentId>/sessions/`

- `sessions.json`: index mapping session keys to session IDs
- `<session-id>.jsonl`: full transcript for a session

## Common queries

```bash
# User messages from one session
jq -r 'select(.message.role == "user") | .message.content[]? | select(.type == "text") | .text' <session>.jsonl

# Assistant text matching a keyword
jq -r 'select(.message.role == "assistant") | .message.content[]? | select(.type == "text") | .text' <session>.jsonl | rg -i "keyword"

# Tool usage breakdown
jq -r '.message.content[]? | select(.type == "toolCall") | .name' <session>.jsonl | sort | uniq -c | sort -rn

# Search across all sessions
SESSION_DIR="${CRAWCLAW_STATE_DIR:-$HOME/.crawclaw}/agents/<agentId>/sessions"
rg -l "phrase" "$SESSION_DIR"/*.jsonl
```

## Notes

- Sessions are append-only JSONL.
- Large sessions can be several MB; sample with `head` or `tail` before full parsing.
- Deleted sessions usually have a `.deleted.<timestamp>` suffix.
