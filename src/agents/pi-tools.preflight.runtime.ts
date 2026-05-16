import {
  getDiagnosticSessionState,
  updateDiagnosticSessionState,
} from "../logging/diagnostic-session-state.js";
import { logToolLoopAction } from "../logging/diagnostic.js";
import { getAgentRuntimeState } from "./runtime/agent-runtime-state.js";
import {
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
} from "./tool-loop-detection.js";

export const toolCallPreflightRuntime = {
  getDiagnosticSessionState,
  updateDiagnosticSessionState,
  getAgentRuntimeState,
  logToolLoopAction,
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
};
