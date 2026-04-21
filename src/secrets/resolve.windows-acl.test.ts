import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auditMocks = vi.hoisted(() => ({
  inspectPathPermissions: vi.fn(),
}));

vi.mock("../security/audit-fs.js", async () => {
  const actual =
    await vi.importActual<typeof import("../security/audit-fs.js")>("../security/audit-fs.js");
  return {
    ...actual,
    inspectPathPermissions: auditMocks.inspectPathPermissions,
  };
});

const { resolveSecretRefString } = await import("./resolve.js");

async function writeSecretFile(contents: string): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-secret-acl-"));
  const filePath = path.join(dir, "secret.txt");
  await fs.writeFile(filePath, contents, "utf8");
  return { dir, filePath };
}

function createFileSecretConfig(filePath: string, allowInsecurePath = false) {
  return {
    secrets: {
      providers: {
        filemain: {
          source: "file" as const,
          path: filePath,
          mode: "singleValue" as const,
          ...(allowInsecurePath ? { allowInsecurePath: true } : {}),
        },
      },
    },
  };
}

describe("secret ref resolver Windows ACL handling", () => {
  let platformSpy: ReturnType<typeof vi.spyOn>;
  const tempDirs: string[] = [];

  beforeEach(() => {
    platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    auditMocks.inspectPathPermissions.mockReset();
    auditMocks.inspectPathPermissions.mockResolvedValue({
      ok: true,
      isSymlink: false,
      isDir: false,
      mode: 0o600,
      bits: 0o600,
      source: "unknown",
      worldWritable: false,
      groupWritable: false,
      worldReadable: false,
      groupReadable: false,
      error: "icacls unavailable",
    });
  });

  afterEach(async () => {
    platformSpy.mockRestore();
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("fails closed with a clear bypass hint when ACL verification is unavailable", async () => {
    const { dir, filePath } = await writeSecretFile("secret-value");
    tempDirs.push(dir);

    await expect(
      resolveSecretRefString(
        { source: "file", provider: "filemain", id: "value" },
        { config: createFileSecretConfig(filePath) },
      ),
    ).rejects.toThrow(/ACL verification unavailable on Windows.*allowInsecurePath=true/s);
  });

  it("allows trusted opt-in when ACL verification is unavailable", async () => {
    const { dir, filePath } = await writeSecretFile("secret-value");
    tempDirs.push(dir);

    await expect(
      resolveSecretRefString(
        { source: "file", provider: "filemain", id: "value" },
        { config: createFileSecretConfig(filePath, true) },
      ),
    ).resolves.toBe("secret-value");
  });
});
