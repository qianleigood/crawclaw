import { beforeEach } from "vitest";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import {
  heartbeatRunnerSlackPlugin,
  heartbeatRunnerTelegramPlugin,
  heartbeatRunnerWhatsAppPlugin,
} from "./main-session-wake-runner.test-channel-plugins.js";

export function installMainSessionWakeRunnerTestRuntime(params?: { includeSlack?: boolean }): void {
  beforeEach(() => {
    if (params?.includeSlack) {
      setActivePluginRegistry(
        createTestRegistry([
          { pluginId: "slack", plugin: heartbeatRunnerSlackPlugin, source: "test" },
          { pluginId: "whatsapp", plugin: heartbeatRunnerWhatsAppPlugin, source: "test" },
          { pluginId: "telegram", plugin: heartbeatRunnerTelegramPlugin, source: "test" },
        ]),
      );
      return;
    }
    setActivePluginRegistry(
      createTestRegistry([
        { pluginId: "whatsapp", plugin: heartbeatRunnerWhatsAppPlugin, source: "test" },
        { pluginId: "telegram", plugin: heartbeatRunnerTelegramPlugin, source: "test" },
      ]),
    );
  });
}
