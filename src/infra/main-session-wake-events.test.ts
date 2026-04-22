import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitMainSessionWakeEvent,
  getLastMainSessionWakeEvent,
  onMainSessionWakeEvent,
  resetMainSessionWakeEventsForTest,
  resolveIndicatorType,
} from "./main-session-wake-events.js";

type MainSessionWakeEventsModule = typeof import("./main-session-wake-events.js");

const mainSessionWakeEventsModuleUrl = new URL("./main-session-wake-events.ts", import.meta.url)
  .href;

async function importMainSessionWakeEventsModule(
  cacheBust: string,
): Promise<MainSessionWakeEventsModule> {
  return (await import(
    `${mainSessionWakeEventsModuleUrl}?t=${cacheBust}`
  )) as MainSessionWakeEventsModule;
}

describe("resolveIndicatorType", () => {
  it("maps main-session wake statuses to indicator types", () => {
    expect(resolveIndicatorType("ok-empty")).toBe("ok");
    expect(resolveIndicatorType("ok-token")).toBe("ok");
    expect(resolveIndicatorType("sent")).toBe("alert");
    expect(resolveIndicatorType("failed")).toBe("error");
    expect(resolveIndicatorType("skipped")).toBeUndefined();
  });
});

describe("main-session wake events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-09T12:00:00Z"));
  });

  afterEach(() => {
    resetMainSessionWakeEventsForTest();
    vi.useRealTimers();
  });

  it("stores the last event and timestamps emitted payloads", () => {
    emitMainSessionWakeEvent({ status: "sent", to: "+123", preview: "ping" });

    expect(getLastMainSessionWakeEvent()).toEqual({
      ts: 1767960000000,
      status: "sent",
      to: "+123",
      preview: "ping",
    });
  });

  it("delivers events to listeners, isolates listener failures, and supports unsubscribe", () => {
    const seen: string[] = [];
    const unsubscribeFirst = onMainSessionWakeEvent((evt) => {
      seen.push(`first:${evt.status}`);
    });
    onMainSessionWakeEvent(() => {
      throw new Error("boom");
    });
    const unsubscribeThird = onMainSessionWakeEvent((evt) => {
      seen.push(`third:${evt.status}`);
    });

    emitMainSessionWakeEvent({ status: "ok-empty" });
    unsubscribeFirst();
    unsubscribeThird();
    emitMainSessionWakeEvent({ status: "failed" });

    expect(seen).toEqual(["first:ok-empty", "third:ok-empty"]);
  });

  it("shares main-session wake state across duplicate module instances", async () => {
    const first = await importMainSessionWakeEventsModule(`first-${Date.now()}`);
    const second = await importMainSessionWakeEventsModule(`second-${Date.now()}`);

    first.resetMainSessionWakeEventsForTest();

    const seen: string[] = [];
    const stop = first.onMainSessionWakeEvent((evt) => {
      seen.push(evt.status);
    });

    second.emitMainSessionWakeEvent({ status: "ok-token", preview: "pong" });

    expect(first.getLastMainSessionWakeEvent()).toEqual({
      ts: 1767960000000,
      status: "ok-token",
      preview: "pong",
    });
    expect(seen).toEqual(["ok-token"]);

    stop();
    first.resetMainSessionWakeEventsForTest();
  });
});
