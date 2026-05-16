// Shared config/runtime boundary for plugins that need config loading,
// config writes, or session-store helpers without importing src internals.

export { resolveDefaultAgentId } from "../agents/agent-scope.js";
export {
  clearRuntimeConfigSnapshot,
  getRuntimeConfigSnapshot,
  loadConfig,
  readConfigFileSnapshotForWrite,
  setRuntimeConfigSnapshot,
  writeConfigFile,
} from "../config/io.js";
export { resolveOAuthDir, resolveStateDir, STATE_DIR } from "../config/paths.js";
export { logConfigUpdated } from "../config/logging.js";
export { updateConfig } from "../control/models/shared.js";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  resolveOpenProviderRuntimeGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "../config/runtime-group-policy.js";
export {
  isNativeCommandsExplicitlyDisabled,
  resolveNativeCommandsEnabled,
  resolveNativeSkillsEnabled,
} from "../config/commands.js";
export { resolveActiveTalkProviderConfig } from "../config/talk.js";
export { resolveAgentMaxConcurrent } from "../config/agent-limits.js";
export { loadCronStore, resolveCronStorePath, saveCronStore } from "../cron/store.js";
export { applyModelOverrideToSessionEntry } from "../sessions/model-overrides.js";
export { coerceSecretRef } from "../config/types.secrets.js";
export {
  resolveConfiguredSecretInputString,
  resolveConfiguredSecretInputWithFallback,
  resolveRequiredConfiguredSecretRefInputString,
} from "../gateway/resolve-configured-secret-input-string.js";
export type {
  DmPolicy,
  ContextVisibilityMode,
  GroupPolicy,
  MarkdownTableMode,
  CrawClawConfig,
  ReplyToMode,
  TtsAutoMode,
  TtsConfig,
  TtsMode,
  TtsModelOverrideConfig,
  TtsProvider,
} from "../config/types.js";
export {
  clearSessionStoreCacheForTest,
  loadSessionStore,
  readSessionUpdatedAt,
  saveSessionStore,
  resolveSessionKey,
  resolveStorePath,
  updateSessionStore,
  type SessionScope,
} from "../config/sessions.js";
export { resolveGroupSessionKey } from "../config/sessions/group.js";
export { canonicalizeMainSessionAlias } from "../config/sessions/main-session.js";
export { resolveSessionStoreEntry } from "../config/sessions/store.js";
export type { SessionResetMode } from "../config/types.base.js";
