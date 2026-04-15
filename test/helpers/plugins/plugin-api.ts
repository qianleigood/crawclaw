import type { CrawClawPluginApi } from "crawclaw/plugin-sdk/plugin-runtime";

type TestPluginApiInput = Omit<
  Partial<CrawClawPluginApi>,
  "id" | "name" | "source" | "config" | "runtime"
> &
  Pick<CrawClawPluginApi, "id" | "name" | "source" | "config" | "runtime">;

export function createTestPluginApi(api: TestPluginApiInput): CrawClawPluginApi {
  return {
    registrationMode: "full",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerTool() {},
    registerHook() {},
    registerHttpRoute() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
    registerCliBackend() {},
    registerProvider() {},
    registerSpeechProvider() {},
    registerMediaUnderstandingProvider() {},
    registerWebFetchProvider() {},
    registerWebSearchProvider() {},
    registerInteractiveHandler() {},
    onConversationBindingResolved() {},
    registerCommand() {},
    resolvePath(input: string) {
      return input;
    },
    on() {},
    ...api,
  };
}
