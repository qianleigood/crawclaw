import { describe, expect, it } from "vitest";
import {
  collectRuntimeModuleBoundaryInventory,
  main,
} from "../scripts/check-runtime-module-boundaries.mjs";
import { createCapturedIo } from "./helpers/captured-io.js";

const inventoryPromise = collectRuntimeModuleBoundaryInventory();
const jsonOutputPromise = getJsonOutput();

async function getJsonOutput() {
  const captured = createCapturedIo();
  const exitCode = await main(["--json"], captured.io);
  return {
    exitCode,
    stderr: captured.readStderr(),
    json: JSON.parse(captured.readStdout()),
  };
}

describe("runtime module boundary inventory", () => {
  it("stays empty and sorted", async () => {
    const inventory = await inventoryPromise;
    const jsonOutput = await jsonOutputPromise;

    expect(inventory).toEqual([]);
    expect(
      [...inventory].toSorted(
        (left, right) =>
          left.boundary.localeCompare(right.boundary) ||
          left.file.localeCompare(right.file) ||
          left.line - right.line ||
          left.kind.localeCompare(right.kind) ||
          left.specifier.localeCompare(right.specifier) ||
          left.resolvedPath.localeCompare(right.resolvedPath) ||
          left.reason.localeCompare(right.reason),
      ),
    ).toEqual(inventory);
    expect(jsonOutput.exitCode).toBe(0);
    expect(jsonOutput.stderr).toBe("");
    expect(jsonOutput.json).toEqual([]);
  });
});
