import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixSecurityFootguns } from "./fix.js";

const isWindows = process.platform === "win32";

const expectPerms = (actual: number, expected: number) => {
  if (isWindows) {
    expect([expected, 0o666, 0o777]).toContain(actual);
    return;
  }
  expect(actual).toBe(expected);
};

describe("security fix", () => {
  let fixtureRoot = "";
  let fixtureCount = 0;

  const createStateDir = async (prefix: string) => {
    const dir = path.join(fixtureRoot, `${prefix}-${fixtureCount++}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  };

  const createFixEnv = (stateDir: string, configPath: string) => ({
    ...process.env,
    CRAWCLAW_STATE_DIR: stateDir,
    CRAWCLAW_CONFIG_PATH: configPath,
  });

  const expectTightenedStateAndConfigPerms = async (stateDir: string, configPath: string) => {
    const stateMode = (await fs.stat(stateDir)).mode & 0o777;
    expectPerms(stateMode, 0o700);

    const configMode = (await fs.stat(configPath)).mode & 0o777;
    expectPerms(configMode, 0o600);
  };

  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-security-fix-suite-"));
  });

  afterAll(async () => {
    if (fixtureRoot) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("returns ok=false for invalid config but still tightens perms", async () => {
    const stateDir = await createStateDir("invalid-config");
    await fs.chmod(stateDir, 0o755);

    const configPath = path.join(stateDir, "crawclaw.json");
    await fs.writeFile(configPath, "{ this is not json }\n", "utf-8");
    await fs.chmod(configPath, 0o644);

    const res = await fixSecurityFootguns({
      env: createFixEnv(stateDir, configPath),
      stateDir,
      configPath,
    });
    expect(res.ok).toBe(false);

    await expectTightenedStateAndConfigPerms(stateDir, configPath);
  });

  it("tightens perms for credentials + agent auth/sessions + include files", async () => {
    const stateDir = await createStateDir("includes");

    const includesDir = path.join(stateDir, "includes");
    await fs.mkdir(includesDir, { recursive: true });
    const includePath = path.join(includesDir, "extra.json5");
    await fs.writeFile(includePath, "{ logging: { redactSensitive: 'off' } }\n", "utf-8");
    await fs.chmod(includePath, 0o644);

    const configPath = path.join(stateDir, "crawclaw.json");
    await fs.writeFile(configPath, `{ "$include": "./includes/extra.json5" }\n`, "utf-8");
    await fs.chmod(configPath, 0o644);

    const credsDir = path.join(stateDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true });
    const secretPath = path.join(credsDir, "runtime-secret.json");
    await fs.writeFile(secretPath, "{}\n", "utf-8");
    await fs.chmod(secretPath, 0o644);

    const agentDir = path.join(stateDir, "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    const authProfilesPath = path.join(agentDir, "auth-profiles.json");
    await fs.writeFile(authProfilesPath, "{}\n", "utf-8");
    await fs.chmod(authProfilesPath, 0o644);

    const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionsStorePath = path.join(sessionsDir, "sessions.json");
    await fs.writeFile(sessionsStorePath, "{}\n", "utf-8");
    await fs.chmod(sessionsStorePath, 0o644);
    const transcriptPath = path.join(sessionsDir, "sess-main.jsonl");
    await fs.writeFile(transcriptPath, '{"type":"session"}\n', "utf-8");
    await fs.chmod(transcriptPath, 0o644);

    const res = await fixSecurityFootguns({
      env: createFixEnv(stateDir, configPath),
      stateDir,
      configPath,
    });
    expect(res.ok).toBe(true);

    const permissionChecks: Array<readonly [string, number]> = [
      [credsDir, 0o700],
      [secretPath, 0o600],
      [authProfilesPath, 0o600],
      [sessionsStorePath, 0o600],
      [transcriptPath, 0o600],
      [includePath, 0o600],
    ];
    await Promise.all(
      permissionChecks.map(async ([targetPath, expectedMode]) =>
        expectPerms((await fs.stat(targetPath)).mode & 0o777, expectedMode),
      ),
    );
  });
});
