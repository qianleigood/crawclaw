import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { formatTimestamp, isValidTimeZone } from "./timestamps.js";

describe("formatTimestamp", () => {
  const testDate = new Date("2025-01-01T04:00:00.000Z");

  it("formats long style with +00:00 offset for UTC", () => {
    expect(formatTimestamp(testDate, { style: "long", timeZone: "UTC" })).toBe(
      "2025-01-01T04:00:00.000+00:00",
    );
  });

  it("formats long style with +08:00 offset for Asia/Shanghai", () => {
    expect(formatTimestamp(testDate, { style: "long", timeZone: "Asia/Shanghai" })).toBe(
      "2025-01-01T12:00:00.000+08:00",
    );
  });

  it("formats long style with the correct winter offset for America/New_York", () => {
    expect(formatTimestamp(testDate, { style: "long", timeZone: "America/New_York" })).toBe(
      "2024-12-31T23:00:00.000-05:00",
    );
  });

  it("formats long style with the correct summer offset for America/New_York", () => {
    const summerDate = new Date("2025-07-01T12:00:00.000Z");
    expect(formatTimestamp(summerDate, { style: "long", timeZone: "America/New_York" })).toBe(
      "2025-07-01T08:00:00.000-04:00",
    );
  });

  it("outputs a valid ISO 8601 string with offset for long style", () => {
    const result = formatTimestamp(testDate, { style: "long", timeZone: "Asia/Shanghai" });
    const iso8601WithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;
    expect(result).toMatch(iso8601WithOffset);
  });

  it("falls back gracefully for an invalid timezone in long style", () => {
    const result = formatTimestamp(testDate, { style: "long", timeZone: "not-a-tz" });
    const iso8601WithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;
    expect(result).toMatch(iso8601WithOffset);
  });

  it("does NOT use getHours, getMinutes, getTimezoneOffset in the implementation", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "timestamps.ts"), "utf-8");
    expect(source).not.toMatch(/\.getHours\s*\(/);
    expect(source).not.toMatch(/\.getMinutes\s*\(/);
    expect(source).not.toMatch(/\.getTimezoneOffset\s*\(/);
  });

  it("formats short style with explicit UTC offset", () => {
    const shortDate = new Date("2024-01-15T14:30:45.123Z");
    expect(formatTimestamp(shortDate, { style: "short", timeZone: "UTC" })).toBe("14:30:45+00:00");
  });

  it("formats medium style with milliseconds and offset", () => {
    const mediumDate = new Date("2024-01-15T14:30:45.123Z");
    expect(formatTimestamp(mediumDate, { style: "medium", timeZone: "UTC" })).toBe(
      "14:30:45.123+00:00",
    );
  });

  it("falls back to a valid offset when the timezone is invalid", () => {
    const shortDate = new Date("2024-01-15T14:30:45.123Z");
    expect(formatTimestamp(shortDate, { style: "short", timeZone: "not-a-tz" })).toMatch(
      /^\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
  });
});

describe("isValidTimeZone", () => {
  it("returns true for valid IANA timezones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
  });

  it("returns false for invalid timezone strings", () => {
    expect(isValidTimeZone("not-a-tz")).toBe(false);
    expect(isValidTimeZone("yo agent's")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
