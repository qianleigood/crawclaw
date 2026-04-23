import type { ConfigUiHints } from "./schema.js";

// Keep this fixture minimal so redaction tests exercise the hint-matching
// behavior they care about without paying to build the full config schema graph.
export const redactSnapshotTestHints: ConfigUiHints = {
  "broadcast.apiToken[]": { sensitive: true },
  "env.GROQ_API_KEY": { sensitive: true },
  "gateway.auth.password": { sensitive: true },
  "models.providers.*.apiKey": { sensitive: true },
  "models.providers.*.baseUrl": { sensitive: true },
  "skills.entries.*.env.GEMINI_API_KEY": { sensitive: true },
};
