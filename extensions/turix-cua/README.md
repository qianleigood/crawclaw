# TuriX CUA Plugin

`turix-cua` registers the optional `turix_desktop_run` tool. The tool plans or
runs local macOS desktop automation through a TuriX-CUA Python checkout.

The plugin is enabled by default, but the tool is optional. It is not exposed to
agents unless the user adds either the tool name or the plugin id to
`tools.allow`.

```json5
{
  tools: {
    allow: ["turix-cua"],
  },
}
```

## Runtime

The MVP supports two runtime modes:

- `managed`: resolves to the future managed runtime under the CrawClaw state
  directory.
- `external`: points at an existing TuriX-CUA checkout and Python executable.

Use `external` for the current implementation:

```json5
{
  plugins: {
    entries: {
      "turix-cua": {
        config: {
          runtime: {
            mode: "external",
            projectDir: "/path/to/TuriX-CUA",
            pythonPath: "/path/to/TuriX-CUA/.venv/bin/python",
          },
          allowRemoteRequests: false,
        },
      },
    },
  },
  tools: {
    allow: ["turix-cua"],
  },
}
```

Provider secrets are read from environment variables such as `TURIX_API_KEY`.
The generated TuriX config file does not embed provider API keys.

TuriX expects model responses to parse as structured output. CrawClaw defaults
`stripReasoningTags` to `true` so leading `<think>...</think>` blocks from
reasoning models are removed inside the TuriX child process before TuriX parses
the response. Set `stripReasoningTags: false` only for a provider-compatible
runtime that needs the raw response text.

## Safety

`mode: "plan"` checks setup and returns the run artifact path without launching
TuriX. `mode: "run"` starts desktop automation and always goes through plugin
approval. Channel-originated runs are blocked unless
`allowRemoteRequests: true` is configured.

The current production surface is task-level only. It does not expose raw mouse,
keyboard, or AppleScript actions as CrawClaw tools.
