import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  resolveCrawClawMetadata,
  resolveHookInvocationPolicy,
} from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses single-line key-value pairs", () => {
    const content = `---
name: test-hook
description: "A test hook"
homepage: https://example.com
---

# Test Hook
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("test-hook");
    expect(result.description).toBe("A test hook");
    expect(result.homepage).toBe("https://example.com");
  });

  it("handles missing frontmatter", () => {
    const content = "# Just a markdown file";
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it("handles unclosed frontmatter", () => {
    const content = `---
name: broken
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it("parses multi-line metadata block with indented JSON", () => {
    const content = `---
name: command-logger
description: "Log command events"
metadata:
  {
    "crawclaw": {
      "emoji": "📝",
      "events": ["command"]
    }
  }
---

# Command Logger Hook
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("command-logger");
    expect(result.description).toBe("Log command events");
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata).toBe("string");

    // Verify the metadata is valid JSON
    const parsed = JSON.parse(result.metadata);
    expect(parsed.crawclaw.emoji).toBe("📝");
    expect(parsed.crawclaw.events).toEqual(["command"]);
  });

  it("parses multi-line metadata with complex nested structure", () => {
    const content = `---
name: command-logger
description: "Log all command events"
metadata:
  {
    "crawclaw":
      {
        "emoji": "📝",
        "events": ["command"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled" }]
      }
  }
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("command-logger");
    expect(result.metadata).toBeDefined();

    const parsed = JSON.parse(result.metadata);
    expect(parsed.crawclaw.emoji).toBe("📝");
    expect(parsed.crawclaw.events).toEqual(["command"]);
    expect(parsed.crawclaw.requires.config).toEqual(["workspace.dir"]);
    expect(parsed.crawclaw.install[0].kind).toBe("bundled");
  });

  it("handles single-line metadata (inline JSON)", () => {
    const content = `---
name: simple-hook
metadata: {"crawclaw": {"events": ["test"]}}
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("simple-hook");
    expect(result.metadata).toBe('{"crawclaw": {"events": ["test"]}}');
  });

  it("handles mixed single-line and multi-line values", () => {
    const content = `---
name: mixed-hook
description: "A hook with mixed values"
homepage: https://example.com
metadata:
  {
    "crawclaw": {
      "events": ["command:new"]
    }
  }
enabled: true
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("mixed-hook");
    expect(result.description).toBe("A hook with mixed values");
    expect(result.homepage).toBe("https://example.com");
    expect(result.metadata).toBeDefined();
    expect(result.enabled).toBe("true");
  });

  it("strips surrounding quotes from values", () => {
    const content = `---
name: "quoted-name"
description: 'single-quoted'
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("quoted-name");
    expect(result.description).toBe("single-quoted");
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\nname: test\r\ndescription: crlf\r\n---\r\n";
    const result = parseFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result.description).toBe("crlf");
  });

  it("handles CR line endings", () => {
    const content = "---\rname: test\rdescription: cr\r---\r";
    const result = parseFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result.description).toBe("cr");
  });
});

describe("resolveCrawClawMetadata", () => {
  it("extracts crawclaw metadata from parsed frontmatter", () => {
    const frontmatter = {
      name: "test-hook",
      metadata: JSON.stringify({
        crawclaw: {
          emoji: "🔥",
          events: ["command:new", "command:stop"],
          requires: {
            config: ["workspace.dir"],
            bins: ["git"],
          },
        },
      }),
    };

    const result = resolveCrawClawMetadata(frontmatter);
    expect(result).toBeDefined();
    expect(result?.emoji).toBe("🔥");
    expect(result?.events).toEqual(["command:new", "command:stop"]);
    expect(result?.requires?.config).toEqual(["workspace.dir"]);
    expect(result?.requires?.bins).toEqual(["git"]);
  });

  it("returns undefined when metadata is missing", () => {
    const frontmatter = { name: "no-metadata" };
    const result = resolveCrawClawMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("returns undefined when crawclaw key is missing", () => {
    const frontmatter = {
      metadata: JSON.stringify({ other: "data" }),
    };
    const result = resolveCrawClawMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const frontmatter = {
      metadata: "not valid json {",
    };
    const result = resolveCrawClawMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("handles install specs", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        crawclaw: {
          events: ["command"],
          install: [
            { id: "bundled", kind: "bundled", label: "Bundled with CrawClaw" },
            { id: "npm", kind: "npm", package: "@crawclaw/hook" },
          ],
        },
      }),
    };

    const result = resolveCrawClawMetadata(frontmatter);
    expect(result?.install).toHaveLength(2);
    expect(result?.install?.[0].kind).toBe("bundled");
    expect(result?.install?.[1].kind).toBe("npm");
    expect(result?.install?.[1].package).toBe("@crawclaw/hook");
  });

  it("handles platform restrictions", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        crawclaw: {
          events: ["command"],
          os: ["darwin", "linux"],
          arch: ["arm64"],
        },
      }),
    };

    const result = resolveCrawClawMetadata(frontmatter);
    expect(result?.os).toEqual(["darwin", "linux"]);
    expect(result?.arch).toEqual(["arm64"]);
  });

  it("parses real command-logger HOOK.md format", () => {
    // This is the actual format used in the bundled hooks
    const content = `---
name: command-logger
description: "Log all command events to a centralized audit file"
homepage: https://docs.crawclaw.ai/automation/hooks#command-logger
metadata:
  {
    "crawclaw":
      {
        "emoji": "📝",
        "events": ["command"],
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with CrawClaw" }],
      },
  }
---

# Command Logger Hook
`;

    const frontmatter = parseFrontmatter(content);
    expect(frontmatter.name).toBe("command-logger");
    expect(frontmatter.metadata).toBeDefined();

    const crawclaw = resolveCrawClawMetadata(frontmatter);
    expect(crawclaw).toBeDefined();
    expect(crawclaw?.emoji).toBe("📝");
    expect(crawclaw?.events).toEqual(["command"]);
    expect(crawclaw?.install?.[0].kind).toBe("bundled");
  });

  it("parses YAML metadata map", () => {
    const content = `---
name: yaml-metadata
metadata:
  crawclaw:
    emoji: disk
    events:
      - command:new
---
`;
    const frontmatter = parseFrontmatter(content);
    const crawclaw = resolveCrawClawMetadata(frontmatter);
    expect(crawclaw?.emoji).toBe("disk");
    expect(crawclaw?.events).toEqual(["command:new"]);
  });
});

describe("resolveHookInvocationPolicy", () => {
  it("defaults to enabled when missing", () => {
    expect(resolveHookInvocationPolicy({}).enabled).toBe(true);
  });

  it("parses enabled flag", () => {
    expect(resolveHookInvocationPolicy({ enabled: "no" }).enabled).toBe(false);
    expect(resolveHookInvocationPolicy({ enabled: "on" }).enabled).toBe(true);
  });
});
