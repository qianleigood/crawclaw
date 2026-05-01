---
name: skill-vetter
description: Use before installing or trusting third-party skills from skillhub, clawhub, GitHub, or other external sources when source trust, permissions, secrets, or command/network risk need review.
---

# Skill Vetter

Use this skill before installing unknown skills.

## Workflow

1. Check the source:
   - where it came from
   - who maintains it
   - trust signals such as stars, installs, reviews, or update recency
2. Read all files in the skill.
3. Classify the permission scope:
   - files read or written
   - commands run
   - network access
4. Assign a risk level.
5. Produce a clear install verdict.

## Immediate reject signals

- exfiltration to unknown external services
- requests for credentials, tokens, or secrets without a clear reason
- reads of sensitive config or key stores without a narrow purpose
- obfuscated or encoded code
- arbitrary `eval` or `exec`
- unexplained package installs
- broad filesystem writes outside the stated workspace
- requests for elevated privileges

## Output

Report:

- source
- files reviewed
- red flags
- permission scope
- risk level
- verdict

## Rules

- When in doubt, do not install.
- Human approval is required for high-risk skills.
- Prefer bundled or audited skills over unknown sources.
