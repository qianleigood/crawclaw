import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { getHookChannelError, resolveHookChannel } from "./hooks.js";

describe("hook channel metadata", () => {
  beforeEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it("resolves bundled channels without the active TS channel registry", () => {
    expect(resolveHookChannel("telegram")).toBe("telegram");
    expect(resolveHookChannel("whatsapp")).toBe("whatsapp");
    expect(getHookChannelError()).toContain("telegram");
  });
});
