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

describe("CLI translation coverage", () => {
  it("keeps the zh-CN dictionary aligned with English", () => {
    expect(Object.keys(ZH_CN_CLI_TRANSLATIONS).toSorted()).toEqual(
      Object.keys(EN_CLI_TRANSLATIONS).toSorted(),
    );
  });

  it("defines every literal production translator key", () => {
    const productionFiles = execFileSync(
      "git",
      ["ls-files", "--", "src/cli", "src/commands", "extensions"],
      {
        encoding: "utf8",
      },
    )
      .trim()
      .split("\n")
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter(
        (file) => !/(^|[./-])(test|e2e|coverage|harness|fixtures|test-helpers|mock)/.test(file),
      )
      .filter((file) => !file.includes("/node_modules/"));
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
});
