import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearCachedContextTokens,
  getModelContextTokenCacheMeta,
  lookupCachedContextTokens,
  MODEL_CONTEXT_TOKEN_CACHE,
  MODEL_CONTEXT_TOKEN_CACHE_DESCRIPTOR,
} from "./context-cache.js";

describe("context-cache", () => {
  beforeEach(() => {
    clearCachedContextTokens();
  });

  afterEach(() => {
    clearCachedContextTokens();
  });

  it("clears one model or the whole cache explicitly", () => {
    MODEL_CONTEXT_TOKEN_CACHE.set("openai/gpt-5.4", 123);
    MODEL_CONTEXT_TOKEN_CACHE.set("anthropic/claude-sonnet-4-6", 456);

    clearCachedContextTokens("openai/gpt-5.4");
    expect(lookupCachedContextTokens("openai/gpt-5.4")).toBeUndefined();
    expect(lookupCachedContextTokens("anthropic/claude-sonnet-4-6")).toBe(456);

    clearCachedContextTokens();
    expect(getModelContextTokenCacheMeta()).toEqual({ size: 0 });
  });

  it("publishes explicit governance metadata", () => {
    expect(MODEL_CONTEXT_TOKEN_CACHE_DESCRIPTOR.category).toBe("runtime_ttl");
    expect(MODEL_CONTEXT_TOKEN_CACHE_DESCRIPTOR.owner).toContain("context-window");
    expect(MODEL_CONTEXT_TOKEN_CACHE_DESCRIPTOR.invalidation).toContain(
      "clearCachedContextTokens() clears the whole cache",
    );
  });
});
