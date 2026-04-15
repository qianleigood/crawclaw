# Integration Patterns Guide

Use this reference when wiring the frontend to the backend.

## API client choices

Choose one intentionally:

- typed fetch wrapper
- React Query + typed client
- tRPC
- OpenAPI-generated client

Pick based on team ownership, API stability, and boundary complexity.

## Authentication

Common choices:

- JWT + refresh token
- session auth
- OAuth / third-party auth

Rules:

- make auth middleware ordering explicit
- handle refresh transparently where appropriate
- keep token transport and storage decisions deliberate

## File uploads

Default guidance:

- presigned URL for large files
- multipart for small files

## Real-time choices

Choose intentionally:

- polling
- SSE
- WebSocket

Use the simplest thing that matches the product requirement.

## Cross-boundary errors

- convert API errors into user-facing messages
- define frontend loading / empty / error states
- do not let backend raw errors leak directly into UI

## Read next

- `references/auth-flow.md`
- `references/api-design.md`
- `references/db-schema.md`
