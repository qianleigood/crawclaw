import { describe, expect, it } from "vitest";
import { CACHE_GOVERNANCE_CATEGORIES } from "./governance-types.js";
import { CACHE_GOVERNANCE_REGISTRY } from "./governance.js";

describe("CACHE_GOVERNANCE_REGISTRY", () => {
  it("keeps descriptor ids unique", () => {
    const ids = CACHE_GOVERNANCE_REGISTRY.map((descriptor) => descriptor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every documented cache category", () => {
    const categories = new Set(CACHE_GOVERNANCE_REGISTRY.map((descriptor) => descriptor.category));
    for (const category of CACHE_GOVERNANCE_CATEGORIES) {
      expect(categories.has(category)).toBe(true);
    }
  });

  it("requires owner, invalidation, and observability details for every descriptor", () => {
    for (const descriptor of CACHE_GOVERNANCE_REGISTRY) {
      expect(descriptor.owner).toBeTruthy();
      expect(descriptor.key).toBeTruthy();
      expect(descriptor.lifecycle).toBeTruthy();
      expect(descriptor.invalidation.length).toBeGreaterThan(0);
      expect(descriptor.observability.length).toBeGreaterThan(0);
    }
  });
});
