import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerImproveCli } from "./improve-cli.js";

const runtimeModule = vi.hoisted(() => ({
  handleImproveCliError: vi.fn(),
  runImproveRunCommand: vi.fn(),
  runImproveInboxCommand: vi.fn(),
  runImproveShowCommand: vi.fn(),
  runImproveReviewCommand: vi.fn(),
  runImproveApplyCommand: vi.fn(),
  runImproveVerifyCommand: vi.fn(),
  runImproveRollbackCommand: vi.fn(),
  runImproveMetricsCommand: vi.fn(),
}));

vi.mock("./improve-cli.runtime.js", () => runtimeModule);

describe("registerImproveCli", () => {
  beforeEach(() => {
    for (const value of Object.values(runtimeModule)) {
      value.mockReset();
    }
  });

  function createProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
    registerImproveCli(program);
    return program;
  }

  it("registers the improve command with product subcommands", () => {
    const program = createProgram();
    const improve = program.commands.find((command) => command.name() === "improve");
    expect(improve?.commands.map((command) => command.name())).toEqual([
      "run",
      "inbox",
      "show",
      "review",
      "apply",
      "verify",
      "rollback",
      "metrics",
    ]);
  });

  it("dispatches inbox options to the runtime", async () => {
    const program = createProgram();
    await program.parseAsync(
      ["improve", "inbox", "--status", "pending_review,approved", "--kind", "skill", "--json"],
      { from: "user" },
    );

    expect(runtimeModule.runImproveInboxCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending_review,approved",
        kind: "skill",
        json: true,
      }),
      expect.any(Object),
    );
  });

  it("dispatches review approval to the runtime", async () => {
    const program = createProgram();
    await program.parseAsync(
      ["improve", "review", "proposal-1", "--approve", "--reviewer", "maintainer"],
      { from: "user" },
    );

    expect(runtimeModule.runImproveReviewCommand).toHaveBeenCalledWith(
      "proposal-1",
      expect.objectContaining({
        approve: true,
        reviewer: "maintainer",
      }),
      expect.any(Object),
    );
  });
});
