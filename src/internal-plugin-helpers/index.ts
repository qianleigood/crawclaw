// Shared private helper surface for repo-owned bundled plugins.
// Keep this entry intentionally tiny. Channel plugin SDK exports have been
// removed; future bundled channels should use Rust-native adapter contracts.
export type { CrawClawPluginConfigSchema, PluginLogger } from "../plugins/types.js";
export type { CrawClawConfig } from "../config/config.js";
export type { SecretInput, SecretRef } from "../config/types.secrets.js";
export type { RuntimeEnv } from "../runtime.js";
export type { HookEntry } from "../hooks/types.js";
export type { ReplyPayload } from "../chat/reply-payload.js";
export type { WizardPrompter } from "../wizard/prompts.js";
export type { DiagnosticEventPayload } from "../infra/diagnostic-events.js";
export type { ObservationContext as PluginObservationContext } from "../infra/observation/types.js";

export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export { onDiagnosticEvent } from "../infra/diagnostic-events.js";
