import type { CommandHandlerResult, HandleCommandsParams } from "../commands-types.js";
import { stopWithText } from "./shared.js";

type AcpLifecycleHandler = (
  params: HandleCommandsParams,
  tokens: string[],
) => Promise<CommandHandlerResult>;

function unsupported(action: string): AcpLifecycleHandler {
  return async () => stopWithText(`/acp ${action} is not available from the TS command surface.`);
}

export const handleAcpSpawnAction = unsupported("spawn");
export const handleAcpCancelAction = unsupported("cancel");
export const handleAcpSteerAction = unsupported("steer");
export const handleAcpCloseAction = unsupported("close");
