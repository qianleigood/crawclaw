/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderDebug, type DebugProps } from "./debug.ts";

function createProps(overrides: Partial<DebugProps> = {}): DebugProps {
  return {
    loading: false,
    status: { securityAudit: { summary: { critical: 0, warn: 1, info: 2 } } },
    health: { ok: true },
    models: [{ id: "gpt-5.4-mini" }],
    heartbeat: { ts: 123 },
    eventLog: [],
    methods: [
      "system.health",
      "system.status",
      "system.heartbeat.last",
      "channels.login.start",
      "health",
      "status",
    ],
    callMethod: "system.health",
    callParams: "{",
    callResult: null,
    callError: null,
    onCallMethodChange: () => {},
    onCallParamsChange: () => {},
    onRefresh: () => {},
    onCall: () => {},
    ...overrides,
  };
}

describe("renderDebug", () => {
  it("renders control-plane method surface and params state summary", async () => {
    const container = document.createElement("div");
    render(renderDebug(createProps()), container);
    await Promise.resolve();

    expect(container.textContent).toContain("Preferred names");
    expect(container.textContent).toContain("Legacy aliases");
    expect(container.textContent).toContain("Selected method");
    expect(container.textContent).toContain("Params state");
    expect(container.textContent).toContain("Invalid JSON");
    expect(container.textContent).toContain(
      "system.health / system.status / system.heartbeat.last / channels.login.*",
    );
  });
});
