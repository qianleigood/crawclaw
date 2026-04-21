import type { RuntimeEnv } from "../runtime.js";
import type { DoctorPrompter } from "./doctor-prompter.js";

export async function maybeRepairUiProtocolFreshness(
  _runtime: RuntimeEnv,
  _prompter: DoctorPrompter,
) {
  // Control UI was removed from this build. There is no browser asset surface to
  // repair or refresh.
}
