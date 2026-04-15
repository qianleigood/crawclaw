import { describe, expect, it } from "vitest";
import {
  ensureCrawClawExecMarkerOnProcess,
  markCrawClawExecEnv,
  CRAWCLAW_CLI_ENV_VALUE,
  CRAWCLAW_CLI_ENV_VAR,
} from "./crawclaw-exec-env.js";

describe("markCrawClawExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", CRAWCLAW_CLI: "0" };
    const marked = markCrawClawExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      CRAWCLAW_CLI: CRAWCLAW_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.CRAWCLAW_CLI).toBe("0");
  });
});

describe("ensureCrawClawExecMarkerOnProcess", () => {
  it.each([
    {
      name: "mutates and returns the provided process env",
      env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
    },
    {
      name: "overwrites an existing marker on the provided process env",
      env: { PATH: "/usr/bin", [CRAWCLAW_CLI_ENV_VAR]: "0" } as NodeJS.ProcessEnv,
    },
  ])("$name", ({ env }) => {
    expect(ensureCrawClawExecMarkerOnProcess(env)).toBe(env);
    expect(env[CRAWCLAW_CLI_ENV_VAR]).toBe(CRAWCLAW_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[CRAWCLAW_CLI_ENV_VAR];
    delete process.env[CRAWCLAW_CLI_ENV_VAR];

    try {
      expect(ensureCrawClawExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[CRAWCLAW_CLI_ENV_VAR]).toBe(CRAWCLAW_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        delete process.env[CRAWCLAW_CLI_ENV_VAR];
      } else {
        process.env[CRAWCLAW_CLI_ENV_VAR] = previous;
      }
    }
  });
});
