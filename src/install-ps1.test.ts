import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readInstaller(): string {
  return fs.readFileSync(path.join(process.cwd(), "scripts", "install.ps1"), "utf8");
}

describe("install.ps1", () => {
  it("writes git install wrapper to the selected checkout path", () => {
    const installer = readInstaller();

    expect(installer).toContain("function Resolve-CrawClawGitEntryPath");
    expect(installer).toContain("Resolve-CrawClawGitEntryPath -RepoDir $RepoDir");
    expect(installer).toContain('node "$entryPathForBatch" %*');
    expect(installer).not.toContain('node "%~dp0..\\crawclaw\\dist\\entry.js" %*');
  });

  it("escapes percent signs before writing the cmd wrapper", () => {
    const installer = readInstaller();

    expect(installer).toContain("function Escape-BatchLiteral");
    expect(installer).toContain('$Value.Replace("%", "%%")');
    expect(installer).toContain("Escape-BatchLiteral -Value $entryPath");
  });

  it("honors documented automation environment variables", () => {
    const installer = readInstaller();

    for (const envName of [
      "CRAWCLAW_INSTALL_METHOD",
      "CRAWCLAW_VERSION",
      "CRAWCLAW_BETA",
      "CRAWCLAW_GIT_DIR",
      "CRAWCLAW_NO_ONBOARD",
      "CRAWCLAW_GIT_UPDATE",
      "CRAWCLAW_DRY_RUN",
      "CRAWCLAW_NPM_LOGLEVEL",
    ]) {
      expect(installer).toContain(envName);
    }
  });

  it("rejects invalid install methods instead of silently using npm", () => {
    const installer = readInstaller();

    expect(installer).toContain("function Resolve-InstallMethod");
    expect(installer).toContain("Invalid -InstallMethod");
    expect(installer).toContain("exit 2");
  });
});
