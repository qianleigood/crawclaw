---
name: superpowers
description: Spec-first, TDD, subagent-driven software development workflow for building features, debugging failures, planning implementation, and finishing feature branches. Not for one-line fixes, passive code reading, or non-code tasks. Requires exec tool and sessions_spawn.
---

# Superpowers

Use this skill when the user wants a disciplined software-delivery workflow, not just a code patch.

## Pipeline

Idea -> Brainstorm -> Plan -> Subagent-Driven Build -> Review -> Finish Branch

Treat this as mandatory workflow, not optional advice.

## Phase routing

- `references/brainstorming.md`
  Use before coding to explore context, ask clarifying questions, compare approaches, and produce a design.
- `references/writing-plans.md`
  Use after design approval to turn the design into small executable tasks.
- `references/subagent-development.md`
  Use when executing the plan with `sessions_spawn`, TDD, and staged review.
- `references/systematic-debugging.md`
  Use for failures, regressions, or any technical issue; no fixes before root-cause work.
- `references/tdd.md`
  Use whenever a task is implemented.
- `references/finishing-branch.md`
  Use when all tasks are done and the branch is ready to merge, push, keep, or discard.

## Hard rules

- No code before design approval.
- TDD is mandatory.
- One clarifying question at a time during brainstorming.
- Prefer evidence over claims; verify before declaring success.
- Keep changes minimal and commit after green checkpoints.

## Subagent dispatch

When using `sessions_spawn`, always include:

- goal
- plan/context
- exact files
- constraints
- verification command
- the task text itself
