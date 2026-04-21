# Support Matrix

This matrix describes the current support posture for CrawClaw surfaces. It is not a feature checklist. It tells you which areas are safest to rely on, which are moving quickly, and which should be treated as experimental.

## Support levels

- `Supported`: core path, documented, and expected to remain stable.
- `Beta`: useful and actively maintained, but still changing quickly.
- `Experimental`: available for advanced users, but likely to shift in behavior, API shape, or docs.

## Core runtime

| Surface                    | Status    | Notes                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------- |
| CLI                        | Supported | Main operator entrypoint.                                             |
| Gateway                    | Supported | Primary control plane for sessions, tools, channels, and events.      |
| Local workspace and config | Supported | `~/.crawclaw` and `crawclaw.json` are the canonical runtime surfaces. |
| Onboarding                 | Beta      | Recommended setup path; still evolving quickly.                       |

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

| Surface                         | Status       | Notes                                          |
| ------------------------------- | ------------ | ---------------------------------------------- |
| High-traffic messaging channels | Beta         | Expect active fixes and compatibility work.    |
| Long-tail channels/plugins      | Experimental | Best-effort unless docs state otherwise.       |
| Plugin SDK                      | Beta         | Public, but still being slimmed and clarified. |

## User interfaces

| Surface                            | Status       | Notes                                                 |
| ---------------------------------- | ------------ | ----------------------------------------------------- |
| Terminal-first setup and operation | Supported    | Primary recommended path.                             |
| WebChat / browser web surfaces     | Beta         | Useful, but not yet the most stable public surface.   |
| Browser and canvas tooling         | Experimental | Powerful local-first features with fast-moving edges. |

## Contributor guidance

- If you want the safest place to contribute, start with CLI, gateway, sessions, or docs.
- If you touch memory, skills, workflows, or plugin-sdk, expect more product and API discussion.
- If you touch long-tail channels, browser/canvas, or automation, expect more environment-specific validation.
