import { describe, expect, it } from "vitest";
import {
  compareCrawClawVersions,
  isSameCrawClawStableFamily,
  parseCrawClawVersion,
  shouldWarnOnTouchedVersion,
} from "./version.js";

describe("parseCrawClawVersion", () => {
  it("parses stable, correction, and beta forms", () => {
    expect(parseCrawClawVersion("2026.3.23")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: null,
    });
    expect(parseCrawClawVersion("2026.3.23-1")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: 1,
      prerelease: null,
    });
    expect(parseCrawClawVersion("2026.3.23-beta.1")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: ["beta", "1"],
    });
    expect(parseCrawClawVersion("v2026.3.23.beta.2")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: ["beta", "2"],
    });
  });

  it("rejects invalid versions", () => {
    expect(parseCrawClawVersion("2026.3")).toBeNull();
    expect(parseCrawClawVersion("latest")).toBeNull();
  });
});

describe("compareCrawClawVersions", () => {
  it("treats correction publishes as newer than the base stable release", () => {
    expect(compareCrawClawVersions("2026.3.23", "2026.3.23-1")).toBe(-1);
    expect(compareCrawClawVersions("2026.3.23-1", "2026.3.23")).toBe(1);
    expect(compareCrawClawVersions("2026.3.23-2", "2026.3.23-1")).toBe(1);
  });

  it("treats stable as newer than beta and compares beta identifiers", () => {
    expect(compareCrawClawVersions("2026.3.23", "2026.3.23-beta.1")).toBe(1);
    expect(compareCrawClawVersions("2026.3.23-beta.2", "2026.3.23-beta.1")).toBe(1);
    expect(compareCrawClawVersions("2026.3.23.beta.1", "2026.3.23-beta.2")).toBe(-1);
  });
});

describe("isSameCrawClawStableFamily", () => {
  it("treats same-base stable and correction versions as one family", () => {
    expect(isSameCrawClawStableFamily("2026.3.23", "2026.3.23-1")).toBe(true);
    expect(isSameCrawClawStableFamily("2026.3.23-1", "2026.3.23-2")).toBe(true);
    expect(isSameCrawClawStableFamily("2026.3.23", "2026.3.24")).toBe(false);
    expect(isSameCrawClawStableFamily("2026.3.23-beta.1", "2026.3.23")).toBe(false);
  });
});

describe("shouldWarnOnTouchedVersion", () => {
  it("skips same-base stable families", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.23-1")).toBe(false);
    expect(shouldWarnOnTouchedVersion("2026.3.23-1", "2026.3.23-2")).toBe(false);
  });

  it("skips same-base correction publishes even when current is a prerelease", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23-beta.1", "2026.3.23-1")).toBe(false);
  });

  it("skips same-base prerelease configs when current is newer", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.23-beta.1")).toBe(false);
  });

  it("warns when the touched config is newer", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23-beta.1", "2026.3.23")).toBe(true);
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.24")).toBe(true);
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2027.1.1")).toBe(true);
  });
});
