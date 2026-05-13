import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";

const mocks = vi.hoisted(() => ({
  callGatewayLeastPrivilege: vi.fn(),
  resolveRuntimePluginRegistry: vi.fn(),
}));

vi.mock("../../channels/plugins/bundled-runtime-policy.js", () => ({
  shouldAllowBundledTsChannelRuntime: () => false,
}));

vi.mock("../../plugins/bundled-plugin-metadata.js", () => ({
  listBundledPluginMetadata: () => [
    {
      manifest: {
        channels: ["feishu"],
      },
    },
  ],
}));

vi.mock("../../gateway/call.js", () => ({
  callGatewayLeastPrivilege: mocks.callGatewayLeastPrivilege,
  randomIdempotencyKey: () => "native-action-id",
}));

vi.mock("../../plugins/loader.js", () => ({
  resolveRuntimePluginRegistry: mocks.resolveRuntimePluginRegistry,
}));

import { runMessageAction } from "./message-action-runner.js";

describe("runMessageAction native channel actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callGatewayLeastPrivilege.mockResolvedValue({
      ok: true,
      implementation: "rust-native",
      messageId: "native-action-1",
    });
  });

  it("routes bundled custom actions through Rust gateway without loading TS channel plugins", async () => {
    const result = await runMessageAction({
      cfg: {
        channels: {
          feishu: {
            enabled: true,
          },
        },
      } as CrawClawConfig,
      action: "pin",
      params: {
        channel: "feishu",
        messageId: "om_123",
      },
      dryRun: false,
    });

    expect(mocks.resolveRuntimePluginRegistry).not.toHaveBeenCalled();
    expect(mocks.callGatewayLeastPrivilege).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "channel.outbound.action",
        params: expect.objectContaining({
          channel: "feishu",
          action: "pin",
          to: "om_123",
          idempotencyKey: "native-action-id",
          payload: expect.objectContaining({
            messageId: "om_123",
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      kind: "action",
      channel: "feishu",
      action: "pin",
      handledBy: "core",
      payload: {
        ok: true,
        implementation: "rust-native",
      },
      dryRun: false,
    });
  });
});
