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

  it("prefers Node 24 while accepting Node 22.14 and newer", () => {
    const installer = readInstaller();

    expect(installer).toContain("$PreferredNodeMajor = 24");
    expect(installer).toContain("$MinimumNodeMajor = 22");
    expect(installer).toContain("$MinimumNodeMinorForMajor = 14");
    expect(installer).toContain("function Test-NodeVersionSupported");
    expect(installer).toContain("Node.js 24 is recommended; continuing with supported Node.js");
  });

  it("checks native command exit codes instead of trusting PowerShell success", () => {
    const installer = readInstaller();

    expect(installer).toContain("function Invoke-InstallerNativeCommand");
    expect(installer).toContain("$LASTEXITCODE");
    expect(installer).toContain("First actionable error:");
    expect(installer).toContain("npm install failed");
  });

  it("requires Git before npm installs so PATH failures are actionable", () => {
    const installer = readInstaller();

    expect(installer).toContain("Git is required before installing CrawClaw packages on Windows.");
    expect(installer).toContain(
      "Open a new PowerShell after installing Git so PATH updates apply.",
    );
    expect(installer).not.toContain(
      "Git is required for npm installs. Please install Git and try again.",
    );
  });

  it("prints the native Windows closed-loop validation commands", () => {
    const installer = readInstaller();

    expect(installer).toContain("function Write-PostInstallNextSteps");
    expect(installer).toContain("crawclaw doctor --non-interactive");
    expect(installer).toContain(
      "crawclaw onboard --non-interactive --mode local --install-daemon --skip-skills --accept-risk",
    );
    expect(installer).toContain("crawclaw gateway status --deep --require-rpc");
  });

  it("repairs and enforces doctor after npm install", () => {
    const installer = readInstaller();

    expect(installer).toContain('Arguments @("doctor", "--non-interactive", "--fix")');
    expect(installer).toContain("Doctor repair failed.");
    expect(installer).toContain("if (!(Invoke-CrawClawDoctor))");
    expect(installer).not.toContain("Invoke-CrawClawDoctor | Out-Null");
  });
});
