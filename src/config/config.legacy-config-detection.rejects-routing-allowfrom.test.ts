import { describe, expect, it } from "vitest";
import { migrateLegacyConfig } from "./legacy-migrate.js";
import { validateConfigObject } from "./validation.js";

describe("legacy config detection", () => {
  it.each([
    {
      name: "routing.allowFrom",
      input: { routing: { allowFrom: ["+15555550123"] } },
      expectedPath: "",
      expectedMessage: '"routing"',
    },
    {
      name: "routing.groupChat.requireMention",
      input: { routing: { groupChat: { requireMention: false } } },
      expectedPath: "",
      expectedMessage: '"routing"',
    },
  ] as const)(
    "rejects legacy routing key: $name",
    ({ input, expectedPath, expectedMessage, name }) => {
      const res = validateConfigObject(input);
      expect(res.ok, name).toBe(false);
      if (!res.ok) {
        expect(res.issues[0]?.path, name).toBe(expectedPath);
        expect(res.issues[0]?.message, name).toContain(expectedMessage);
      }
    },
  );

  it("does not rewrite removed routing.allowFrom migrations", async () => {
    const res = migrateLegacyConfig({
      routing: { allowFrom: ["+15555550123"] },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });

  it("does not rewrite removed routing.groupChat.requireMention migrations", async () => {
    const res = migrateLegacyConfig({
      routing: { groupChat: { requireMention: false } },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
  it("does not rewrite removed routing.groupChat.mentionPatterns migrations", async () => {
    const res = migrateLegacyConfig({
      routing: { groupChat: { mentionPatterns: ["@crawclaw"] } },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
  it("does not rewrite removed routing agentToAgent/queue/transcribeAudio migrations", async () => {
    const res = migrateLegacyConfig({
      routing: {
        agentToAgent: { enabled: true, allow: ["main"] },
        queue: { mode: "queue", cap: 3 },
        transcribeAudio: {
          command: ["whisper", "--model", "base"],
          timeoutSeconds: 2,
        },
      },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
  it("does not rewrite removed audio.transcription migrations", async () => {
    const res = migrateLegacyConfig({
      audio: {
        transcription: {
          command: ["/home/user/.scripts/whisperx-transcribe.sh"],
          timeoutSeconds: 120,
        },
      },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
  it("does not rewrite removed agent config migrations", async () => {
    const res = migrateLegacyConfig({
      agent: {
        model: "openai/gpt-5.2",
        tools: { allow: ["sessions.list"], deny: ["danger"] },
        elevated: { enabled: true, allowFrom: { qqbot: ["user:1"] } },
        bash: { timeoutSec: 12 },
        subagents: { tools: { deny: ["danger"] } },
      },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
  it("does not rewrite removed memorySearch migrations", async () => {
    const res = migrateLegacyConfig({
      memorySearch: {
        provider: "local",
        fallback: "none",
        query: { maxResults: 7 },
      },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
  it("does not rewrite removed tools.bash migrations", async () => {
    const res = migrateLegacyConfig({
      tools: {
        bash: { timeoutSec: 12 },
      },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
  it("accepts per-agent tools.elevated overrides", async () => {
    const res = validateConfigObject({
      tools: {
        elevated: {
          allowFrom: { weixin: ["+15555550123"] },
        },
      },
      agents: {
        list: [
          {
            id: "work",
            workspace: "~/crawclaw-work",
            tools: {
              elevated: {
                enabled: false,
                allowFrom: { weixin: ["+15555550123"] },
              },
            },
          },
        ],
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config?.agents?.list?.[0]?.tools?.elevated).toEqual({
        enabled: false,
        allowFrom: { weixin: ["+15555550123"] },
      });
    }
  });
  it("rejects gateway.token", async () => {
    const res = validateConfigObject({
      gateway: { token: "legacy-token" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues[0]?.path).toBe("gateway");
    }
  });
  it("does not rewrite removed gateway.token migrations", async () => {
    const res = migrateLegacyConfig({
      gateway: { token: "legacy-token" },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
  it("does not rewrite valid gateway.bind tailnet", async () => {
    const res = migrateLegacyConfig({
      gateway: { bind: "tailnet" as const },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();

    const validated = validateConfigObject({ gateway: { bind: "tailnet" as const } });
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.config.gateway?.bind).toBe("tailnet");
    }
  });
  it.each(["0.0.0.0", "::", "127.0.0.1", "localhost", "::1"] as const)(
    "does not rewrite removed gateway.bind host alias: %s",
    (input) => {
      const res = migrateLegacyConfig({
        gateway: { bind: input },
      });
      expect(res.changes).toEqual([]);
      expect(res.config).toBeNull();

      const validated = validateConfigObject({ gateway: { bind: input } });
      expect(validated.ok, input).toBe(false);
      if (!validated.ok) {
        expect(
          validated.issues.some((issue) => issue.path === "gateway.bind"),
          input,
        ).toBe(true);
      }
    },
  );
  it.each(["0.0.0.0", "::", "127.0.0.1", "localhost", "::1"] as const)(
    "flags gateway.bind host alias as legacy: %s",
    (bind) => {
      const validated = validateConfigObject({ gateway: { bind } });
      expect(validated.ok, bind).toBe(false);
      if (!validated.ok) {
        expect(
          validated.issues.some((issue) => issue.path === "gateway.bind"),
          bind,
        ).toBe(true);
      }
    },
  );
  it("does not emit migration change text for control-character gateway.bind aliases", async () => {
    const res = migrateLegacyConfig({
      gateway: { bind: "\r\n0.0.0.0\r\n" },
    });
    expect(res.changes).toEqual([]);
    expect(res.config).toBeNull();
  });
});
