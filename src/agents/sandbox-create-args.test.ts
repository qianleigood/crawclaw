import { describe, expect, it } from "vitest";
import { CRAWCLAW_CLI_ENV_VALUE } from "../infra/crawclaw-exec-env.js";
import { buildSandboxCreateArgs } from "./sandbox/docker.js";
import type { SandboxDockerConfig } from "./sandbox/types.js";

describe("buildSandboxCreateArgs", () => {
  function createSandboxConfig(
    overrides: Partial<SandboxDockerConfig> = {},
    binds?: string[],
  ): SandboxDockerConfig {
    return {
      image: "crawclaw-sandbox:bookworm-slim",
      containerPrefix: "crawclaw-sbx-",
      workdir: "/workspace",
      readOnlyRoot: false,
      tmpfs: [],
      network: "none",
      capDrop: [],
      ...(binds ? { binds } : {}),
      ...overrides,
    };
  }

  function expectBuildToThrow(
    name: string,
    cfg: SandboxDockerConfig,
    expectedMessage: RegExp,
  ): void {
    expect(
      () =>
        buildSandboxCreateArgs({
          name,
          cfg,
          scopeKey: "main",
          createdAtMs: 1700000000000,
        }),
      name,
    ).toThrow(expectedMessage);
  }

  it("includes hardening and resource flags", () => {
    const cfg: SandboxDockerConfig = {
      image: "crawclaw-sandbox:bookworm-slim",
      containerPrefix: "crawclaw-sbx-",
      workdir: "/workspace",
      readOnlyRoot: true,
      tmpfs: ["/tmp"],
      network: "none",
      user: "1000:1000",
      capDrop: ["ALL"],
      env: { LANG: "C.UTF-8" },
      pidsLimit: 256,
      memory: "512m",
      memorySwap: 1024,
      cpus: 1.5,
      ulimits: {
        nofile: { soft: 1024, hard: 2048 },
        nproc: 128,
        core: "0",
      },
      seccompProfile: "/tmp/seccomp.json",
      apparmorProfile: "crawclaw-sandbox",
      dns: ["1.1.1.1"],
      extraHosts: ["internal.service:10.0.0.5"],
    };

    const args = buildSandboxCreateArgs({
      name: "crawclaw-sbx-test",
      cfg,
      scopeKey: "main",
      createdAtMs: 1700000000000,
      labels: { "crawclaw.sandboxBrowser": "1" },
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "create",
        "--name",
        "crawclaw-sbx-test",
        "--label",
        "crawclaw.sandbox=1",
        "--label",
        "crawclaw.sessionKey=main",
        "--label",
        "crawclaw.createdAtMs=1700000000000",
        "--label",
        "crawclaw.sandboxBrowser=1",
        "--read-only",
        "--tmpfs",
        "/tmp",
        "--network",
        "none",
        "--user",
        "1000:1000",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--security-opt",
        "seccomp=/tmp/seccomp.json",
        "--security-opt",
        "apparmor=crawclaw-sandbox",
        "--dns",
        "1.1.1.1",
        "--add-host",
        "internal.service:10.0.0.5",
        "--pids-limit",
        "256",
        "--memory",
        "512m",
        "--memory-swap",
        "1024",
        "--cpus",
        "1.5",
      ]),
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "--env",
        "LANG=C.UTF-8",
        "--env",
        `CRAWCLAW_CLI=${CRAWCLAW_CLI_ENV_VALUE}`,
      ]),
    );

    const ulimitValues: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--ulimit") {
        const value = args[i + 1];
        if (value) {
          ulimitValues.push(value);
        }
      }
    }
    expect(ulimitValues).toEqual(
      expect.arrayContaining(["nofile=1024:2048", "nproc=128", "core=0"]),
    );
  });

  it("preserves the CrawClaw exec marker when strict env sanitization is enabled", () => {
    const cfg = createSandboxConfig({
      env: {
        NODE_ENV: "test",
      },
    });

    const args = buildSandboxCreateArgs({
      name: "crawclaw-sbx-marker",
      cfg,
      scopeKey: "main",
      createdAtMs: 1700000000000,
      envSanitizationOptions: {
        strictMode: true,
      },
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "--env",
        "NODE_ENV=test",
        "--env",
        `CRAWCLAW_CLI=${CRAWCLAW_CLI_ENV_VALUE}`,
      ]),
    );
  });

  it("emits -v flags for safe custom binds", () => {
    const cfg: SandboxDockerConfig = {
      image: "crawclaw-sandbox:bookworm-slim",
      containerPrefix: "crawclaw-sbx-",
      workdir: "/workspace",
      readOnlyRoot: false,
      tmpfs: [],
      network: "none",
      capDrop: [],
      binds: ["/home/user/source:/source:rw", "/var/data/myapp:/data:ro"],
    };

    const args = buildSandboxCreateArgs({
      name: "crawclaw-sbx-binds",
      cfg,
      scopeKey: "main",
      createdAtMs: 1700000000000,
    });

    expect(args).toContain("-v");
    const vFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-v") {
        const value = args[i + 1];
        if (value) {
          vFlags.push(value);
        }
      }
    }
    expect(vFlags).toContain("/home/user/source:/source:rw");
    expect(vFlags).toContain("/var/data/myapp:/data:ro");
  });

  it.each([
    {
      name: "dangerous Docker socket bind mounts",
      containerName: "crawclaw-sbx-dangerous",
      cfg: createSandboxConfig({}, ["/var/run/docker.sock:/var/run/docker.sock"]),
      expected: /blocked path/,
    },
    {
      name: "dangerous parent bind mounts",
      containerName: "crawclaw-sbx-dangerous-parent",
      cfg: createSandboxConfig({}, ["/run:/run"]),
      expected: /blocked path/,
    },
    {
      name: "network host mode",
      containerName: "crawclaw-sbx-host",
      cfg: createSandboxConfig({ network: "host" }),
      expected: /network mode "host" is blocked/,
    },
    {
      name: "network container namespace join",
      containerName: "crawclaw-sbx-container-network",
      cfg: createSandboxConfig({ network: "container:peer" }),
      expected: /network mode "container:peer" is blocked by default/,
    },
    {
      name: "seccomp unconfined",
      containerName: "crawclaw-sbx-seccomp",
      cfg: createSandboxConfig({ seccompProfile: "unconfined" }),
      expected: /seccomp profile "unconfined" is blocked/,
    },
    {
      name: "apparmor unconfined",
      containerName: "crawclaw-sbx-apparmor",
      cfg: createSandboxConfig({ apparmorProfile: "unconfined" }),
      expected: /apparmor profile "unconfined" is blocked/,
    },
  ])("throws on $name", ({ containerName, cfg, expected }) => {
    expectBuildToThrow(containerName, cfg, expected);
  });

  it("omits -v flags when binds is empty or undefined", () => {
    const cfg: SandboxDockerConfig = {
      image: "crawclaw-sandbox:bookworm-slim",
      containerPrefix: "crawclaw-sbx-",
      workdir: "/workspace",
      readOnlyRoot: false,
      tmpfs: [],
      network: "none",
      capDrop: [],
      binds: [],
    };

    const args = buildSandboxCreateArgs({
      name: "crawclaw-sbx-no-binds",
      cfg,
      scopeKey: "main",
      createdAtMs: 1700000000000,
    });

    // Count -v flags that are NOT workspace mounts (workspace mounts are internal)
    const customVFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-v") {
        const value = args[i + 1];
        if (value && !value.includes("/workspace")) {
          customVFlags.push(value);
        }
      }
    }
    expect(customVFlags).toHaveLength(0);
  });

  it("blocks bind sources outside runtime allowlist roots", () => {
    const cfg = createSandboxConfig({}, ["/opt/external:/data:rw"]);
    expect(() =>
      buildSandboxCreateArgs({
        name: "crawclaw-sbx-outside-roots",
        cfg,
        scopeKey: "main",
        createdAtMs: 1700000000000,
        bindSourceRoots: ["/tmp/workspace", "/tmp/agent"],
      }),
    ).toThrow(/outside allowed roots/);
  });

  it("allows bind sources outside runtime allowlist with explicit override", () => {
    const cfg = createSandboxConfig({}, ["/opt/external:/data:rw"]);
    const args = buildSandboxCreateArgs({
      name: "crawclaw-sbx-outside-roots-override",
      cfg,
      scopeKey: "main",
      createdAtMs: 1700000000000,
      bindSourceRoots: ["/tmp/workspace", "/tmp/agent"],
      allowSourcesOutsideAllowedRoots: true,
    });
    expect(args).toEqual(expect.arrayContaining(["-v", "/opt/external:/data:rw"]));
  });

  it("blocks reserved /workspace target bind mounts by default", () => {
    const cfg = createSandboxConfig({}, ["/tmp/override:/workspace:rw"]);
    expectBuildToThrow("crawclaw-sbx-reserved-target", cfg, /reserved container path/);
  });

  it("allows reserved /workspace target bind mounts with explicit dangerous override", () => {
    const cfg = createSandboxConfig({}, ["/tmp/override:/workspace:rw"]);
    const args = buildSandboxCreateArgs({
      name: "crawclaw-sbx-reserved-target-override",
      cfg,
      scopeKey: "main",
      createdAtMs: 1700000000000,
      allowReservedContainerTargets: true,
    });
    expect(args).toEqual(expect.arrayContaining(["-v", "/tmp/override:/workspace:rw"]));
  });

  it("allows container namespace join with explicit dangerous override", () => {
    const cfg = createSandboxConfig({
      network: "container:peer",
      dangerouslyAllowContainerNamespaceJoin: true,
    });
    const args = buildSandboxCreateArgs({
      name: "crawclaw-sbx-container-network-override",
      cfg,
      scopeKey: "main",
      createdAtMs: 1700000000000,
    });
    expect(args).toEqual(expect.arrayContaining(["--network", "container:peer"]));
  });
});
