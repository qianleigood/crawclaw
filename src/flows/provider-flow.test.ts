import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveManifestProviderSetupFlowContributions,
  resolveProviderModelPickerFlowContributions,
} from "./provider-flow.js";

const resolveManifestProviderAuthChoices = vi.hoisted(() => vi.fn(() => []));

vi.mock("../plugins/provider-auth-choices.js", () => ({
  resolveManifestProviderAuthChoices,
}));

describe("provider flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds setup contributions from manifest metadata without loading provider runtime", () => {
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "sglang",
        providerId: "sglang",
        methodId: "custom",
        choiceId: "provider-plugin:sglang:custom",
        choiceLabel: "SGLang",
      },
    ] as never);

    const contributions = resolveManifestProviderSetupFlowContributions({
      config: {},
      workspaceDir: "/tmp/workspace",
      env: process.env,
    });

    expect(contributions[0]?.option.docs).toEqual({ path: "/providers/sglang" });
  });

  it("does not expose TS runtime model-picker contributions", () => {
    const contributions = resolveProviderModelPickerFlowContributions({
      config: {},
      workspaceDir: "/tmp/workspace",
      env: process.env,
    });

    expect(contributions).toEqual([]);
  });
});
