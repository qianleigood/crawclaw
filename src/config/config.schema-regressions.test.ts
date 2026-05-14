import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("config schema regressions", () => {
  it("rejects removed memorySearch config", () => {
    const res = validateConfigObject({
      agents: {
        defaults: {
          memorySearch: {
            fallback: "voyage",
          },
        },
      },
    });

    expect(res.ok).toBe(false);
  });

  it("rejects removed QMD memory backend config", () => {
    const backend = validateConfigObject({
      memory: {
        backend: "qmd",
      },
    });
    const qmd = validateConfigObject({
      memory: {
        qmd: {
          searchMode: "vsearch",
        },
      },
    });

    expect(backend.ok).toBe(false);
    expect(qmd.ok).toBe(false);
  });

  it("rejects removed NotebookLM autoRefresh config", () => {
    const res = validateConfigObject({
      memory: {
        notebooklm: {
          auth: {
            autoRefresh: true,
          },
        },
      },
    });

    expect(res.ok).toBe(false);
  });

  it("accepts string values for agents defaults model inputs", () => {
    const res = validateConfigObject({
      agents: {
        defaults: {
          model: "anthropic/claude-opus-4-6",
          imageModel: "openai/gpt-4.1-mini",
        },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("accepts pdf default model and limits", () => {
    const res = validateConfigObject({
      agents: {
        defaults: {
          pdfModel: {
            primary: "anthropic/claude-opus-4-6",
            fallbacks: ["openai/gpt-5-mini"],
          },
          pdfMaxBytesMb: 12,
          pdfMaxPages: 25,
        },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("rejects non-positive pdf limits", () => {
    const res = validateConfigObject({
      agents: {
        defaults: {
          pdfModel: { primary: "openai/gpt-5-mini" },
          pdfMaxBytesMb: 0,
          pdfMaxPages: 0,
        },
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.some((issue) => issue.path.includes("agents.defaults.pdfMax"))).toBe(true);
    }
  });

  it("accepts browser.extraArgs for proxy and custom flags", () => {
    const res = validateConfigObject({
      browser: {
        extraArgs: ["--proxy-server=http://127.0.0.1:7890"],
      },
    });

    expect(res.ok).toBe(true);
  });

  it("accepts agent-browser as the browser provider", () => {
    const res = validateConfigObject({
      browser: {
        provider: "agent-browser",
      },
    });

    expect(res.ok).toBe(true);
  });

  it("rejects browser.extraArgs with non-array value", () => {
    const res = validateConfigObject({
      browser: {
        extraArgs: "--proxy-server=http://127.0.0.1:7890" as unknown,
      },
    });

    expect(res.ok).toBe(false);
  });

  it("accepts discovery.wideArea.domain for unicast DNS-SD", () => {
    const res = validateConfigObject({
      discovery: {
        wideArea: {
          enabled: true,
          domain: "crawclaw.internal",
        },
      },
    });

    expect(res.ok).toBe(true);
  });
});
