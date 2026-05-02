import { vi } from "vitest";

vi.mock("./doctor-completion.js", () => ({
  doctorShellCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./doctor-bootstrap-size.js", () => ({
  noteBootstrapFileSize: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./doctor-browser.js", () => ({
  noteChromeMcpBrowserReadiness: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./doctor-gateway-daemon-flow.js", () => ({
  maybeRepairGatewayDaemon: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./doctor-gateway-health.js", () => ({
  checkGatewayHealth: vi.fn().mockResolvedValue({ healthOk: false }),
  probeGatewayMemoryStatus: vi.fn().mockResolvedValue({ checked: false, ready: false }),
}));

vi.mock("./doctor-memory-health.js", () => ({
  noteMemoryHealth: vi.fn().mockResolvedValue(undefined),
  resolveDoctorMemoryHealth: vi.fn().mockResolvedValue({
    overall: "ok",
    notebooklm: {
      kind: "notebooklm",
      level: "ok",
      enabled: true,
      lifecycle: "ready",
      ready: true,
      reason: null,
      profile: "default",
    },
    durable: {
      kind: "durable",
      level: "ok",
      rootDir: "",
      rootExists: true,
      parentWritable: true,
      rootWritable: true,
      extractionEnabled: true,
      extractionMaxNotesPerTurn: 2,
      extractionMinEligibleTurnsBetweenRuns: 1,
      extractionMaxConcurrentWorkers: 2,
      extractionWorkerIdleTtlMs: 900000,
      extractionWorkers: {
        workerCount: 0,
        runningCount: 0,
        queuedCount: 0,
        idleWorkers: 0,
        cooldownWorkers: 0,
      },
      markdownFilesScanned: 0,
      manifestReadable: true,
      parseErrors: [],
    },
    session: {
      kind: "session",
      level: "ok",
      dbPath: "",
      dbExists: true,
      parentWritable: true,
      storeAccessible: true,
      sessionTableAccessible: true,
      contextAssemblyTableAccessible: true,
    },
  }),
}));

vi.mock("./doctor-platform-notes.js", () => ({
  noteStartupOptimizationHints: vi.fn(),
  noteMacLaunchAgentOverrides: vi.fn().mockResolvedValue(undefined),
  noteMacLaunchctlGatewayEnvOverrides: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./doctor-sandbox.js", () => ({
  maybeRepairSandboxImages: vi.fn(async (cfg: unknown) => cfg),
  noteSandboxScopeWarnings: vi.fn(),
}));

vi.mock("./doctor-security.js", () => ({
  noteSecurityWarnings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./doctor-session-locks.js", () => ({
  noteSessionLockHealth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./doctor-state-integrity.js", () => ({
  noteStateIntegrity: vi.fn().mockResolvedValue(undefined),
  noteWorkspaceBackupTip: vi.fn(),
}));

vi.mock("./doctor-workspace-status.js", () => ({
  noteWorkspaceStatus: vi.fn(),
}));

vi.mock("./oauth-tls-preflight.js", () => ({
  noteOpenAIOAuthTlsPrerequisites: vi.fn().mockResolvedValue(undefined),
}));
