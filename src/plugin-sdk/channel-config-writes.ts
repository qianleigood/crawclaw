export {
  authorizeConfigWrite,
  canBypassConfigWritePolicy,
  formatConfigWriteDeniedMessage,
  resolveChannelConfigWrites,
} from "../channels/plugins/config-writes.js";
export type {
  ConfigWriteAuthorizationResult,
  ConfigWriteScope,
  ConfigWriteTarget,
} from "../channels/plugins/config-writes.js";
