import { isRecord } from "../utils.js";
export { isRecord };

export const getRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;
