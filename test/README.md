# Test Infrastructure

This directory contains shared test infrastructure for the monorepo.

Typical contents:

- reusable fixtures
- mocks
- helper utilities
- cross-domain test support code

Guideline:

- keep small, domain-local tests next to the source they exercise
- put shared helpers and fixtures here when they are reused across multiple domains

This keeps the source tree readable while avoiding duplicated test scaffolding.
