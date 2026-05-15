import type { CrawClawConfig } from "../config/config.js";
import { resolveManifestProviderAuthChoices } from "../plugins/provider-auth-choices.js";
import type { FlowContribution, FlowOption } from "./types.js";
import { sortFlowContributionsByLabel } from "./types.js";

export type ProviderFlowScope = "text-inference";

const DEFAULT_PROVIDER_FLOW_SCOPE: ProviderFlowScope = "text-inference";

export type ProviderSetupFlowOption = FlowOption & {
  onboardingScopes?: ProviderFlowScope[];
};

export type ProviderModelPickerFlowEntry = FlowOption;

export type ProviderSetupFlowContribution = FlowContribution & {
  kind: "provider";
  surface: "setup";
  providerId: string;
  pluginId?: string;
  option: ProviderSetupFlowOption;
  onboardingScopes?: ProviderFlowScope[];
  source: "manifest";
};

export type ProviderModelPickerFlowContribution = FlowContribution & {
  kind: "provider";
  surface: "model-picker";
  providerId: string;
  option: ProviderModelPickerFlowEntry;
  source: "rust";
};

function includesProviderFlowScope(
  scopes: readonly ProviderFlowScope[] | undefined,
  scope: ProviderFlowScope,
): boolean {
  return scopes ? scopes.includes(scope) : scope === DEFAULT_PROVIDER_FLOW_SCOPE;
}

function resolveProviderDocsById(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): Map<string, string> {
  void params;
  return new Map(
    resolveManifestProviderAuthChoices(params).map((choice) => [
      choice.providerId,
      `/providers/${choice.providerId}`,
    ]),
  );
}

export function resolveManifestProviderSetupFlowOptions(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  scope?: ProviderFlowScope;
}): ProviderSetupFlowOption[] {
  return resolveManifestProviderSetupFlowContributions(params).map(
    (contribution) => contribution.option,
  );
}

export function resolveManifestProviderSetupFlowContributions(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  scope?: ProviderFlowScope;
}): ProviderSetupFlowContribution[] {
  const scope = params?.scope ?? DEFAULT_PROVIDER_FLOW_SCOPE;
  const docsByProvider = resolveProviderDocsById(params ?? {});
  return resolveManifestProviderAuthChoices(params)
    .filter((choice) => includesProviderFlowScope(choice.onboardingScopes, scope))
    .map((choice) => ({
      id: `provider:setup:${choice.choiceId}`,
      kind: "provider" as const,
      surface: "setup" as const,
      providerId: choice.providerId,
      pluginId: choice.pluginId,
      option: {
        value: choice.choiceId,
        label: choice.choiceLabel,
        ...(choice.choiceHint ? { hint: choice.choiceHint } : {}),
        ...(choice.groupId && choice.groupLabel
          ? {
              group: {
                id: choice.groupId,
                label: choice.groupLabel,
                ...(choice.groupHint ? { hint: choice.groupHint } : {}),
              },
            }
          : {}),
        ...(docsByProvider.get(choice.providerId)
          ? { docs: { path: docsByProvider.get(choice.providerId)! } }
          : {}),
      },
      ...(choice.onboardingScopes ? { onboardingScopes: [...choice.onboardingScopes] } : {}),
      source: "manifest" as const,
    }));
}

export function resolveRuntimeFallbackProviderSetupFlowOptions(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  scope?: ProviderFlowScope;
}): ProviderSetupFlowOption[] {
  void params;
  return [];
}

export function resolveRuntimeFallbackProviderSetupFlowContributions(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  scope?: ProviderFlowScope;
}): ProviderSetupFlowContribution[] {
  void params;
  return [];
}

export function resolveProviderSetupFlowOptions(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  scope?: ProviderFlowScope;
}): ProviderSetupFlowOption[] {
  return resolveProviderSetupFlowContributions(params).map((contribution) => contribution.option);
}

export function resolveProviderSetupFlowContributions(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  scope?: ProviderFlowScope;
}): ProviderSetupFlowContribution[] {
  return sortFlowContributionsByLabel(resolveManifestProviderSetupFlowContributions(params));
}

export function resolveProviderModelPickerFlowEntries(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): ProviderModelPickerFlowEntry[] {
  return resolveProviderModelPickerFlowContributions(params).map(
    (contribution) => contribution.option,
  );
}

export function resolveProviderModelPickerFlowContributions(params?: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): ProviderModelPickerFlowContribution[] {
  void params;
  return [];
}

export { includesProviderFlowScope };
