// Diagnostic flag/event helpers for plugins that want narrow runtime gating.

export { isDiagnosticFlagEnabled, isDiagnosticsEnabled } from "./infra-runtime.js";
export {
  recordDiagnosticChannelStreamingDecision,
  type ChannelStreamingDecisionSnapshot,
} from "../logging/diagnostic-session-state.js";
