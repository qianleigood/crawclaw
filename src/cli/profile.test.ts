import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "crawclaw",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "crawclaw", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("leaves gateway --dev for subcommands after leading root options", () => {
    const res = parseCliProfileArgs([
      "node",
      "crawclaw",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "crawclaw",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "crawclaw", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "crawclaw", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "crawclaw", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "crawclaw", "status"]);
  });

  it("parses interleaved --profile after the command token", () => {
    const res = parseCliProfileArgs(["node", "crawclaw", "status", "--profile", "work", "--deep"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "crawclaw", "status", "--deep"]);
  });

  it("parses interleaved --dev after the command token", () => {
    const res = parseCliProfileArgs(["node", "crawclaw", "status", "--dev"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "crawclaw", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "crawclaw", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "crawclaw", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "crawclaw", "--profile", "work", "--dev", "status"]],
    ["interleaved after command", ["node", "crawclaw", "status", "--profile", "work", "--dev"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".crawclaw-dev");
    expect(env.CRAWCLAW_PROFILE).toBe("dev");
    expect(env.CRAWCLAW_STATE_DIR).toBe(expectedStateDir);
    expect(env.CRAWCLAW_CONFIG_PATH).toBe(path.join(expectedStateDir, "crawclaw.json"));
    expect(env.CRAWCLAW_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      CRAWCLAW_STATE_DIR: "/custom",
      CRAWCLAW_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.CRAWCLAW_STATE_DIR).toBe("/custom");
    expect(env.CRAWCLAW_GATEWAY_PORT).toBe("19099");
    expect(env.CRAWCLAW_CONFIG_PATH).toBe(path.join("/custom", "crawclaw.json"));
  });

  it("uses CRAWCLAW_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      CRAWCLAW_HOME: "/srv/crawclaw-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/crawclaw-home");
    expect(env.CRAWCLAW_STATE_DIR).toBe(path.join(resolvedHome, ".crawclaw-work"));
    expect(env.CRAWCLAW_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".crawclaw-work", "crawclaw.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "crawclaw doctor --fix",
      env: {},
      expected: "crawclaw doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "crawclaw doctor --fix",
      env: { CRAWCLAW_PROFILE: "default" },
      expected: "crawclaw doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "crawclaw doctor --fix",
      env: { CRAWCLAW_PROFILE: "Default" },
      expected: "crawclaw doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "crawclaw doctor --fix",
      env: { CRAWCLAW_PROFILE: "bad profile" },
      expected: "crawclaw doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "crawclaw --profile work doctor --fix",
      env: { CRAWCLAW_PROFILE: "work" },
      expected: "crawclaw --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "crawclaw --dev doctor",
      env: { CRAWCLAW_PROFILE: "dev" },
      expected: "crawclaw --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("crawclaw doctor --fix", { CRAWCLAW_PROFILE: "work" })).toBe(
      "crawclaw --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("crawclaw doctor --fix", { CRAWCLAW_PROFILE: "  jbcrawclaw  " })).toBe(
      "crawclaw --profile jbcrawclaw doctor --fix",
    );
  });

  it("handles command with no args after crawclaw", () => {
    expect(formatCliCommand("crawclaw", { CRAWCLAW_PROFILE: "test" })).toBe(
      "crawclaw --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm crawclaw doctor", { CRAWCLAW_PROFILE: "work" })).toBe(
      "pnpm crawclaw --profile work doctor",
    );
  });

  it("inserts --container when a container hint is set", () => {
    expect(
      formatCliCommand("crawclaw gateway status --deep", { CRAWCLAW_CONTAINER_HINT: "demo" }),
    ).toBe("crawclaw --container demo gateway status --deep");
  });

  it("preserves both --container and --profile hints", () => {
    expect(
      formatCliCommand("crawclaw doctor", {
        CRAWCLAW_CONTAINER_HINT: "demo",
        CRAWCLAW_PROFILE: "work",
      }),
    ).toBe("crawclaw --container demo doctor");
  });

  it("does not prepend --container for update commands", () => {
    expect(formatCliCommand("crawclaw update", { CRAWCLAW_CONTAINER_HINT: "demo" })).toBe(
      "crawclaw update",
    );
    expect(
      formatCliCommand("pnpm crawclaw update --channel beta", { CRAWCLAW_CONTAINER_HINT: "demo" }),
    ).toBe("pnpm crawclaw update --channel beta");
  });
});
