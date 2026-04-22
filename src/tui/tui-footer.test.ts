import { describe, expect, it } from "vitest";
import { formatTuiFooter, TUI_FOOTER_HINT } from "./tui-footer.js";

describe("tui footer model", () => {
  it("keeps a restrained discovery hint in the footer", () => {
    expect(TUI_FOOTER_HINT).toContain("Ctrl+P");
    expect(TUI_FOOTER_HINT).toContain("Ctrl+O");
    expect(TUI_FOOTER_HINT).toContain("/help");
  });

  it("formats session and agent labels before rendering the footer", () => {
    const line = formatTuiFooter({
      currentAgentId: "main",
      currentSessionKey: "agent:main:main",
      sessionInfo: {
        displayName: "Daily Ops",
        model: "gpt-5.4",
        modelProvider: "openai",
        totalTokens: 12_345,
        contextTokens: 200_000,
      },
      deliverEnabled: true,
      formatAgentLabel: (agentId) => `${agentId} (Main Agent)`,
      formatSessionKey: (sessionKey) => sessionKey.replace("agent:main:", ""),
    });

    expect(line).toBe(
      "agent main (Main Agent) | session main (Daily Ops) | openai/gpt-5.4 | deliver on | tokens 12k/200k (6%) | Ctrl+P sessions; Ctrl+O tools; /help",
    );
  });
});
