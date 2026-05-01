import { describe, expect, it } from "vitest";
import {
  buildDurableMemoryBody,
  buildDurableMemoryFrontmatterLines,
  normalizeDurableMemoryType,
} from "./common.ts";
import {
  resolveDurableMemoryIndexPath,
  resolveDurableMemoryRootDir,
  resolveDurableMemoryScope,
  resolveDurableMemoryScopeDir,
} from "./scope.ts";

function toPosixPathForAssert(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

describe("durable memory common helpers", () => {
  it("normalizes durable types", () => {
    expect(normalizeDurableMemoryType("feedback")).toBe("feedback");
    expect(normalizeDurableMemoryType("unknown")).toBeNull();
  });

  it("renders note frontmatter and body with durable metadata", () => {
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "discord",
      userId: "user-42",
    });
    const frontmatter = buildDurableMemoryFrontmatterLines({
      type: "feedback",
      title: "Step-first answers",
      summary: "Lead with steps first.",
      aliases: ["ops style"],
      tags: ["collaboration"],
    });
    const body = buildDurableMemoryBody({
      type: "feedback",
      title: "Step-first answers",
      summary: "Lead with steps first.",
      why: "The user wants actionability.",
      howToApply: "For SOP questions, present steps first.",
    });

    expect(frontmatter.join("\n")).toContain("title: Step-first answers");
    expect(frontmatter.join("\n")).toContain("type: feedback");
    expect(frontmatter.join("\n")).toContain("source: crawclaw-durable-memory");
    expect(frontmatter.join("\n")).not.toContain("durable_memory_type:");
    expect(frontmatter.join("\n")).not.toContain("memory_bucket:");
    expect(frontmatter.join("\n")).toContain("aliases:");
    expect(frontmatter.join("\n")).toContain("tags:");
    expect(body).toContain("## Summary");
    expect(body).toContain("## Why");
    expect(body).toContain("## How to apply");
    expect(scope).not.toBeNull();
    expect(toPosixPathForAssert(resolveDurableMemoryScopeDir(scope!))).toContain(
      "/durable-memory/agents/main/channels/discord/users/user-42",
    );
    expect(toPosixPathForAssert(resolveDurableMemoryIndexPath(scope!))).toContain(
      "/durable-memory/agents/main/channels/discord/users/user-42/MEMORY.md",
    );
    expect(toPosixPathForAssert(resolveDurableMemoryRootDir())).toContain("/durable-memory");
  });

  it("uses a fixed local channel id for durable memory without an external channel", () => {
    const mainSessionScope = resolveDurableMemoryScope({
      sessionKey: "agent:main:main",
    });
    expect(mainSessionScope).toMatchObject({
      agentId: "main",
      channel: "local",
      userId: "main",
      scopeKey: "main:local:main",
    });

    const fallbackScope = resolveDurableMemoryScope({
      agentId: "main",
      fallbackToLocal: true,
    });
    expect(fallbackScope).toMatchObject({
      agentId: "main",
      channel: "local",
      userId: "local",
      scopeKey: "main:local:local",
    });
  });
});
