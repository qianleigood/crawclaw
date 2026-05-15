import { describe, expect, it } from "vitest";
import { definePluginEntry } from "../plugin-sdk/plugin-entry.js";
import { PLUGIN_ENTRY_TYPE_FIELD, resolvePluginModuleExport } from "./entry-contract.js";

describe("plugin entry contract", () => {
  it("marks definePluginEntry results as plugin entries", () => {
    const entry = definePluginEntry({
      id: "demo-plugin",
      name: "Demo Plugin",
      description: "demo",
      register() {},
    });

    expect(entry[PLUGIN_ENTRY_TYPE_FIELD]).toBe("plugin");
    expect(resolvePluginModuleExport(entry)).toMatchObject({
      definition: expect.objectContaining({
        id: "demo-plugin",
        name: "Demo Plugin",
      }),
      register: expect.any(Function),
    });
  });
});
