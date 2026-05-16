// Shared setup wizard/types/helpers for plugin setup surfaces.

export type { CrawClawConfig } from "../config/config.js";
export type { DmPolicy, GroupPolicy } from "../config/types.js";
export type { SecretInput } from "../config/types.secrets.js";
export type { WizardPrompter } from "../wizard/prompts.js";
export { WizardCancelledError } from "../wizard/prompts.js";

export { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
export { formatCliCommand } from "../terminal/command-format.js";
export { detectBinary } from "../plugins/setup-binary.js";
export { formatDocsLink } from "../terminal/links.js";
export { hasConfiguredSecretInput, normalizeSecretInputString } from "../config/types.secrets.js";
export { normalizeE164, pathExists } from "../utils.js";

export { formatResolvedUnresolvedNote } from "./resolution-notes.js";
