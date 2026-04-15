import { describe, expect, it } from "vitest";
import { parseMarkdownFrontmatter } from "./frontmatter.ts";

describe("parseMarkdownFrontmatter", () => {
  it("parses YAML-style frontmatter into a generic map", () => {
    const parsed = parseMarkdownFrontmatter(`---
title: Durable note
tags: ["alpha", "beta"]
count: 2
enabled: true
---

## Summary

hello world
`);

    expect(parsed.frontmatter).toEqual({
      title: "Durable note",
      tags: ["alpha", "beta"],
      count: 2,
      enabled: true,
    });
    expect(parsed.body).toContain("## Summary");
  });
});
