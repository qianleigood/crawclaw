import { describe, expect, it } from "vitest";
import { pluginRegistrationContractRegistry } from "../../../src/plugins/contracts/registry.js";
import { loadPluginManifestRegistry } from "../../../src/plugins/manifest-registry.js";

type PluginRegistrationContractParams = {
  pluginId: string;
  providerIds?: string[];
  webFetchProviderIds?: string[];
  webSearchProviderIds?: string[];
  toolNames?: string[];
  manifestAuthChoice?: {
    pluginId: string;
    choiceId: string;
    choiceLabel: string;
    groupId: string;
    groupLabel: string;
    groupHint: string;
  };
};

function findRegistration(pluginId: string) {
  const entry = pluginRegistrationContractRegistry.find(
    (candidate) => candidate.pluginId === pluginId,
  );
  if (!entry) {
    throw new Error(`plugin registration contract missing for ${pluginId}`);
  }
  return entry;
}

export function describePluginRegistrationContract(params: PluginRegistrationContractParams) {
  describe(`${params.pluginId} plugin registration contract`, () => {
    if (params.providerIds) {
      it("keeps bundled provider ownership explicit", () => {
        expect(findRegistration(params.pluginId).providerIds).toEqual(params.providerIds);
      });
    }

    if (params.webSearchProviderIds) {
      it("keeps bundled web search ownership explicit", () => {
        expect(findRegistration(params.pluginId).webSearchProviderIds).toEqual(
          params.webSearchProviderIds,
        );
      });
    }

    if (params.webFetchProviderIds) {
      it("keeps bundled web fetch ownership explicit", () => {
        expect(findRegistration(params.pluginId).webFetchProviderIds).toEqual(
          params.webFetchProviderIds,
        );
      });
    }

    if (params.toolNames) {
      it("keeps bundled tool ownership explicit", () => {
        expect(findRegistration(params.pluginId).toolNames).toEqual(params.toolNames);
      });
    }

    const manifestAuthChoice = params.manifestAuthChoice;
    if (manifestAuthChoice) {
      it("keeps onboarding auth grouping explicit", () => {
        const plugin = loadPluginManifestRegistry({}).plugins.find(
          (entry) => entry.origin === "bundled" && entry.id === manifestAuthChoice.pluginId,
        );

        expect(plugin?.providerAuthChoices).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              choiceId: manifestAuthChoice.choiceId,
              choiceLabel: manifestAuthChoice.choiceLabel,
              groupId: manifestAuthChoice.groupId,
              groupLabel: manifestAuthChoice.groupLabel,
              groupHint: manifestAuthChoice.groupHint,
            }),
          ]),
        );
      });
    }
  });
}
