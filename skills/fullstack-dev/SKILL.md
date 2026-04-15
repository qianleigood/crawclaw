---
name: fullstack-dev
description: |
  Full-stack application architecture and implementation skill for work that spans backend services and browser-facing product behavior. Use when users need API plus frontend integration, auth/session flows, uploads, CRUD/business workflows, real-time features, or production hardening across Node.js, Python, Go, Next.js API routes, or similar stacks.
license: MIT
metadata:
  category: full-stack
  version: "1.0.0"
---

# Full-Stack Development Practices

Use this skill when the task crosses the frontend/backend boundary.

## Use this skill for

- full-stack apps
- backend + frontend integration
- API or service scaffolding
- auth, uploads, caching, background jobs
- real-time features
- production hardening
- service boundary and module design

Do not use this skill for pure frontend styling/motion work or database-only schema work with no application-layer design.

## Mandatory workflow

1. Infer or clarify:
   - stack
   - service type
   - database choice
   - integration method
   - real-time requirements
   - auth strategy
2. State architectural decisions before coding:
   - project structure
   - API client approach
   - auth strategy
   - real-time method
   - error-handling strategy
3. Build with the baseline checklist in mind:
   - feature-first structure
   - validated config
   - typed error handling
   - logging
   - validation
   - health endpoints
   - graceful shutdown
   - explicit CORS and security headers
4. Verify before handoff:
   - build
   - smoke test
   - frontend/backend integration
   - real-time path when relevant

## Working rules

- Prefer the simplest architecture that still matches the stated requirements.
- Do not hide business logic in controllers.
- Keep frontend/backend contracts explicit.
- Explain tradeoffs when multiple patterns are reasonable.

## Read references as needed

- `references/core-architecture.md`
  For feature structure, module boundaries, config, errors, and logging.
- `references/integration-patterns.md`
  For API clients, uploads, auth flows, real-time choices, and boundary rules.
- `references/production-hardening.md`
  For moving beyond prototype quality.
- `references/testing-strategy.md`, `references/release-checklist.md`, `references/technology-selection.md`
  For verification and launch decisions.
- `references/api-design.md`, `references/auth-flow.md`, `references/db-schema.md`, `references/environment-management.md`
  For subsystem-specific guidance.
