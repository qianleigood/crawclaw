import { GOOGLE_MODEL_APIS } from "../../generated/providers/runtime-constants.generated.js";
import { sanitizeGoogleTurnOrdering } from "./bootstrap.js";

const GOOGLE_MODEL_API_SET = new Set<string>(GOOGLE_MODEL_APIS);

export function isGoogleModelApi(api?: string | null): boolean {
  return api != null && GOOGLE_MODEL_API_SET.has(api);
}

export { sanitizeGoogleTurnOrdering };
