import { formatConfigIssueLines } from "../../../config/issue-format.js";
import { stripUnknownConfigKeys } from "../../doctor-config-analysis.js";
import type { DoctorConfigPreflightResult } from "../../doctor-config-preflight.js";
import type { DoctorConfigMutationState } from "./config-mutation-state.js";

export function applyLegacyCompatibilityStep(params: {
  snapshot: DoctorConfigPreflightResult["snapshot"];
  state: DoctorConfigMutationState;
  shouldRepair: boolean;
  doctorFixCommand: string;
}): {
  state: DoctorConfigMutationState;
  issueLines: string[];
  changeLines: string[];
} {
  if (params.snapshot.legacyIssues.length === 0) {
    return {
      state: params.state,
      issueLines: [],
      changeLines: [],
    };
  }

  const issueLines = formatConfigIssueLines(params.snapshot.legacyIssues, "-");
  return {
    state: {
      ...params.state,
      fixHints: [
        ...params.state.fixHints,
        params.shouldRepair
          ? "Removed legacy config paths require manual edits; doctor --fix will not rewrite them."
          : `Review the reported config paths, update them manually, then rerun "${params.doctorFixCommand}".`,
      ],
    },
    issueLines,
    changeLines: [],
  };
}

export function applyUnknownConfigKeyStep(params: {
  state: DoctorConfigMutationState;
  shouldRepair: boolean;
  doctorFixCommand: string;
}): {
  state: DoctorConfigMutationState;
  removed: string[];
} {
  const unknown = stripUnknownConfigKeys(params.state.candidate);
  if (unknown.removed.length === 0) {
    return { state: params.state, removed: [] };
  }

  return {
    state: {
      cfg: params.shouldRepair ? unknown.config : params.state.cfg,
      candidate: unknown.config,
      pendingChanges: true,
      fixHints: params.shouldRepair
        ? params.state.fixHints
        : [...params.state.fixHints, `Run "${params.doctorFixCommand}" to remove these keys.`],
    },
    removed: unknown.removed,
  };
}
