import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";

const fullRuntime = vi.hoisted(() => ({
  bitableLoads: 0,
  chatLoads: 0,
  docLoads: 0,
  driveLoads: 0,
  permLoads: 0,
  subagentLoads: 0,
  wikiLoads: 0,
  registerFeishuBitableTools: vi.fn(),
  registerFeishuChatTools: vi.fn(),
  registerFeishuDocTools: vi.fn(),
  registerFeishuDriveTools: vi.fn(),
  registerFeishuPermTools: vi.fn(),
  registerFeishuSubagentHooks: vi.fn(),
  registerFeishuWikiTools: vi.fn(),
}));

vi.mock("./src/bitable.js", () => {
  fullRuntime.bitableLoads += 1;
  return {
    registerFeishuBitableTools: fullRuntime.registerFeishuBitableTools,
  };
});

vi.mock("./src/chat.js", () => {
  fullRuntime.chatLoads += 1;
  return {
    registerFeishuChatTools: fullRuntime.registerFeishuChatTools,
  };
});

vi.mock("./src/docx.js", () => {
  fullRuntime.docLoads += 1;
  return {
    registerFeishuDocTools: fullRuntime.registerFeishuDocTools,
  };
});

vi.mock("./src/drive.js", () => {
  fullRuntime.driveLoads += 1;
  return {
    registerFeishuDriveTools: fullRuntime.registerFeishuDriveTools,
  };
});

vi.mock("./src/perm.js", () => {
  fullRuntime.permLoads += 1;
  return {
    registerFeishuPermTools: fullRuntime.registerFeishuPermTools,
  };
});

vi.mock("./src/subagent-hooks.js", () => {
  fullRuntime.subagentLoads += 1;
  return {
    registerFeishuSubagentHooks: fullRuntime.registerFeishuSubagentHooks,
  };
});

vi.mock("./src/wiki.js", () => {
  fullRuntime.wikiLoads += 1;
  return {
    registerFeishuWikiTools: fullRuntime.registerFeishuWikiTools,
  };
});

function resetFullRuntimeState() {
  fullRuntime.bitableLoads = 0;
  fullRuntime.chatLoads = 0;
  fullRuntime.docLoads = 0;
  fullRuntime.driveLoads = 0;
  fullRuntime.permLoads = 0;
  fullRuntime.subagentLoads = 0;
  fullRuntime.wikiLoads = 0;
  vi.clearAllMocks();
}

async function importFeishuPlugin() {
  return (await import("./index.js")).default;
}

describe("feishu plugin", () => {
  beforeEach(() => {
    vi.resetModules();
    resetFullRuntimeState();
  });

  it("keeps full runtime modules out of setup-only registration", async () => {
    const plugin = await importFeishuPlugin();

    expect(fullRuntime.docLoads).toBe(0);
    expect(fullRuntime.chatLoads).toBe(0);
    expect(fullRuntime.wikiLoads).toBe(0);
    expect(fullRuntime.driveLoads).toBe(0);
    expect(fullRuntime.permLoads).toBe(0);
    expect(fullRuntime.bitableLoads).toBe(0);
    expect(fullRuntime.subagentLoads).toBe(0);

    const api = createTestPluginApi({
      id: "feishu",
      name: "Feishu",
      source: "test",
      config: {},
      runtime: {} as never,
      registrationMode: "setup-only",
      registerChannel: vi.fn(),
    });

    await plugin.register(api);

    expect(fullRuntime.docLoads).toBe(0);
    expect(fullRuntime.chatLoads).toBe(0);
    expect(fullRuntime.wikiLoads).toBe(0);
    expect(fullRuntime.driveLoads).toBe(0);
    expect(fullRuntime.permLoads).toBe(0);
    expect(fullRuntime.bitableLoads).toBe(0);
    expect(fullRuntime.subagentLoads).toBe(0);
    expect(fullRuntime.registerFeishuDocTools).not.toHaveBeenCalled();
    expect(fullRuntime.registerFeishuChatTools).not.toHaveBeenCalled();
    expect(fullRuntime.registerFeishuWikiTools).not.toHaveBeenCalled();
    expect(fullRuntime.registerFeishuDriveTools).not.toHaveBeenCalled();
    expect(fullRuntime.registerFeishuPermTools).not.toHaveBeenCalled();
    expect(fullRuntime.registerFeishuBitableTools).not.toHaveBeenCalled();
    expect(fullRuntime.registerFeishuSubagentHooks).not.toHaveBeenCalled();
  });

  it("loads full runtime modules only during full registration", async () => {
    const plugin = await importFeishuPlugin();
    const api = createTestPluginApi({
      id: "feishu",
      name: "Feishu",
      source: "test",
      config: {},
      runtime: {} as never,
      registrationMode: "full",
    });

    await plugin.register(api);

    expect(fullRuntime.docLoads).toBe(1);
    expect(fullRuntime.chatLoads).toBe(1);
    expect(fullRuntime.wikiLoads).toBe(1);
    expect(fullRuntime.driveLoads).toBe(1);
    expect(fullRuntime.permLoads).toBe(1);
    expect(fullRuntime.bitableLoads).toBe(1);
    expect(fullRuntime.subagentLoads).toBe(1);
    expect(fullRuntime.registerFeishuDocTools).toHaveBeenCalledWith(api);
    expect(fullRuntime.registerFeishuChatTools).toHaveBeenCalledWith(api);
    expect(fullRuntime.registerFeishuWikiTools).toHaveBeenCalledWith(api);
    expect(fullRuntime.registerFeishuDriveTools).toHaveBeenCalledWith(api);
    expect(fullRuntime.registerFeishuPermTools).toHaveBeenCalledWith(api);
    expect(fullRuntime.registerFeishuBitableTools).toHaveBeenCalledWith(api);
    expect(fullRuntime.registerFeishuSubagentHooks).toHaveBeenCalledWith(api);
  });
});
