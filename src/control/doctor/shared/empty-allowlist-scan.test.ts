import { describe, expect, it } from "vitest";
import { scanEmptyAllowlistPolicyWarnings } from "./empty-allowlist-scan.js";

describe("doctor empty allowlist policy scan", () => {
  it("scans top-level and account-scoped channel warnings", () => {
    const warnings = scanEmptyAllowlistPolicyWarnings(
      {
        channels: {
          feishu: {
            dmPolicy: "allowlist",
            accounts: {
              work: { dmPolicy: "allowlist" },
            },
          },
        },
      },
      { doctorFixCommand: "crawclaw doctor --fix" },
    );

    expect(warnings).toEqual([
      expect.stringContaining('channels.feishu.dmPolicy is "allowlist" but allowFrom is empty'),
      expect.stringContaining(
        'channels.feishu.accounts.work.dmPolicy is "allowlist" but allowFrom is empty',
      ),
    ]);
  });

  it("allows provider-specific extra warnings without importing providers", () => {
    const warnings = scanEmptyAllowlistPolicyWarnings(
      {
        channels: {
          feishu: {
            groupPolicy: "allowlist",
          },
        },
      },
      {
        doctorFixCommand: "crawclaw doctor --fix",
        extraWarningsForAccount: ({ channelName, prefix }) =>
          channelName === "feishu" ? [`extra:${prefix}`] : [],
      },
    );

    expect(warnings).toContain("extra:channels.feishu");
  });
});
