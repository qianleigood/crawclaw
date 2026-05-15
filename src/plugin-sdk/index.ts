// Shared root plugin-sdk surface.
// Keep this entry intentionally tiny. Channel plugin SDK exports have been
// removed; future bundled channels should use Rust-native adapter contracts.
export type {
  AnyAgentTool,
  CliBackendPlugin,
  MediaUnderstandingProviderPlugin,
  CrawClawPluginApi,
  CrawClawPluginConfigSchema,
  PluginLogger,
  ProviderAuthContext,
  ProviderAuthResult,
  SpeechProviderPlugin,
} from "../plugins/types.js";
export type {
  PluginRuntime,
  RuntimeLogger,
  SubagentRunParams,
  SubagentRunResult,
} from "../plugins/runtime/types.js";
export type {
  BoundTaskFlowsRuntime,
  BoundTaskRunsRuntime,
  PluginRuntimeTaskFlows,
  PluginRuntimeTaskRuns,
  PluginRuntimeTasks,
} from "../plugins/runtime/runtime-tasks.js";
export type {
  TaskFlowDetail,
  TaskFlowView,
  TaskRunAggregateSummary,
  TaskRunCancelResult,
  TaskRunDetail,
  TaskRunView,
} from "../plugins/runtime/task-domain-types.js";
export type { CrawClawConfig } from "../config/config.js";
export type { CliBackendConfig } from "../config/types.js";
export type { SecretInput, SecretRef } from "../config/types.secrets.js";
export type { RuntimeEnv } from "../runtime.js";
export type { HookEntry } from "../hooks/types.js";
export type { ReplyPayload } from "../auto-reply/types.js";
export type { WizardPrompter } from "../wizard/prompts.js";
export type { DiagnosticEventPayload } from "../infra/diagnostic-events.js";
export type { ObservationContext as PluginObservationContext } from "../infra/observation/types.js";

export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export { onDiagnosticEvent } from "../infra/diagnostic-events.js";
