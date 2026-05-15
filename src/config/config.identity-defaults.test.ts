import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AGENT_MAX_CONCURRENT, DEFAULT_SUBAGENT_MAX_CONCURRENT } from "./agent-limits.js";
import { loadConfig, resetConfigRuntimeState } from "./config.js";
import { withTempHome } from "./home-env.test-harness.js";

describe("config identity defaults", () => {
  beforeEach(() => {
    resetConfigRuntimeState();
  });

  afterEach(() => {
    resetConfigRuntimeState();
  });

  const defaultIdentity = {
    name: "Samantha",
    theme: "helpful sloth",
    emoji: "🦥",
  };

  const configWithDefaultIdentity = (messages: Record<string, unknown>) => ({
    agents: {
      list: [
        {
          id: "main",
          identity: defaultIdentity,
        },
      ],
    },
    messages,
  });

  const writeAndLoadConfig = async (home: string, config: Record<string, unknown>) => {
    const configDir = path.join(home, ".crawclaw");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "crawclaw.json"),
      JSON.stringify(config, null, 2),
      "utf-8",
    );
    return loadConfig();
  };

  it("does not derive mention defaults and only sets ackReactionScope when identity is present", async () => {
    await withTempHome("crawclaw-config-identity-", async (home) => {
      const cfg = await writeAndLoadConfig(home, configWithDefaultIdentity({}));

      expect(cfg.messages?.responsePrefix).toBeUndefined();
      expect(cfg.messages?.groupChat?.mentionPatterns).toBeUndefined();
      expect(cfg.messages?.ackReaction).toBeUndefined();
      expect(cfg.messages?.ackReactionScope).toBe("group-mentions");
    });
  });

  it("keeps ackReaction unset and does not synthesize agent/session defaults when identity is missing", async () => {
    await withTempHome("crawclaw-config-identity-", async (home) => {
      const cfg = await writeAndLoadConfig(home, { messages: {} });

      expect(cfg.messages?.ackReaction).toBeUndefined();
      expect(cfg.messages?.ackReactionScope).toBe("group-mentions");
      expect(cfg.messages?.responsePrefix).toBeUndefined();
      expect(cfg.messages?.groupChat?.mentionPatterns).toBeUndefined();
      expect(cfg.agents?.list).toBeUndefined();
      expect(cfg.agents?.defaults?.maxConcurrent).toBe(DEFAULT_AGENT_MAX_CONCURRENT);
      expect(cfg.agents?.defaults?.subagents?.maxConcurrent).toBe(DEFAULT_SUBAGENT_MAX_CONCURRENT);
      expect(cfg.session).toBeUndefined();
    });
  });

  it("does not override explicit values", async () => {
    await withTempHome("crawclaw-config-identity-", async (home) => {
      const cfg = await writeAndLoadConfig(home, {
        agents: {
          list: [
            {
              id: "main",
              identity: {
                name: "Samantha Sloth",
                theme: "space lobster",
                emoji: "🦀",
              },
              groupChat: { mentionPatterns: ["@crawclaw"] },
            },
          ],
        },
        messages: {
          responsePrefix: "✅",
        },
      });

      expect(cfg.messages?.responsePrefix).toBe("✅");
      expect(cfg.agents?.list?.[0]?.groupChat?.mentionPatterns).toEqual(["@crawclaw"]);
    });
  });

  it("accepts blank model provider apiKey values", async () => {
    await withTempHome("crawclaw-config-identity-", async (home) => {
      const cfg = await writeAndLoadConfig(home, {
        models: {
          mode: "merge",
          providers: {
            minimax: {
              baseUrl: "https://api.minimax.io/anthropic",
              apiKey: "",
              api: "anthropic-messages",
              models: [
                {
                  id: "MiniMax-M2.7",
                  name: "MiniMax M2.7",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 200000,
                  maxTokens: 8192,
                },
              ],
            },
          },
        },
      });

      expect(cfg.models?.providers?.minimax?.baseUrl).toBe("https://api.minimax.io/anthropic");
    });
  });

  it("accepts SecretRef values in model provider headers", async () => {
    await withTempHome("crawclaw-config-identity-", async (home) => {
      const cfg = await writeAndLoadConfig(home, {
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              api: "openai-completions",
              headers: {
                Authorization: {
                  source: "env",
                  provider: "default",
                  id: "OPENAI_HEADER_TOKEN",
                },
              },
              models: [],
            },
          },
        },
      });

      expect(cfg.models?.providers?.openai?.headers?.Authorization).toEqual({
        source: "env",
        provider: "default",
        id: "OPENAI_HEADER_TOKEN",
      });
    });
  });

  it("respects empty responsePrefix to disable identity defaults", async () => {
    await withTempHome("crawclaw-config-identity-", async (home) => {
      const cfg = await writeAndLoadConfig(home, configWithDefaultIdentity({ responsePrefix: "" }));

      expect(cfg.messages?.responsePrefix).toBe("");
    });
  });
});
