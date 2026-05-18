import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import type { PluginWebSearchProviderEntry } from "../plugins/types.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: ((code: number) => {
    throw new Error(`unexpected exit ${code}`);
  }) as RuntimeEnv["exit"],
};

const mocks = vi.hoisted(() => ({
  resolvePluginWebSearchProviders: vi.fn<
    (params?: { config?: CrawClawConfig }) => PluginWebSearchProviderEntry[]
  >(() => []),
  listBundledWebSearchProviders: vi.fn<() => PluginWebSearchProviderEntry[]>(() => []),
}));

vi.mock("../plugins/web-search-providers.runtime.js", () => ({
  resolvePluginWebSearchProviders: mocks.resolvePluginWebSearchProviders,
}));

vi.mock("../plugins/bundled-web-search.js", async () => {
  const actual = await vi.importActual<typeof import("../plugins/bundled-web-search.js")>(
    "../plugins/bundled-web-search.js",
  );
  return {
    ...actual,
    listBundledWebSearchProviders: mocks.listBundledWebSearchProviders,
  };
});

let mod: typeof import("./onboard-search.js");

function createPrompter(params: { selectValue?: string } = {}): {
  prompter: WizardPrompter;
  notes: Array<{ title?: string; message: string }>;
} {
  const notes: Array<{ title?: string; message: string }> = [];
  const prompter: WizardPrompter = {
    intro: vi.fn(async () => {}),
    outro: vi.fn(async () => {}),
    note: vi.fn(async (message: string, title?: string) => {
      notes.push({ title, message });
    }),
    select: vi.fn(
      async () => params.selectValue ?? "searxng",
    ) as unknown as WizardPrompter["select"],
    multiselect: vi.fn(async () => []) as unknown as WizardPrompter["multiselect"],
    text: vi.fn(async () => ""),
    confirm: vi.fn(async () => true),
    progress: vi.fn(() => ({
      update: vi.fn(),
      stop: vi.fn(),
    })),
  };
  return { prompter, notes };
}

function searxngBaseUrl(config: CrawClawConfig): unknown {
  return (
    config.plugins?.entries?.searxng?.config as { webSearch?: { baseUrl?: unknown } } | undefined
  )?.webSearch?.baseUrl;
}

describe("onboard-search", () => {
  beforeAll(async () => {
    mod = await import("./onboard-search.js");
  });

  it("offers only the Rust-native bundled provider by default", () => {
    expect(mod.resolveSearchProviderOptions().map((entry) => entry.id)).toEqual(["searxng"]);
  });

  it("enables searxng without prompting for an API key", async () => {
    const { prompter, notes } = createPrompter();

    const result = await mod.setupSearch({}, runtime, prompter);

    expect(result.tools?.web?.search?.provider).toBe("searxng");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(result.plugins?.entries?.searxng?.enabled).toBe(true);
    expect(prompter.text).not.toHaveBeenCalled();
    expect(notes.some((note) => note.message.includes("without an API key"))).toBe(true);
  });

  it("reads existing searxng endpoint config from the plugin-owned path", () => {
    const config: CrawClawConfig = {
      plugins: {
        entries: {
          searxng: {
            config: {
              webSearch: {
                baseUrl: "http://127.0.0.1:3210",
              },
            },
          },
        },
      },
      tools: {
        web: {
          search: {
            provider: "searxng",
          },
        },
      },
    };

    expect(mod.hasExistingKey(config, "searxng")).toBe(true);
    expect(mod.resolveExistingKey(config, "searxng")).toBe("http://127.0.0.1:3210");
  });

  it("writes searxng endpoint config to the plugin-owned path", () => {
    const result = mod.applySearchKey({}, "searxng", "http://127.0.0.1:3210");

    expect(result.tools?.web?.search?.provider).toBe("searxng");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(searxngBaseUrl(result)).toBe("http://127.0.0.1:3210");
  });
});
