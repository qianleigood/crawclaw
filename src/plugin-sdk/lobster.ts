// Private Lobster plugin helpers for bundled extensions.
// Keep this surface narrow and limited to the Lobster workflow/tool contract.

export {
  applyWindowsSpawnProgramPolicy,
  materializeWindowsSpawnProgram,
  resolveWindowsSpawnProgramCandidate,
} from "./windows-spawn.js";
