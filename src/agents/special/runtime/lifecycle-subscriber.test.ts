import { describe, expect, it, vi } from "vitest";
import {
  emitRunLoopLifecycleEvent,
  resetRunLoopLifecycleHandlersForTests,
} from "../../runtime/lifecycle/bus.js";
import {
  createRunLoopLifecycleRegistration,
  createSharedLifecycleSubscriberAccessor,
} from "./lifecycle-subscriber.js";

describe("special-agent lifecycle subscriber helpers", () => {
  it("registers lifecycle handlers exactly once and disposes them cleanly", async () => {
    resetRunLoopLifecycleHandlersForTests();
    const handler = vi.fn();
    const registration = createRunLoopLifecycleRegistration({
      phases: ["stop", "post_sampling"],
      handler,
    });

    registration.ensureRegistered();
    registration.ensureRegistered();

    await emitRunLoopLifecycleEvent({
      phase: "stop",
      sessionId: "session-1",
      isTopLevel: true,
    });
    await emitRunLoopLifecycleEvent({
      phase: "post_sampling",
      sessionId: "session-1",
      isTopLevel: true,
    });
    expect(handler).toHaveBeenCalledTimes(2);

    registration.dispose();
    await emitRunLoopLifecycleEvent({
      phase: "stop",
      sessionId: "session-1",
      isTopLevel: true,
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("reuses and resets a shared lifecycle subscriber accessor", () => {
    const create = vi.fn((params: { value: number }) => ({
      reconfigure: vi.fn(),
      ensureRegistered: vi.fn(),
      dispose: vi.fn(),
      value: params.value,
    }));
    const shared = createSharedLifecycleSubscriberAccessor(create);

    const first = shared.get({ value: 1 });
    const second = shared.get({ value: 2 });

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
    expect(first.reconfigure).toHaveBeenCalledWith({ value: 2 });
    expect(first.ensureRegistered).toHaveBeenCalledTimes(2);

    shared.reset();
    expect(first.dispose).toHaveBeenCalledTimes(1);

    const third = shared.get({ value: 3 });
    expect(third).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
