---
title: "TuriX CUA Tool"
summary: "Run optional high-risk local desktop automation through TuriX-CUA"
read_when:
  - You want CrawClaw to control the local macOS desktop
  - You need to enable the turix_desktop_run tool
  - You are debugging TuriX-CUA runtime setup or desktop automation approvals
---

# TuriX CUA tool

`turix_desktop_run` lets CrawClaw plan or run a local macOS desktop automation
task through a TuriX-CUA Python checkout. It is a task-level bridge: CrawClaw
asks TuriX-CUA to complete a desktop task, and TuriX-CUA owns its own
observe-plan-act loop.

The tool does not expose raw click, type, or AppleScript primitives as CrawClaw
tools.

## Availability

The bundled `turix-cua` plugin registers `turix_desktop_run` as an optional
tool. Enable it with either the tool name or plugin id:

```json5
{
  tools: {
    allow: ["turix-cua"],
  },
}
```

or:

```json5
{
  tools: {
    allow: ["turix_desktop_run"],
  },
}
```

The MVP supports macOS only. The machine running the tool must have the TuriX
Python runtime, Screen Recording permission, and Accessibility permission set
up before a real run can succeed.

## Config

Use `external` runtime mode to point CrawClaw at an existing TuriX-CUA checkout:

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
          models: {
            brain: {
              provider: "turix",
              modelName: "turix-brain",
              baseUrl: "https://turixapi.io/v1",
              apiKeyEnv: "TURIX_API_KEY",
            },
            actor: {
              provider: "turix",
              modelName: "turix-actor",
              baseUrl: "https://turixapi.io/v1",
              apiKeyEnv: "TURIX_API_KEY",
            },
          },
          stripReasoningTags: true,
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
CrawClaw maps the configured env var into the child process environment and does
not embed the key in the generated TuriX config file.

`stripReasoningTags` defaults to `true`. It removes leading `<think>...</think>`
blocks from TuriX model responses inside the TuriX child process before TuriX
parses structured output. Keep it enabled for reasoning models and
OpenAI-compatible providers that may expose reasoning text before JSON. Set it
to `false` only when the configured runtime requires raw model response text.

## Modes

`mode: "plan"` checks runtime setup and returns the run artifact path without
starting TuriX.

`mode: "run"` starts TuriX-CUA and always requires plugin approval. Approval
text warns that TuriX-CUA can see and control the local desktop and that
screenshots may be sent to the configured TuriX model provider.

If the request originated from a chat channel, real runs are blocked unless
`allowRemoteRequests: true` is configured.

## Artifacts

Each run writes artifacts under the CrawClaw state directory by default:

```text
~/.crawclaw/turix-cua/runs/<runId>/
```

The tool returns artifact references for logs, generated config, stdout,
stderr, and screenshot directories. It does not paste screenshots into the chat
by default.

## Related

- [Plugins](/tools/plugin) for plugin enablement
- [Exec approvals](/tools/exec-approvals) for approval flow concepts
