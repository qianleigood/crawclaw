import { describe, expect, it } from "vitest";
import {
  getSandboxHostPathKind,
  isSandboxHostPathInside,
  normalizeSandboxHostPath,
} from "./host-paths.js";

describe("sandbox host path normalization", () => {
  it("normalizes Windows drive-letter paths without converting them to POSIX", () => {
    expect(normalizeSandboxHostPath("\\\\?\\C:\\Users\\kai\\project\\..\\cache\\")).toBe(
      "C:\\Users\\kai\\cache",
    );
  });

  it("normalizes UNC namespace paths and classifies them as network paths", () => {
    const normalized = normalizeSandboxHostPath("\\\\?\\UNC\\server\\share\\project\\");
    expect(normalized).toBe("\\\\server\\share\\project");
    expect(getSandboxHostPathKind(normalized)).toBe("windows-unc");
  });

  it("compares Windows drive-letter paths case-insensitively for source-root checks", () => {
    expect(isSandboxHostPathInside("C:\\Users\\Kai\\Project", "c:/users/kai/project/cache")).toBe(
      true,
    );
    expect(
      isSandboxHostPathInside("C:\\Users\\Kai\\Project", "D:\\Users\\Kai\\Project\\cache"),
    ).toBe(false);
  });
});
