// Narrow plugin-sdk surface for the bundled diagnostics-otel plugin.
// Keep this list additive and scoped to the bundled diagnostics-otel surface.

export type { DiagnosticEventPayload } from "../infra/diagnostic-events.js";
export type { ObservationContext } from "../infra/observation/types.js";
export {
  emitDiagnosticEvent,
  isDiagnosticsEnabled,
  onDiagnosticEvent,
} from "../infra/diagnostic-events.js";
export {
  observationToAttributes,
  observationToMetricAttributes,
} from "../infra/observation/attributes.js";
export { createObservationRoot } from "../infra/observation/context.js";
export { toW3cSpanId, toW3cTraceId } from "../infra/observation/ids.js";
export { registerLogTransport } from "../logging/logger.js";
export { redactSensitiveText } from "../logging/redact.js";
export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export type {
  CrawClawPluginApi,
  CrawClawPluginService,
  CrawClawPluginServiceContext,
} from "../plugins/types.js";
