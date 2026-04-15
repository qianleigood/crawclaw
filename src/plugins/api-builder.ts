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
      | "registerHook"
      | "registerHttpRoute"
      | "registerChannel"
      | "registerGatewayMethod"
      | "registerCli"
      | "registerService"
      | "registerCliBackend"
      | "registerProvider"
      | "registerSpeechProvider"
      | "registerMediaUnderstandingProvider"
      | "registerWebFetchProvider"
      | "registerWebSearchProvider"
      | "registerInteractiveHandler"
      | "onConversationBindingResolved"
      | "registerCommand"
      | "on"
    >
  >;
};

const noopRegisterTool: CrawClawPluginApi["registerTool"] = () => {};
const noopRegisterHook: CrawClawPluginApi["registerHook"] = () => {};
const noopRegisterHttpRoute: CrawClawPluginApi["registerHttpRoute"] = () => {};
const noopRegisterChannel: CrawClawPluginApi["registerChannel"] = () => {};
const noopRegisterGatewayMethod: CrawClawPluginApi["registerGatewayMethod"] = () => {};
const noopRegisterCli: CrawClawPluginApi["registerCli"] = () => {};
const noopRegisterService: CrawClawPluginApi["registerService"] = () => {};
const noopRegisterCliBackend: CrawClawPluginApi["registerCliBackend"] = () => {};
const noopRegisterProvider: CrawClawPluginApi["registerProvider"] = () => {};
const noopRegisterSpeechProvider: CrawClawPluginApi["registerSpeechProvider"] = () => {};
const noopRegisterMediaUnderstandingProvider: CrawClawPluginApi["registerMediaUnderstandingProvider"] =
  () => {};
const noopRegisterWebFetchProvider: CrawClawPluginApi["registerWebFetchProvider"] = () => {};
const noopRegisterWebSearchProvider: CrawClawPluginApi["registerWebSearchProvider"] = () => {};
const noopRegisterInteractiveHandler: CrawClawPluginApi["registerInteractiveHandler"] = () => {};
const noopOnConversationBindingResolved: CrawClawPluginApi["onConversationBindingResolved"] =
  () => {};
const noopRegisterCommand: CrawClawPluginApi["registerCommand"] = () => {};
const noopOn: CrawClawPluginApi["on"] = () => {};

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
    registerHook: handlers.registerHook ?? noopRegisterHook,
    registerHttpRoute: handlers.registerHttpRoute ?? noopRegisterHttpRoute,
    registerChannel: handlers.registerChannel ?? noopRegisterChannel,
    registerGatewayMethod: handlers.registerGatewayMethod ?? noopRegisterGatewayMethod,
    registerCli: handlers.registerCli ?? noopRegisterCli,
    registerService: handlers.registerService ?? noopRegisterService,
    registerCliBackend: handlers.registerCliBackend ?? noopRegisterCliBackend,
    registerProvider: handlers.registerProvider ?? noopRegisterProvider,
    registerSpeechProvider: handlers.registerSpeechProvider ?? noopRegisterSpeechProvider,
    registerMediaUnderstandingProvider:
      handlers.registerMediaUnderstandingProvider ?? noopRegisterMediaUnderstandingProvider,
    registerWebFetchProvider: handlers.registerWebFetchProvider ?? noopRegisterWebFetchProvider,
    registerWebSearchProvider: handlers.registerWebSearchProvider ?? noopRegisterWebSearchProvider,
    registerInteractiveHandler:
      handlers.registerInteractiveHandler ?? noopRegisterInteractiveHandler,
    onConversationBindingResolved:
      handlers.onConversationBindingResolved ?? noopOnConversationBindingResolved,
    registerCommand: handlers.registerCommand ?? noopRegisterCommand,
    resolvePath: params.resolvePath,
    on: handlers.on ?? noopOn,
  };
}
