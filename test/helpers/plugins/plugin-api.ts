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
    registerHttpRoute() {},
    registerGatewayMethod() {},
    registerService() {},
    registerCliBackend() {},
    registerSpeechProvider() {},
    registerMediaUnderstandingProvider() {},
    registerWebFetchProvider() {},
    registerWebSearchProvider() {},
    onConversationBindingResolved() {},
    registerCommand() {},
    resolvePath(input: string) {
      return input;
    },
    ...api,
  };
}
