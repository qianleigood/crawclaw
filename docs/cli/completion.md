---
summary: "CLI reference for `crawclaw completion` (generate/install shell completion scripts)"
read_when:
  - You want shell completions for zsh/bash/fish/PowerShell
  - You need to cache completion scripts under CrawClaw state
title: "completion"
---

# `crawclaw completion`

Generate shell completion scripts and optionally install them into your shell profile.

## Usage

```bash
crawclaw completion
crawclaw completion --shell zsh
crawclaw completion --install
crawclaw completion --shell fish --install
crawclaw completion --write-state
crawclaw completion --shell bash --write-state
```

## Options

- `-s, --shell <shell>`: shell target (`zsh`, `bash`, `powershell`, `fish`; default: `zsh`)
- `-i, --install`: install completion by adding a source line to your shell profile
- `--write-state`: write completion script(s) to `$CRAWCLAW_STATE_DIR/completions` without printing to stdout
- `-y, --yes`: skip install confirmation prompts

## Notes

- `--install` writes a small "CrawClaw Completion" block into your shell profile and points it at the cached script.
- Without `--install` or `--write-state`, the command prints the script to stdout.
- Completion generation eagerly loads command trees so nested subcommands are included.
