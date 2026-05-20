# Agent Runtime

The old TypeScript runtime glue has been removed. Active run state, progress,
lifecycle, and runtime context are Rust-owned in `crates/crawclaw-runtime`.
