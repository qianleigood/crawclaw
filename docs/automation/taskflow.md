---
summary: "Task Flow compatibility boundary for CrawClaw workflows and background tasks"
read_when:
  - You want to understand how Task Flow relates to background tasks
  - You encounter Task Flow in release notes or docs
  - You need to map older ClawFlow or task-flow language to current workflows
title: "Task Flow"
---

# Task Flow

Task Flow is retained as compatibility language for older ClawFlow and task-flow docs. In the current Gateway, it is not a separate general-purpose workflow engine. New multi-step automation should use CrawClaw workflows: the Rust workflow tools manage workflow drafts, registry entries, versions, runs, and n8n binding, while [background tasks](/automation/tasks) remain the detached-work ledger.

## When to use workflows

Use workflows when work spans multiple sequential or branching steps and you need a visible asset that can be reviewed, versioned, run, and bound to n8n. For single background operations, a plain [task](/automation/tasks) is sufficient.

| Scenario                              | Use             |
| ------------------------------------- | --------------- |
| Single background job                 | Plain task      |
| One-shot reminder                     | Cron job        |
| Durable multi-step workflow asset     | Workflow + n8n  |
| Inspect detached execution history    | Background task |
| Older docs mention ClawFlow/Task Flow | This page       |

## Current boundary

Current workflow ownership is split:

- **Rust workflow tools** own workflow drafts, local registry state, versions, matching, runs, and lifecycle actions such as enable, disable, archive, and delete.
- **n8n** owns deployed workflow graph execution when a workflow is bound to an n8n workflow id.
- **Background tasks** own detached-run records, status inspection, completion notifications, and cleanup.
- **CrawClaw Desktop and the Gateway API** expose workflow and task state to operators.

Task Flow should not be treated as a second workflow engine beside n8n.

## Migration notes

- Older **ClawFlow** links redirect here.
- Older references to managed or mirrored Task Flow state should be read as workflow/task integration notes, not a standalone API contract.
- For operator-facing multi-step automation, start with the workflow tools and n8n workflow architecture.

## How workflows relate to tasks

Workflows do not replace tasks. Workflow runs may create or reference task records, and task records remain the place to inspect detached execution history. Use Desktop or the Gateway API to inspect individual task records.

## Related

- [Background Tasks](/automation/tasks) — the detached work ledger
- [Automation Overview](/automation) — all automation mechanisms at a glance
- [Cron Jobs](/automation/cron-jobs) — scheduled jobs and main-session wakes
- [n8n workflow architecture](/reference/n8n-workflow-architecture) — current workflow broker and n8n execution boundary
