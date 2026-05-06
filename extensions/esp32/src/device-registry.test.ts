import { describe, expect, it, vi } from "vitest";
import { Esp32DeviceRegistry } from "./device-registry.js";

describe("Esp32DeviceRegistry", () => {
  it("sends allowlisted low-risk device tool calls over MQTT", async () => {
    const publish = vi.fn();
    const registry = new Esp32DeviceRegistry({ publish, now: () => 1_000 });
    registry.registerDevice({
      deviceId: "box-3",
      capabilities: {
        hardwareTarget: "ESP32-S3-BOX-3",
        tools: [{ name: "display.set", risk: "low" }],
      },
    });

    const pending = registry.callTool({
      deviceId: "box-3",
      toolName: "display.set",
      args: { text: "Hi" },
      allowlist: ["display.set"],
      highRiskRequiresApproval: true,
      timeoutMs: 1_000,
    });
    const requestId = publish.mock.calls[0]?.[1]?.requestId;
    registry.resolveToolResult({
      deviceId: "box-3",
      requestId,
      ok: true,
      result: { shown: true },
    });

    await expect(pending).resolves.toEqual({ ok: true, result: { shown: true } });
    expect(publish).toHaveBeenCalledWith("box-3", {
      type: "tools.call",
      requestId,
      name: "display.set",
      args: { text: "Hi" },
    });
  });

  it("rejects high-risk tools instead of silently executing them", async () => {
    const registry = new Esp32DeviceRegistry({ publish: vi.fn(), now: () => 1_000 });
    registry.registerDevice({
      deviceId: "box-3",
      capabilities: {
        hardwareTarget: "ESP32-S3-BOX-3",
        tools: [{ name: "relay.set", risk: "high" }],
      },
    });

    await expect(
      registry.callTool({
        deviceId: "box-3",
        toolName: "relay.set",
        args: { on: true },
        allowlist: ["relay.set"],
        highRiskRequiresApproval: true,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({
      ok: false,
      error: "High-risk ESP32 tool requires approval: relay.set",
    });
  });
});
