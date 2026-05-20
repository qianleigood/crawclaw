# Workflows

The old TypeScript workflow runtime has been removed. Workflow registry,
execution, status, cron, hook, and n8n integration behavior is Rust-owned in
`crates/crawclaw-runtime` and exposed through `crates/crawclaw-gateway`.
