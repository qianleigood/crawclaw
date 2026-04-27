import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { EN_CLI_TRANSLATIONS } from "./en.js";
import {
  createCliTranslator,
  getActiveCliLocale,
  parseCliLocaleFlag,
  resolveCliLocale,
  setActiveCliLocale,
  translateCliText,
} from "./index.js";
import { ZH_CN_CLI_TRANSLATIONS } from "./zh-CN.js";

function listTrackedTsFiles(paths: string[]): string[] {
  return execFileSync("git", ["ls-files", "--", ...paths], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !/(^|[./-])(test|e2e|coverage|harness|fixtures|test-helpers|mock)/.test(file))
    .filter((file) => !file.includes("/node_modules/"));
}

function isCliVisibleTechnicalLiteral(value: string): boolean {
  const trimmed = value.trim();
  const exactTechnical = new Set([
    "/Applications/CrawClaw.app",
    "~/.crawclaw",
    "--custom-base-url/--custom-model-id/--custom-api-key",
    "Auth profiles",
    "Beta",
    "Daemon",
    "Fallbacks",
    "Gateway daemon",
    "Gateway runtime",
    "Git main",
    "Image fallbacks",
    "Node daemon runtime",
    "OAuth TLS",
    "Profile id",
    "Provider id",
    "Sandbox",
    "Token",
    "Token provider",
    "bun",
    "custom",
    "e.g. llama3, claude-3-7-sonnet",
    "e.g. local, ollama",
    "launchd / systemd / schtasks",
    "live",
    "macOS app",
    "nlm",
    "nick@example.com,admin@company.com",
    "npm",
    "pnpm",
    "provider/model, other-provider/model",
    "systemd linger",
    "x-forwarded-proto,x-forwarded-host",
    "x-forwarded-user",
  ]);
  return (
    trimmed.length === 0 ||
    exactTechnical.has(trimmed) ||
    trimmed.includes("${") ||
    trimmed.startsWith("[") ||
    /^[A-Z0-9_./:@<>{}[\]|=-]+$/.test(trimmed) ||
    /^https?:\/\//.test(trimmed) ||
    /^crawclaw(\s|$)/.test(trimmed) ||
    /^--?[a-z0-9-]+(?:\s|$)/i.test(trimmed) ||
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(trimmed) ||
    /^(true|false|null|undefined|json|text|auto|none)$/i.test(trimmed)
  );
}

function extractVisibleLiterals(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const literals = new Set<string>();
  const literalPatterns = [
    /\b(?:message|title|label|hint|placeholder|emptyMessage|clearedMessage)\s*:\s*([`'"])([^`'"]*[A-Za-z][^`'"]*)\1/g,
    /\b(?:runtime\.(?:log|error|warn)|console\.(?:log|error|warn)|process\.(?:stdout|stderr)\.write|logger\.(?:info|warn|error)|writeStdoutLine)\s*\(\s*([`'"])([^`'"]*[A-Za-z][^`'"]*)\1/g,
    /\b(?:addSystem|setMessage)\s*\(\s*([`'"])([^`'"]*[A-Za-z][^`'"]*)\1/g,
  ];
  for (const pattern of literalPatterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[2];
      if (value && !isCliVisibleTechnicalLiteral(value)) {
        literals.add(value);
      }
    }
  }
  return [...literals];
}

describe("parseCliLocaleFlag", () => {
  it("reads --lang <value>", () => {
    expect(parseCliLocaleFlag(["node", "crawclaw", "--lang", "zh-CN"])).toBe("zh-CN");
  });

  it("reads --lang=<value>", () => {
    expect(parseCliLocaleFlag(["node", "crawclaw", "--lang=en"])).toBe("en");
  });
});

describe("resolveCliLocale", () => {
  it("prefers --lang over config and env", () => {
    expect(
      resolveCliLocale({
        argv: ["node", "crawclaw", "--lang", "zh-CN"],
        config: "en",
        env: "en",
      }),
    ).toBe("zh-CN");
  });

  it("falls back to config then env then en", () => {
    expect(resolveCliLocale({ argv: [], config: "zh-CN", env: "en" })).toBe("zh-CN");
    expect(resolveCliLocale({ argv: [], config: undefined, env: "zh-CN" })).toBe("zh-CN");
    expect(resolveCliLocale({ argv: [], config: "fr", env: "de" })).toBe("en");
  });

  it("uses the system locale when no explicit CLI locale is configured", () => {
    expect(resolveCliLocale({ argv: [], systemEnv: "zh_CN.UTF-8" })).toBe("zh-CN");
    expect(resolveCliLocale({ argv: [], systemEnv: "zh-Hans-CN" })).toBe("zh-CN");
    expect(resolveCliLocale({ argv: [], systemEnv: ["C.UTF-8", "zh_CN.UTF-8"] })).toBe("zh-CN");
    expect(resolveCliLocale({ argv: [], env: "en", systemEnv: "zh_CN.UTF-8" })).toBe("en");
    expect(resolveCliLocale({ argv: [], config: "zh-CN", systemEnv: "en_US.UTF-8" })).toBe("zh-CN");
  });
});

describe("createCliTranslator", () => {
  it("returns zh-CN copy when locale is zh-CN", () => {
    const t = createCliTranslator("zh-CN");
    expect(t("common.confirm")).toBe("确认");
  });

  it("falls back to english when a zh-CN key is missing", () => {
    const t = createCliTranslator("zh-CN");
    expect(t("unknown.key")).toBe("unknown.key");
    expect(t("common.cancel")).toBe("取消");
  });
});

describe("active CLI text translation", () => {
  it("tracks the active locale for shared CLI prompt surfaces", () => {
    setActiveCliLocale("zh-CN");
    expect(getActiveCliLocale()).toBe("zh-CN");
    setActiveCliLocale("en");
    expect(getActiveCliLocale()).toBe("en");
  });

  it("translates exact English CLI copy through the active dictionary", () => {
    expect(translateCliText("zh-CN", "Gateway port")).toBe("网关端口");
    expect(translateCliText("zh-CN", "Unknown prompt")).toBe("Unknown prompt");
    expect(translateCliText("en", "Gateway port")).toBe("Gateway port");
  });
});

describe("shared CLI/TUI translation catalog", () => {
  it("serves TUI copy from the CLI dictionaries", () => {
    expect(createCliTranslator("en")("tui.message.runAborted")).toBe("run aborted");
    expect(createCliTranslator("zh-CN")("tui.message.runAborted")).toBe("运行已中止");
  });

  it("does not keep the old TUI locale wrapper", () => {
    expect(fs.existsSync("src/tui/tui-i18n.ts")).toBe(false);
  });

  it("defines every literal TUI translation key in the shared dictionaries", () => {
    const productionFiles = listTrackedTsFiles(["src/tui"]);
    const usedKeys = new Set<string>();
    for (const file of productionFiles) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/translateTuiText\(\s*([`'"])([^`'"]+)\1/g)) {
        usedKeys.add(match[2]);
      }
    }

    const englishKeys = new Set(Object.keys(EN_CLI_TRANSLATIONS));
    const zhKeys = new Set(Object.keys(ZH_CN_CLI_TRANSLATIONS));
    const missing = [...usedKeys]
      .filter((key) => !englishKeys.has(key) || !zhKeys.has(key))
      .toSorted();

    expect(missing).toEqual([]);
  });
});

describe("CLI translation coverage", () => {
  it("keeps the zh-CN dictionary aligned with English", () => {
    expect(Object.keys(ZH_CN_CLI_TRANSLATIONS).toSorted()).toEqual(
      Object.keys(EN_CLI_TRANSLATIONS).toSorted(),
    );
  });

  it("defines every literal production translator key", () => {
    const productionFiles = listTrackedTsFiles(["src/cli", "src/commands", "extensions"]);
    const usedKeys = new Set<string>();
    for (const file of productionFiles) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /(?<![\w$])(?:(?:ctx|params)\.)?t\(\s*([`'"])([^`'"]+)\1/g,
      )) {
        usedKeys.add(match[2]);
      }
    }

    const englishKeys = new Set(Object.keys(EN_CLI_TRANSLATIONS));
    const zhKeys = new Set(Object.keys(ZH_CN_CLI_TRANSLATIONS));
    const missing = [...usedKeys]
      .filter((key) => !englishKeys.has(key) || !zhKeys.has(key))
      .toSorted();

    expect(missing).toEqual([]);
  });

  it("has zh-CN copy for literal CLI-visible English text", () => {
    const productionFiles = listTrackedTsFiles([
      "src/cli",
      "src/commands",
      "src/wizard",
      "src/flows",
      "src/terminal",
      "extensions",
    ]).filter((file) => !file.startsWith("extensions/") || file.endsWith("/src/cli.ts"));
    const untranslated = new Set<string>();
    for (const file of productionFiles) {
      for (const literal of extractVisibleLiterals(file)) {
        const translated = translateCliText("zh-CN", literal);
        if (translated === literal) {
          untranslated.add(`${file}: ${literal}`);
        }
      }
    }

    expect([...untranslated].toSorted()).toEqual([]);
  });

  it("has zh-CN copy for literal TUI-visible English text", () => {
    const productionFiles = listTrackedTsFiles(["src/tui"]);
    const untranslated = new Set<string>();
    for (const file of productionFiles) {
      for (const literal of extractVisibleLiterals(file)) {
        const translated = translateCliText("zh-CN", literal);
        if (translated === literal) {
          untranslated.add(`${file}: ${literal}`);
        }
      }
    }

    expect([...untranslated].toSorted()).toEqual([]);
  });
});
