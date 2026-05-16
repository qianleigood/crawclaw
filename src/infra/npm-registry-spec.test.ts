import { describe, expect, it } from "vitest";
import {
  formatPrereleaseResolutionError,
  isExactSemverVersion,
  isPrereleaseSemverVersion,
  isPrereleaseResolutionAllowed,
  parseRegistryNpmSpec,
  validateRegistryNpmSpec,
} from "./npm-registry-spec.js";

function parseSpecOrThrow(spec: string) {
  const parsed = parseRegistryNpmSpec(spec);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe("npm registry spec validation", () => {
  it.each([
    "@crawclaw/demo-plugin",
    "@crawclaw/demo-plugin@1.2.3",
    "@crawclaw/demo-plugin@1.2.3-beta.4",
    "@crawclaw/demo-plugin@latest",
    "@crawclaw/demo-plugin@beta",
  ])("accepts %s", (spec) => {
    expect(validateRegistryNpmSpec(spec)).toBeNull();
  });

  it.each([
    {
      spec: "@crawclaw/demo-plugin@^1.2.3",
      expected: "exact version or dist-tag",
    },
    {
      spec: "@crawclaw/demo-plugin@~1.2.3",
      expected: "exact version or dist-tag",
    },
    {
      spec: "https://npmjs.org/pkg.tgz",
      expected: "URLs are not allowed",
    },
    {
      spec: "git+ssh://github.com/qianleigood/crawclaw",
      expected: "URLs are not allowed",
    },
    {
      spec: "@crawclaw/demo-plugin@",
      expected: "missing version/tag after @",
    },
    {
      spec: "@crawclaw/demo-plugin@../beta",
      expected: "invalid version/tag",
    },
  ])("rejects %s", ({ spec, expected }) => {
    expect(validateRegistryNpmSpec(spec)).toContain(expected);
  });
});

describe("npm registry spec parsing helpers", () => {
  it.each([
    {
      spec: "@crawclaw/demo-plugin",
      expected: {
        name: "@crawclaw/demo-plugin",
        raw: "@crawclaw/demo-plugin",
        selectorKind: "none",
        selectorIsPrerelease: false,
      },
    },
    {
      spec: "@crawclaw/demo-plugin@beta",
      expected: {
        name: "@crawclaw/demo-plugin",
        raw: "@crawclaw/demo-plugin@beta",
        selector: "beta",
        selectorKind: "tag",
        selectorIsPrerelease: false,
      },
    },
    {
      spec: "@crawclaw/demo-plugin@1.2.3-beta.1",
      expected: {
        name: "@crawclaw/demo-plugin",
        raw: "@crawclaw/demo-plugin@1.2.3-beta.1",
        selector: "1.2.3-beta.1",
        selectorKind: "exact-version",
        selectorIsPrerelease: true,
      },
    },
  ])("parses %s", ({ spec, expected }) => {
    expect(parseRegistryNpmSpec(spec)).toEqual(expected);
  });

  it.each([
    { value: "v1.2.3", expected: true },
    { value: "1.2", expected: false },
  ])("detects exact semver versions for %s", ({ value, expected }) => {
    expect(isExactSemverVersion(value)).toBe(expected);
  });

  it.each([
    { value: "1.2.3-beta.1", expected: true },
    { value: "1.2.3", expected: false },
  ])("detects prerelease semver versions for %s", ({ value, expected }) => {
    expect(isPrereleaseSemverVersion(value)).toBe(expected);
  });
});

describe("npm prerelease resolution policy", () => {
  it.each([
    {
      spec: "@crawclaw/demo-plugin",
      resolvedVersion: "1.2.3-beta.1",
      expected: false,
    },
    {
      spec: "@crawclaw/demo-plugin@latest",
      resolvedVersion: "1.2.3-rc.1",
      expected: false,
    },
    {
      spec: "@crawclaw/demo-plugin@beta",
      resolvedVersion: "1.2.3-beta.4",
      expected: true,
    },
    {
      spec: "@crawclaw/demo-plugin@1.2.3-beta.1",
      resolvedVersion: "1.2.3-beta.1",
      expected: true,
    },
    {
      spec: "@crawclaw/demo-plugin",
      resolvedVersion: "1.2.3",
      expected: true,
    },
    {
      spec: "@crawclaw/demo-plugin@latest",
      resolvedVersion: undefined,
      expected: true,
    },
  ])("decides prerelease resolution for %s -> %s", ({ spec, resolvedVersion, expected }) => {
    expect(
      isPrereleaseResolutionAllowed({
        spec: parseSpecOrThrow(spec),
        resolvedVersion,
      }),
    ).toBe(expected);
  });

  it.each([
    {
      spec: "@crawclaw/demo-plugin",
      resolvedVersion: "1.2.3-beta.1",
      expected: `Use "@crawclaw/demo-plugin@beta"`,
    },
    {
      spec: "@crawclaw/demo-plugin@beta",
      resolvedVersion: "1.2.3-rc.1",
      expected: "Use an explicit prerelease tag or exact prerelease version",
    },
  ])("formats prerelease guidance for %s", ({ spec, resolvedVersion, expected }) => {
    expect(
      formatPrereleaseResolutionError({
        spec: parseSpecOrThrow(spec),
        resolvedVersion,
      }),
    ).toContain(expected);
  });
});
