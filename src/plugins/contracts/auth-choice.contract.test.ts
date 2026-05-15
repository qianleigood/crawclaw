import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRuntimeAuthProfileStoreSnapshots } from "../../agents/auth-profiles/store.js";
import { resolvePreferredProviderForAuthChoice } from "../../plugins/provider-auth-choice-preference.js";

describe("provider auth-choice contract", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    clearRuntimeAuthProfileStoreSnapshots();
  });

  it("does not load TS provider runtime for preferred-provider fallback", async () => {
    await expect(resolvePreferredProviderForAuthChoice({ choice: "unknown" })).resolves.toBe(
      undefined,
    );
  });
});
