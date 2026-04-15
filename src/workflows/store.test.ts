import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { loadWorkflowExecutionStore, mutateWorkflowExecutionStore } from "./store.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("workflow store mutation queue", () => {
  it("serializes execution store mutations per workflow root", async () => {
    const workspaceDir = await tempDirs.make("workflow-store-queue-");
    let resolveFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    let resolveFirstRelease: (() => void) | undefined;
    const firstRelease = new Promise<void>((resolve) => {
      resolveFirstRelease = resolve;
    });
    let firstHolding = false;
    let secondEnteredWhileFirstHolding = false;

    const firstMutation = mutateWorkflowExecutionStore({ workspaceDir }, async (store) => {
      firstHolding = true;
      resolveFirstStarted?.();
      await firstRelease;
      store.executions.push({
        executionId: "exec_first",
        workflowId: "wf_queue",
        status: "queued",
        startedAt: 1,
        updatedAt: 1,
      });
      firstHolding = false;
    });

    await firstStarted;

    const secondMutation = mutateWorkflowExecutionStore({ workspaceDir }, async (store) => {
      secondEnteredWhileFirstHolding = firstHolding;
      store.executions.push({
        executionId: "exec_second",
        workflowId: "wf_queue",
        status: "queued",
        startedAt: 2,
        updatedAt: 2,
      });
    });

    resolveFirstRelease?.();
    await Promise.all([firstMutation, secondMutation]);

    expect(secondEnteredWhileFirstHolding).toBe(false);
    const store = await loadWorkflowExecutionStore({ workspaceDir });
    expect(store.executions.map((entry) => entry.executionId).toSorted()).toEqual([
      "exec_first",
      "exec_second",
    ]);
  });
});
