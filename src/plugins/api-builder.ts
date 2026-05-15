import type { CrawClawConfig } from "../config/config.js";
import type { PluginRuntime } from "./runtime/types.js";
import type { CrawClawPluginApi, PluginLogger } from "./types.js";

export type BuildPluginApiParams = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: CrawClawPluginApi["registrationMode"];
  config: CrawClawConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  resolvePath: (input: string) => string;
  handlers?: Partial<
    Pick<
      CrawClawPluginApi,
      | "registerTool"
      | "registerHttpRoute"
      | "registerGatewayMethod"
      | "registerService"
      | "registerCliBackend"
      | "registerSpeechProvider"
      | "registerMediaUnderstandingProvider"
      | "registerWebFetchProvider"
      | "registerWebSearchProvider"
      | "onConversationBindingResolved"
      | "registerCommand"
    >
  >;
};

const noopRegisterTool: CrawClawPluginApi["registerTool"] = () => {};
const noopRegisterHttpRoute: CrawClawPluginApi["registerHttpRoute"] = () => {};
const noopRegisterGatewayMethod: CrawClawPluginApi["registerGatewayMethod"] = () => {};
const noopRegisterService: CrawClawPluginApi["registerService"] = () => {};
const noopRegisterCliBackend: CrawClawPluginApi["registerCliBackend"] = () => {};
const noopRegisterSpeechProvider: CrawClawPluginApi["registerSpeechProvider"] = () => {};
const noopRegisterMediaUnderstandingProvider: CrawClawPluginApi["registerMediaUnderstandingProvider"] =
  () => {};
const noopRegisterWebFetchProvider: CrawClawPluginApi["registerWebFetchProvider"] = () => {};
const noopRegisterWebSearchProvider: CrawClawPluginApi["registerWebSearchProvider"] = () => {};
const noopOnConversationBindingResolved: CrawClawPluginApi["onConversationBindingResolved"] =
  () => {};
const noopRegisterCommand: CrawClawPluginApi["registerCommand"] = () => {};

export function buildPluginApi(params: BuildPluginApiParams): CrawClawPluginApi {
  const handlers = params.handlers ?? {};
  return {
    id: params.id,
    name: params.name,
    version: params.version,
    description: params.description,
    source: params.source,
    rootDir: params.rootDir,
    registrationMode: params.registrationMode,
    config: params.config,
    pluginConfig: params.pluginConfig,
    runtime: params.runtime,
    logger: params.logger,
    registerTool: handlers.registerTool ?? noopRegisterTool,
    registerHttpRoute: handlers.registerHttpRoute ?? noopRegisterHttpRoute,
    registerGatewayMethod: handlers.registerGatewayMethod ?? noopRegisterGatewayMethod,
    registerService: handlers.registerService ?? noopRegisterService,
    registerCliBackend: handlers.registerCliBackend ?? noopRegisterCliBackend,
    registerSpeechProvider: handlers.registerSpeechProvider ?? noopRegisterSpeechProvider,
    registerMediaUnderstandingProvider:
      handlers.registerMediaUnderstandingProvider ?? noopRegisterMediaUnderstandingProvider,
    registerWebFetchProvider: handlers.registerWebFetchProvider ?? noopRegisterWebFetchProvider,
    registerWebSearchProvider: handlers.registerWebSearchProvider ?? noopRegisterWebSearchProvider,
    onConversationBindingResolved:
      handlers.onConversationBindingResolved ?? noopOnConversationBindingResolved,
    registerCommand: handlers.registerCommand ?? noopRegisterCommand,
    resolvePath: params.resolvePath,
  };
}
