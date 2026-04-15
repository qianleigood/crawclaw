// Shared bootstrap/pairing helpers for plugins that provision remote devices.

export {
  approveDevicePairing,
  clearDeviceBootstrapTokens,
  issueDeviceBootstrapToken,
  listDevicePairing,
  revokeDeviceBootstrapToken,
} from "./infra-runtime.js";
export {
  normalizeDeviceBootstrapProfile,
  PAIRING_SETUP_BOOTSTRAP_PROFILE,
  type DeviceBootstrapProfile,
  type DeviceBootstrapProfileInput,
} from "../shared/device-bootstrap-profile.js";
