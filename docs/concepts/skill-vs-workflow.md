---
title: "Skill vs Workflow"
summary: "Boundary between reusable skill guidance and executable workflow processes"
read_when:
  - You are deciding whether reuse belongs in a skill or workflow
  - You are designing skill promotion or workflow automation
---

# Skill vs Workflow

This document defines the boundary between skills and workflows in CrawClaw.

## Short Version

- a `skill` is reusable method
- a `workflow` is reusable execution process

A skill helps the agent think and act better.
A workflow defines a process that can be run, tracked, updated, and automated.

## Skill

A skill is a reusable instruction or method.

It is best for:

- techniques
- domain guidance
- structured heuristics
- repeatable task approaches
- instruction-level reuse

Skills are usually lightweight and flexible.

They improve how the agent performs work.

## Workflow

A workflow is a reusable process with explicit structure and lifecycle.

It is best for:

- multi-step orchestration
- deployable or rerunnable procedures
- processes with topology or step state
- long-running or resumable execution
- auditable automation paths

Workflows are operational objects, not just instructions.

They improve how the system executes repeatable processes.

## Boundary Rule

If it is mainly guidance for how to solve a class of problems, keep it as a skill.

If it is mainly a defined multi-step process that should run as a first-class object, make it a workflow.

Examples:

- "How to review plugin-sdk facade regressions" -> skill
- "Nightly provider health validation across configured runtimes" -> workflow
- "How to promote session summaries into durable memory" -> skill
- "A scheduled memory hygiene pipeline with execution state and rollback" -> workflow

## What Belongs In A Skill

Use a skill when:

- flexibility matters more than orchestration
- the agent still needs to reason through the task
- the steps are guidance, not strict process state
- reuse happens through prompting and method selection

## What Belongs In A Workflow

Use a workflow when:

- the steps should be explicit
- state transitions matter
- the process should be deployed, rerun, or rolled back
- execution history should be tracked as a process
- the work should later be automated or scheduled

## Anti-Patterns

### Encoding workflows as giant skills

Symptoms:

- a skill becomes long, rigid, and operational
- the system cannot track run state well
- approvals, rollback, or execution history become ad hoc

### Encoding skills as tiny workflows

Symptoms:

- workflow sprawl
- too much process overhead for simple reusable methods
- users and operators cannot tell which workflows are truly operational assets

## Promotion Rule

The intended flow is:

1. A useful method emerges.
2. The method is captured as a skill.
3. When the method becomes stable, repetitive, and process-like, it is promoted to a workflow.
4. When the workflow becomes recurring or externally triggered, it may move into cron or hooks.

Skills should usually come before workflows.

## Product Framing

Use this wording consistently:

- Skill answers: "How should the agent approach this?"
- Workflow answers: "What process should the system run?"

## Architectural Mapping

Skill-heavy areas today include:

- `src/agents/skills`
- `skills/`

Workflow-heavy areas today include:

- `src/workflows`
- `src/agents/tools/workflow-tool.ts`
- `src/gateway/server-methods/workflow.ts`
- `src/cron`
- `src/hooks`

## Decision Test

Ask two questions:

1. Is this primarily reusable guidance?
2. Or is this primarily an executable process with lifecycle and state?

If it is guidance, it belongs in a skill.

If it is a managed process, it belongs in a workflow.
