import type { CrawClawConfig } from "../config/config.js";
import { buildPluginApi } from "./api-builder.js";
import type { PluginRuntime } from "./runtime/types.js";
import type {
  AnyAgentTool,
  CliBackendPlugin,
  MediaUnderstandingProviderPlugin,
  CrawClawPluginApi,
  CrawClawPluginCliCommandDescriptor,
  CrawClawPluginCliRegistrar,
  ProviderPlugin,
  SpeechProviderPlugin,
  WebFetchProviderPlugin,
  WebSearchProviderPlugin,
} from "./types.js";

type CapturedPluginCliRegistration = {
  register: CrawClawPluginCliRegistrar;
  commands: string[];
  descriptors: CrawClawPluginCliCommandDescriptor[];
};

export type CapturedPluginRegistration = {
  api: CrawClawPluginApi;
  providers: ProviderPlugin[];
  cliRegistrars: CapturedPluginCliRegistration[];
  cliBackends: CliBackendPlugin[];
  speechProviders: SpeechProviderPlugin[];
  mediaUnderstandingProviders: MediaUnderstandingProviderPlugin[];
  webFetchProviders: WebFetchProviderPlugin[];
  webSearchProviders: WebSearchProviderPlugin[];
  tools: AnyAgentTool[];
};

export function createCapturedPluginRegistration(params?: {
  config?: CrawClawConfig;
  registrationMode?: CrawClawPluginApi["registrationMode"];
}): CapturedPluginRegistration {
  const providers: ProviderPlugin[] = [];
  const cliRegistrars: CapturedPluginCliRegistration[] = [];
  const cliBackends: CliBackendPlugin[] = [];
  const speechProviders: SpeechProviderPlugin[] = [];
  const mediaUnderstandingProviders: MediaUnderstandingProviderPlugin[] = [];
  const webFetchProviders: WebFetchProviderPlugin[] = [];
  const webSearchProviders: WebSearchProviderPlugin[] = [];
  const tools: AnyAgentTool[] = [];
  const noopLogger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };

  return {
    providers,
    cliRegistrars,
    cliBackends,
    speechProviders,
    mediaUnderstandingProviders,
    webFetchProviders,
    webSearchProviders,
    tools,
    api: buildPluginApi({
      id: "captured-plugin-registration",
      name: "Captured Plugin Registration",
      source: "captured-plugin-registration",
      registrationMode: params?.registrationMode ?? "full",
      config: params?.config ?? ({} as CrawClawConfig),
      runtime: {} as PluginRuntime,
      logger: noopLogger,
      resolvePath: (input) => input,
      handlers: {
        registerCli(registrar, opts) {
          const descriptors = (opts?.descriptors ?? [])
            .map((descriptor) => ({
              name: descriptor.name.trim(),
              description: descriptor.description.trim(),
              hasSubcommands: descriptor.hasSubcommands,
            }))
            .filter((descriptor) => descriptor.name && descriptor.description);
          const commands = [
            ...(opts?.commands ?? []),
            ...descriptors.map((descriptor) => descriptor.name),
          ]
            .map((command) => command.trim())
            .filter(Boolean);
          if (commands.length === 0) {
            return;
          }
          cliRegistrars.push({
            register: registrar,
            commands,
            descriptors,
          });
        },
        registerProvider(provider: ProviderPlugin) {
          providers.push(provider);
        },
        registerCliBackend(backend: CliBackendPlugin) {
          cliBackends.push(backend);
        },
        registerSpeechProvider(provider: SpeechProviderPlugin) {
          speechProviders.push(provider);
        },
        registerMediaUnderstandingProvider(provider: MediaUnderstandingProviderPlugin) {
          mediaUnderstandingProviders.push(provider);
        },
        registerWebFetchProvider(provider: WebFetchProviderPlugin) {
          webFetchProviders.push(provider);
        },
        registerWebSearchProvider(provider: WebSearchProviderPlugin) {
          webSearchProviders.push(provider);
        },
        registerTool(tool) {
          if (typeof tool !== "function") {
            tools.push(tool);
          }
        },
      },
    }),
  };
}

export function capturePluginRegistration(params: {
  register(api: CrawClawPluginApi): void;
}): CapturedPluginRegistration {
  const captured = createCapturedPluginRegistration();
  params.register(captured.api);
  return captured;
}
