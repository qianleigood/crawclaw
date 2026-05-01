---
name: healthcheck
description: Use when auditing or hardening the host running CrawClaw, including security posture review, exposure assessment, firewall or SSH hardening, periodic host audits, or version checks.
---

# CrawClaw Host Hardening

Assess the host running CrawClaw, then propose a hardening plan that matches the user's risk tolerance without breaking access.

## Rules

- Require explicit approval before any state-changing action.
- Do not change firewall, SSH, RDP, or package state without confirmation.
- Prefer reversible, staged changes with a rollback plan.
- Never imply CrawClaw itself manages host firewall or OS updates.
- Use numbered choices whenever the user needs to pick from options.

## Workflow

1. Ask once for permission to run read-only checks.
2. Establish context:
   - OS and version
   - privilege level
   - local vs remote access path
   - exposure level
   - CrawClaw gateway status and bind
   - backup, disk encryption, and update posture
3. Run CrawClaw checks:
   - `crawclaw security audit --deep`
   - `crawclaw update status`
4. Ask the user to pick a risk posture:
   1. Home/workstation balanced
   2. VPS hardened
   3. Developer convenience
   4. Custom
5. Produce a remediation plan with current posture, gaps, exact commands, rollback, and lockout risks.
6. Only execute after explicit approval.
7. Re-run audits and summarize deferred items.

## Scheduling

After any audit or hardening pass, explicitly offer periodic checks. If the user agrees, schedule stable named jobs such as:

- `healthcheck:security-audit`
- `healthcheck:update-status`

Do not create or edit cron jobs without approval.
