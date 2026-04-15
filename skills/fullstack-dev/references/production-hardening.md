# Production Hardening Guide

Use this reference when the work is moving beyond a prototype.

## Minimum production checks

- health and readiness endpoints
- graceful shutdown
- explicit CORS policy
- security headers
- migration strategy
- connection pooling
- background job idempotency
- cache invalidation strategy
- release checklist

## Verification before handoff

Run and report:

1. build check
2. smoke test of key endpoints
3. frontend-backend integration check
4. real-time validation if relevant

## Common anti-patterns

- business rules in controllers
- services tightly coupled to framework HTTP types
- hardcoded base URLs
- wildcard CORS in production
- missing env validation
- no typed error hierarchy

## Read next

- `references/release-checklist.md`
- `references/testing-strategy.md`
- `references/technology-selection.md`
