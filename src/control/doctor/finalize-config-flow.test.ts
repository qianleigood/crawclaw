import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeDoctorConfigFlow } from "./finalize-config-flow.js";

describe("doctor finalize config flow", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("writes the candidate when preview changes are confirmed", async () => {
    const note = vi.fn();
    const result = await finalizeDoctorConfigFlow({
      cfg: { channels: {} },
      candidate: { channels: { signal: { enabled: true } } },
      pendingChanges: true,
      shouldRepair: false,
      fixHints: ['Run "crawclaw doctor --fix" to apply these changes.'],
      confirm: async () => true,
      note,
    });

    expect(result).toEqual({
      cfg: { channels: { signal: { enabled: true } } },
      shouldWriteConfig: true,
    });
    expect(note).not.toHaveBeenCalled();
  });

  it("emits fix hints when preview changes are declined", async () => {
    const note = vi.fn();
    const result = await finalizeDoctorConfigFlow({
      cfg: { channels: {} },
      candidate: { channels: { signal: { enabled: true } } },
      pendingChanges: true,
      shouldRepair: false,
      fixHints: ['Run "crawclaw doctor --fix" to apply these changes.'],
      confirm: async () => false,
      note,
    });

    expect(result).toEqual({
      cfg: { channels: {} },
      shouldWriteConfig: false,
    });
    expect(note).toHaveBeenCalledWith(
      'Run "crawclaw doctor --fix" to apply these changes.',
      "Doctor",
    );
  });

  it("writes automatically in repair mode when changes exist", async () => {
    const result = await finalizeDoctorConfigFlow({
      cfg: { channels: { signal: { enabled: true } } },
      candidate: { channels: { signal: { enabled: false } } },
      pendingChanges: true,
      shouldRepair: true,
      fixHints: [],
      confirm: async () => true,
      note: vi.fn(),
    });

    expect(result).toEqual({
      cfg: { channels: { signal: { enabled: true } } },
      shouldWriteConfig: true,
    });
  });

  it("localizes the apply prompt when --lang zh-CN is present", async () => {
    process.argv = ["node", "crawclaw", "--lang", "zh-CN"];
    const confirm = vi.fn(async () => true);

    await finalizeDoctorConfigFlow({
      cfg: { channels: {} },
      candidate: { channels: { signal: { enabled: true } } },
      pendingChanges: true,
      shouldRepair: false,
      fixHints: [],
      confirm,
      note: vi.fn(),
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "现在应用推荐的配置修复吗？" }),
    );
  });
});
