import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import "./test-helpers/fast-core-tools.js";
import { createCrawClawTools } from "./crawclaw-tools.js";

function readToolByName() {
  return new Map(createCrawClawTools().map((tool) => [tool.name, tool]));
}

function readToolByNameWithDurableMemory() {
  return new Map(
    createCrawClawTools({
      agentChannel: "telegram",
      requesterSenderId: "user-1",
    }).map((tool) => [tool.name, tool]),
  );
}

function readToolByNameWithNotebookLmWrite() {
  return new Map(
    createCrawClawTools({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
            cli: {
              enabled: true,
              command: "nlm",
              args: ["notebook", "query", "{notebookId}", "{query}", "--json"],
              timeoutMs: 1000,
              limit: 5,
              notebookId: "nb-1",
            },
            write: {
              enabled: true,
              command: "nlm-write",
              args: ["{payloadFile}"],
              timeoutMs: 1000,
              notebookId: "nb-1",
            },
          },
        },
      } satisfies CrawClawConfig,
    }).map((tool) => [tool.name, tool]),
  );
}

describe("createCrawClawTools owner authorization", () => {
  it("marks owner-only core tools in raw registration", () => {
    const tools = readToolByName();
    expect(tools.get("cron")?.ownerOnly).toBe(true);
    expect(tools.get("gateway")?.ownerOnly).toBe(true);
    expect(tools.get("nodes")?.ownerOnly).toBe(true);
  });

  it("registers scoped memory file write as a non-owner core tool", () => {
    const tools = readToolByNameWithDurableMemory();
    expect(tools.get("memory_note_write")).toBeDefined();
    expect(tools.get("memory_note_write")?.ownerOnly).not.toBe(true);
  });

  it("registers scoped memory manifest read as a non-owner core tool", () => {
    const tools = readToolByNameWithDurableMemory();
    expect(tools.get("memory_manifest_read")).toBeDefined();
    expect(tools.get("memory_manifest_read")?.ownerOnly).not.toBe(true);
  });

  it("registers scoped memory delete as a non-owner core tool", () => {
    const tools = readToolByNameWithDurableMemory();
    expect(tools.get("memory_note_delete")).toBeDefined();
    expect(tools.get("memory_note_delete")?.ownerOnly).not.toBe(true);
  });

  it("registers experience note writing as a non-owner core tool", () => {
    const tools = readToolByNameWithNotebookLmWrite();
    expect(tools.get("write_experience_note")).toBeDefined();
    expect(tools.get("write_experience_note")?.ownerOnly).not.toBe(true);
  });

  it("keeps canvas non-owner-only in raw registration", () => {
    const tools = readToolByName();
    expect(tools.get("canvas")).toBeDefined();
    expect(tools.get("canvas")?.ownerOnly).not.toBe(true);
  });
});
