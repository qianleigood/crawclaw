---
title: "Support Matrix"
summary: "Current support posture for CrawClaw runtime, agent, channel, and plugin surfaces"
read_when:
  - You are documenting support status for CrawClaw surfaces
  - You need to distinguish supported, beta, and experimental areas
---

# Support Matrix

This matrix describes the current support posture for CrawClaw surfaces. It is not a feature checklist. It tells you which areas are safest to rely on, which are moving quickly, and which should be treated as experimental.

## Support levels

- `Supported`: core path, documented, and expected to remain stable.
- `Beta`: useful and actively maintained, but still changing quickly.
- `Experimental`: available for advanced users, but likely to shift in behavior, API shape, or docs.

## Core runtime

| Surface                    | Status    | Notes                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------- |
| CrawClaw Desktop           | Supported | Main Apple-platform user entrypoint.                                  |
| Gateway                    | Supported | Primary control plane for sessions, tools, channels, and events.      |
| Local workspace and config | Supported | `~/.crawclaw` and `crawclaw.json` are the canonical runtime surfaces. |
| Onboarding                 | Beta      | Desktop-first setup path; still evolving quickly.                     |

## Agent platform

| Surface                   | Status       | Notes                                                              |
| ------------------------- | ------------ | ------------------------------------------------------------------ |
| Core agent runtime        | Supported    | Main assistant loop and tool execution path.                       |
| Sessions and history      | Supported    | Core user-facing and operator-facing behavior.                     |
| Memory recall             | Beta         | Heavily used, but still under active product shaping.              |
| Skills                    | Beta         | Useful and growing; exact promotion ergonomics are still evolving. |
| Workflows                 | Beta         | Powerful, but still a high-change area.                            |
| Cron and hooks automation | Experimental | Good for advanced operators; expect iteration.                     |

## Integrations

| Surface                         | Status       | Notes                                       |
| ------------------------------- | ------------ | ------------------------------------------- |
| High-traffic messaging channels | Beta         | Expect active fixes and compatibility work. |
| Long-tail channels/plugins      | Experimental | Best-effort unless docs state otherwise.    |
| Rust plugin SDK                 | Beta         | Public native descriptor surface.           |

## User interfaces

| Surface                           | Status       | Notes                                                 |
| --------------------------------- | ------------ | ----------------------------------------------------- |
| Desktop-first setup and operation | Supported    | Primary recommended path on Apple platforms.          |
| Browser tooling                   | Experimental | Powerful local-first features with fast-moving edges. |

## Contributor guidance

- If you want the safest place to contribute, start with Desktop, Gateway, sessions, or docs.
- If you touch memory, skills, workflows, or the Rust plugin SDK, expect more product and API discussion.
- If you touch long-tail channels, browser/canvas, or automation, expect more environment-specific validation.
