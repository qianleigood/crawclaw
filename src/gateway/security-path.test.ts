import { describe, expect, it } from "vitest";
import {
  buildCanonicalPathCandidates,
  canonicalizePathForSecurity,
  isPathProtectedByPrefixes,
  isProtectedPluginRoutePath,
} from "./security-path.js";

function buildRepeatedEncodedSlashPath(depth: number): string {
  let encodedSlash = "%2f";
  for (let i = 1; i < depth; i++) {
    encodedSlash = encodedSlash.replace(/%/g, "%25");
  }
  return `/api${encodedSlash}private${encodedSlash}plugins${encodedSlash}default${encodedSlash}profile`;
}

const protectedPrefixes = ["/api/private/plugins"] as const;

describe("security-path canonicalization", () => {
  it("canonicalizes decoded case/slash variants", () => {
    expect(canonicalizePathForSecurity("/API/private/plugins//default/profile/")).toEqual(
      expect.objectContaining({
        canonicalPath: "/api/private/plugins/default/profile",
        candidates: ["/api/private/plugins/default/profile"],
        malformedEncoding: false,
        decodePasses: 0,
        decodePassLimitReached: false,
        rawNormalizedPath: "/api/private/plugins/default/profile",
      }),
    );
    const encoded = canonicalizePathForSecurity("/api/private/%70lugins%2Fdefault%2Fprofile");
    expect(encoded.canonicalPath).toBe("/api/private/plugins/default/profile");
    expect(encoded.candidates).toContain("/api/private/%70lugins%2fdefault%2fprofile");
    expect(encoded.candidates).toContain("/api/private/plugins/default/profile");
    expect(encoded.decodePasses).toBeGreaterThan(0);
    expect(encoded.decodePassLimitReached).toBe(false);
  });

  it("resolves traversal after repeated decoding", () => {
    expect(
      canonicalizePathForSecurity("/api/private/foo/..%2fplugins/default/profile").canonicalPath,
    ).toBe("/api/private/plugins/default/profile");
    expect(
      canonicalizePathForSecurity("/api/private/foo/%252e%252e%252fplugins/default/profile")
        .canonicalPath,
    ).toBe("/api/private/plugins/default/profile");
  });

  it("marks malformed encoding", () => {
    expect(canonicalizePathForSecurity("/api/private/plugins%2").malformedEncoding).toBe(true);
    expect(canonicalizePathForSecurity("/api/private/plugins%zz").malformedEncoding).toBe(true);
  });

  it("resolves 4x encoded slash path variants to protected plugin routes", () => {
    const deeplyEncoded = "/api%2525252fprivate%2525252fplugins%2525252fdefault%2525252fprofile";
    const canonical = canonicalizePathForSecurity(deeplyEncoded);
    expect(canonical.canonicalPath).toBe("/api/private/plugins/default/profile");
    expect(canonical.decodePasses).toBeGreaterThanOrEqual(4);
    expect(isPathProtectedByPrefixes(deeplyEncoded, protectedPrefixes)).toBe(true);
  });

  it("flags decode depth overflow and fails closed for protected prefix checks", () => {
    const excessiveDepthPath = buildRepeatedEncodedSlashPath(40);
    const candidates = buildCanonicalPathCandidates(excessiveDepthPath, 32);
    expect(candidates.decodePassLimitReached).toBe(true);
    expect(candidates.malformedEncoding).toBe(false);
    expect(isPathProtectedByPrefixes(excessiveDepthPath, protectedPrefixes)).toBe(true);
  });
});

describe("security-path protected-prefix matching", () => {
  const pluginVariants = [
    "/API/private/plugins/default/profile",
    "/api/private/plugins%2Fdefault%2Fprofile",
    "/api/private/%70lugins/default/profile",
    "/api/private/foo/..%2fplugins/default/profile",
    "/api/private/foo/%2e%2e%2fplugins/default/profile",
    "/api/private/foo/%252e%252e%252fplugins/default/profile",
    "/api%2525252fprivate%2525252fplugins%2525252fdefault%2525252fprofile",
    "/api/private/plugins%2",
    "/api/private/plugins%zz",
  ];

  for (const path of pluginVariants) {
    it(`protects plugin path variant: ${path}`, () => {
      expect(isPathProtectedByPrefixes(path, protectedPrefixes)).toBe(true);
    });
  }

  it("does not protect unrelated paths", () => {
    expect(isProtectedPluginRoutePath("/plugin/public")).toBe(false);
    expect(isProtectedPluginRoutePath("/api/private/plugins/default/profile")).toBe(false);
    expect(isPathProtectedByPrefixes("/api/private/plugins-public", protectedPrefixes)).toBe(false);
    expect(
      isPathProtectedByPrefixes("/api/private/foo/..%2fplugins-public", protectedPrefixes),
    ).toBe(false);
    expect(isPathProtectedByPrefixes("/api/private/plugin", protectedPrefixes)).toBe(false);
  });
});
