# Core Architecture Guide

Use this reference when designing project structure, service boundaries, layering, configuration, and error handling.

## Preferred project structure

Default to **feature-first** organization.

```text
src/
  orders/
    order.controller.ts
    order.service.ts
    order.repository.ts
  users/
  shared/
```

Avoid layer-first structures unless the project has a compelling existing reason.

## Three-layer model

```text
Controller (HTTP) -> Service (business logic) -> Repository (data access)
```

### Responsibilities

| Layer | Owns | Must not own |
|---|---|---|
| Controller | parse request, validate input, shape response | business logic, direct DB queries |
| Service | business rules, orchestration, transactions | HTTP request/response types |
| Repository | data access, external I/O | business rules |

## Configuration

Use centralized, typed, fail-fast configuration.

Rules:

- all config from env vars
- validate required env vars at startup
- commit `.env.example`, never real secrets
- do not scatter `process.env` / env lookups across the codebase

## Error handling

Rules:

- use typed error classes
- normalize API error shape
- log every meaningful failure with context
- map technical failures to user-facing messages cleanly

## Logging / observability

- structured JSON logs
- request ID propagation
- clear log levels
- no stray `console.log` in delivered backend code

## Read next

- `references/environment-management.md`
- `references/api-design.md`
- `references/testing-strategy.md`
- `references/release-checklist.md`
