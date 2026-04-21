import { afterEach, describe, expect, it, vi } from "vitest";
import { createDoctorPrompter } from "./doctor-prompter.js";

const confirmMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@clack/prompts", () => ({
  confirm: (options: unknown) => confirmMock(options),
  isCancel: () => false,
  select: (options: unknown) => selectMock(options),
}));

function setNonInteractiveTerminal() {
  Object.defineProperty(process.stdin, "isTTY", {
    value: false,
    configurable: true,
  });
}

function createRepairPrompter(params?: { force?: boolean }) {
  setNonInteractiveTerminal();
  return createDoctorPrompter({
    runtime: {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    },
    options: {
      repair: true,
      nonInteractive: true,
      ...(params?.force ? { force: true } : {}),
    },
  });
}

describe("createDoctorPrompter", () => {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalUpdateInProgress = process.env.CRAWCLAW_UPDATE_IN_PROGRESS;
  const originalArgv = process.argv;

  afterEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      configurable: true,
    });
    if (originalUpdateInProgress === undefined) {
      delete process.env.CRAWCLAW_UPDATE_IN_PROGRESS;
    } else {
      process.env.CRAWCLAW_UPDATE_IN_PROGRESS = originalUpdateInProgress;
    }
    process.argv = originalArgv;
  });

  it("auto-accepts repairs in non-interactive fix mode", async () => {
    const prompter = createRepairPrompter();

    await expect(
      prompter.confirm({
        message: "Apply general repair?",
        initialValue: false,
      }),
    ).resolves.toBe(true);
    await expect(
      prompter.confirmAutoFix({
        message: "Repair gateway service config?",
        initialValue: false,
      }),
    ).resolves.toBe(true);
    await expect(
      prompter.confirmRuntimeRepair({
        message: "Repair launch agent bootstrap?",
        initialValue: false,
      }),
    ).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("requires --force for aggressive repairs in non-interactive fix mode", async () => {
    const prompter = createRepairPrompter();

    await expect(
      prompter.confirmAggressiveAutoFix({
        message: "Overwrite gateway service config?",
        initialValue: true,
      }),
    ).resolves.toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("keeps skip-in-non-interactive prompts disabled during update-mode repairs", async () => {
    process.env.CRAWCLAW_UPDATE_IN_PROGRESS = "1";
    const prompter = createRepairPrompter();

    await expect(
      prompter.confirmAutoFix({
        message: "Repair gateway service config?",
        initialValue: false,
      }),
    ).resolves.toBe(true);
    await expect(
      prompter.confirmRuntimeRepair({
        message: "Restart gateway service now?",
        initialValue: true,
      }),
    ).resolves.toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("auto-accepts aggressive repairs only with --force in non-interactive fix mode", async () => {
    const prompter = createRepairPrompter({ force: true });

    await expect(
      prompter.confirmAggressiveAutoFix({
        message: "Overwrite gateway service config?",
        initialValue: false,
      }),
    ).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("localizes interactive confirm controls from CLI locale", async () => {
    process.argv = ["node", "crawclaw", "--lang", "zh-CN"];
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    confirmMock.mockResolvedValueOnce(true);
    const prompter = createDoctorPrompter({
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      options: {},
    });

    await expect(
      prompter.confirm({
        message: "Apply general repair?",
        initialValue: false,
      }),
    ).resolves.toBe(true);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        active: "确认",
        inactive: "取消",
      }),
    );
  });
});
