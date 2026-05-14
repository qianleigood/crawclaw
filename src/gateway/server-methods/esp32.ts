import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "../request-types.js";

const REMOVED_REASON =
  "ESP32 TypeScript channel runtime has been removed; implement ESP32 as a Rust-native channel plugin.";

function unavailable(method: string): GatewayRequestHandlers[string] {
  return async ({ respond }) => {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `${method}: ${REMOVED_REASON}`));
  };
}

export const esp32Handlers: GatewayRequestHandlers = {
  "esp32.status.get": unavailable("esp32.status.get"),
  "esp32.pairing.start": unavailable("esp32.pairing.start"),
  "esp32.pairing.requests.list": unavailable("esp32.pairing.requests.list"),
  "esp32.pairing.session.revoke": unavailable("esp32.pairing.session.revoke"),
  "esp32.pairing.request.approve": unavailable("esp32.pairing.request.approve"),
  "esp32.pairing.request.reject": unavailable("esp32.pairing.request.reject"),
  "esp32.devices.list": unavailable("esp32.devices.list"),
  "esp32.devices.get": unavailable("esp32.devices.get"),
  "esp32.devices.revoke": unavailable("esp32.devices.revoke"),
  "esp32.devices.command.send": unavailable("esp32.devices.command.send"),
};
