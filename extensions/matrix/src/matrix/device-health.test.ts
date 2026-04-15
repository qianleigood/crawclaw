import { describe, expect, it } from "vitest";
import { isCrawClawManagedMatrixDevice, summarizeMatrixDeviceHealth } from "./device-health.js";

describe("matrix device health", () => {
  it("detects CrawClaw-managed device names", () => {
    expect(isCrawClawManagedMatrixDevice("CrawClaw Gateway")).toBe(true);
    expect(isCrawClawManagedMatrixDevice("CrawClaw Debug")).toBe(true);
    expect(isCrawClawManagedMatrixDevice("Element iPhone")).toBe(false);
    expect(isCrawClawManagedMatrixDevice(null)).toBe(false);
  });

  it("summarizes stale CrawClaw-managed devices separately from the current device", () => {
    const summary = summarizeMatrixDeviceHealth([
      {
        deviceId: "du314Zpw3A",
        displayName: "CrawClaw Gateway",
        current: true,
      },
      {
        deviceId: "BritdXC6iL",
        displayName: "CrawClaw Gateway",
        current: false,
      },
      {
        deviceId: "G6NJU9cTgs",
        displayName: "CrawClaw Debug",
        current: false,
      },
      {
        deviceId: "phone123",
        displayName: "Element iPhone",
        current: false,
      },
    ]);

    expect(summary.currentDeviceId).toBe("du314Zpw3A");
    expect(summary.currentCrawClawDevices).toEqual([
      expect.objectContaining({ deviceId: "du314Zpw3A" }),
    ]);
    expect(summary.staleCrawClawDevices).toEqual([
      expect.objectContaining({ deviceId: "BritdXC6iL" }),
      expect.objectContaining({ deviceId: "G6NJU9cTgs" }),
    ]);
  });
});
