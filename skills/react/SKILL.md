---
name: react
description: Use when the main complexity is React engineering, including component architecture, hooks, React 19, rendering behavior, state separation, forms, performance, or React-specific debugging.
---

# React

Production-grade React engineering guidance.

## When to use

Use this skill when the main challenge is specifically React:

- components and page architecture
- hooks and rendering behavior
- React 19 features
- client/server state separation
- React performance tuning
- React-specific debugging and setup

## Core decisions

Before implementation, decide:

- rendering mode
- server-state approach
- client-state approach
- styling approach
- forms approach

**Hard rule:** server state and client state are different concerns.

## Working rules

- Keep component responsibilities tight.
- Prefer named exports.
- Keep files and JSX blocks from growing without bound.
- Treat hook order and effect cleanup as non-negotiable.
- Fix rendering traps before adding clever abstractions.

## Reference routing

### Architecture and state

Read `references/architecture-and-state.md` when you need:

- architecture decisions
- component rules
- state management defaults

### React 19 and performance

Read `references/react-19-and-performance.md` when you need:

- Server Components
- `use()`
- `useActionState`
- performance rules and rendering pitfalls

### Traps and setup

Read `references/traps-and-setup.md` when you need:

- common hook / rendering / fetching traps
- setup guidance
- routing between this skill and neighboring skills

## Neighboring skill boundaries

- Use `frontend-dev` when the job is broader product-facing frontend experience, visual polish, motion, and content.
- Use `fullstack-dev` when the job spans frontend plus backend/application architecture.
- Use this skill when the work is mostly about React engineering itself.
