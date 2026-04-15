import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          CRAWCLAW_STATE_DIR: "/tmp/crawclaw-state",
          CRAWCLAW_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "crawclaw-gateway",
        windowsTaskName: "CrawClaw Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/crawclaw-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/crawclaw-state/logs/gateway.err.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        systemdServiceName: "crawclaw-gateway",
        windowsTaskName: "CrawClaw Gateway",
      }),
    ).toEqual(["Logs: journalctl --user -u crawclaw-gateway.service -n 200 --no-pager"]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        systemdServiceName: "crawclaw-gateway",
        windowsTaskName: "CrawClaw Gateway",
      }),
    ).toEqual(['Logs: schtasks /Query /TN "CrawClaw Gateway" /V /FO LIST']);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "crawclaw gateway install",
        startCommand: "crawclaw gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.crawclaw.gateway.plist",
        systemdServiceName: "crawclaw-gateway",
        windowsTaskName: "CrawClaw Gateway",
      }),
    ).toEqual([
      "crawclaw gateway install",
      "crawclaw gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.crawclaw.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "crawclaw gateway install",
        startCommand: "crawclaw gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.crawclaw.gateway.plist",
        systemdServiceName: "crawclaw-gateway",
        windowsTaskName: "CrawClaw Gateway",
      }),
    ).toEqual([
      "crawclaw gateway install",
      "crawclaw gateway",
      "systemctl --user start crawclaw-gateway.service",
    ]);
  });
});
