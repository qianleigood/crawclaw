import type { SubagentRunOutcome } from "./subagent-announce-output.js";

export function runOutcomesEqual(
  a: SubagentRunOutcome | undefined,
  b: SubagentRunOutcome | undefined,
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === "error" && b.status === "error") {
    return (a.error ?? "") === (b.error ?? "");
  }
  return true;
}
