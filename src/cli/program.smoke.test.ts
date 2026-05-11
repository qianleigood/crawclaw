import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "./program.js";
import {
  configureCommand,
  ensureConfigReady,
  installBaseProgramMocks,
  installSmokeProgramMocks,
  runtime,
  setupCommand,
  setupWizardCommand,
} from "./program.test-mocks.js";

installBaseProgramMocks();
installSmokeProgramMocks();

vi.mock("./config-cli.js", () => ({
  registerConfigCli: (program: {
    command: (name: string) => { action: (fn: () => unknown) => void };
  }) => {
    program.command("config").action(() => configureCommand({}, runtime));
  },
  runConfigGet: vi.fn(),
  runConfigUnset: vi.fn(),
}));

describe("cli program (smoke)", () => {
  let program = createProgram();

  function createProgram() {
    return buildProgram();
  }

  async function runProgram(argv: string[]) {
    await program.parseAsync(argv, { from: "user" });
  }

  beforeEach(() => {
    program = createProgram();
    vi.clearAllMocks();
    ensureConfigReady.mockResolvedValue(undefined);
  });

  it("registers message + status commands", () => {
    const names = program.commands.map((command) => command.name());
    expect(names).toContain("message");
    expect(names).toContain("status");
    expect(names).toContain("memory");
  });

  it("runs setup wizard when wizard flags are present", async () => {
    await runProgram(["setup", "--remote-url", "ws://example"]);

    expect(setupCommand).not.toHaveBeenCalled();
    expect(setupWizardCommand).toHaveBeenCalledTimes(1);
  });
});
