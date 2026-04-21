import { describe, expect, it } from "vitest";
import { createCliTranslator, parseCliLocaleFlag, resolveCliLocale } from "./index.js";

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
