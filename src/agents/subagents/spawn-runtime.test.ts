import { describe, expect, it } from "vitest";
import { __testing } from "./spawn-runtime.js";

describe("subagent spawn runtime helpers", () => {
  it("defaults spawn mode based on thread binding intent", () => {
    expect(__testing.resolveSpawnMode({ threadRequested: false })).toBe("run");
    expect(__testing.resolveSpawnMode({ threadRequested: true })).toBe("session");
    expect(__testing.resolveSpawnMode({ requestedMode: "run", threadRequested: true })).toBe("run");
  });

  it("sanitizes mount path hints for prompt-safe values", () => {
    expect(__testing.sanitizeMountPathHint("  /workspace/uploads  ")).toBe("/workspace/uploads");
    expect(__testing.sanitizeMountPathHint("bad path")).toBeUndefined();
    expect(__testing.sanitizeMountPathHint("line\nbreak")).toBeUndefined();
  });

  it("summarizes unknown errors into stable strings", () => {
    expect(__testing.summarizeSpawnError(new Error("boom"))).toBe("boom");
    expect(__testing.summarizeSpawnError("text-error")).toBe("text-error");
    expect(__testing.summarizeSpawnError({ message: "ignored" })).toBe("error");
  });
});
