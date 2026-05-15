import { expect, it } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import type { WebFetchProviderPlugin, WebSearchProviderPlugin } from "../types.js";

type Lazy<T> = T | (() => T);

function resolveLazy<T>(value: Lazy<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

export function installWebSearchProviderContractSuite(params: {
  provider: Lazy<WebSearchProviderPlugin>;
  credentialValue: Lazy<unknown>;
}) {
  it("satisfies the base web search provider contract", () => {
    const provider = resolveLazy(params.provider);
    const credentialValue = resolveLazy(params.credentialValue);

    expect(provider.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(provider.label.trim()).not.toBe("");
    expect(provider.hint.trim()).not.toBe("");
    expect(provider.placeholder.trim()).not.toBe("");
    expect(provider.signupUrl.startsWith("https://")).toBe(true);
    if (provider.docsUrl) {
      expect(provider.docsUrl.startsWith("http")).toBe(true);
    }

    expect(provider.envVars).toEqual([...new Set(provider.envVars)]);
    expect(provider.envVars.every((entry) => entry.trim().length > 0)).toBe(true);

    const searchConfigTarget: Record<string, unknown> = {};
    provider.setCredentialValue(searchConfigTarget, credentialValue);
    expect(provider.getCredentialValue(searchConfigTarget)).toEqual(credentialValue);

    const config = {
      tools: {
        web: {
          search: {
            provider: provider.id,
            ...searchConfigTarget,
          },
        },
      },
    } as CrawClawConfig;
    const tool = provider.createTool({ config, searchConfig: searchConfigTarget });

    expect(tool).not.toBeNull();
    expect(tool?.description.trim()).not.toBe("");
    expect(tool?.parameters).toEqual(expect.any(Object));
    expect(typeof tool?.execute).toBe("function");
    if (provider.runSetup) {
      expect(typeof provider.runSetup).toBe("function");
    }
  });
}

export function installWebFetchProviderContractSuite(params: {
  provider: Lazy<WebFetchProviderPlugin>;
  credentialValue: Lazy<unknown>;
  pluginId?: string;
}) {
  it("satisfies the base web fetch provider contract", () => {
    const provider = resolveLazy(params.provider);
    const credentialValue = resolveLazy(params.credentialValue);

    expect(provider.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(provider.label.trim()).not.toBe("");
    expect(provider.hint.trim()).not.toBe("");
    expect(provider.placeholder.trim()).not.toBe("");
    expect(provider.signupUrl.startsWith("https://")).toBe(true);
    if (provider.docsUrl) {
      expect(provider.docsUrl.startsWith("http")).toBe(true);
    }

    expect(provider.envVars).toEqual([...new Set(provider.envVars)]);
    expect(provider.envVars.every((entry) => entry.trim().length > 0)).toBe(true);
    expect(provider.credentialPath.trim()).not.toBe("");
    if (provider.inactiveSecretPaths) {
      expect(provider.inactiveSecretPaths).toEqual([...new Set(provider.inactiveSecretPaths)]);
      // Runtime inactive-path classification uses inactiveSecretPaths as the complete list.
      expect(provider.inactiveSecretPaths).toContain(provider.credentialPath);
    }

    const fetchConfigTarget: Record<string, unknown> = {};
    provider.setCredentialValue(fetchConfigTarget, credentialValue);
    expect(provider.getCredentialValue(fetchConfigTarget)).toEqual(credentialValue);

    if (provider.setConfiguredCredentialValue && provider.getConfiguredCredentialValue) {
      const configTarget = {} as CrawClawConfig;
      provider.setConfiguredCredentialValue(configTarget, credentialValue);
      expect(provider.getConfiguredCredentialValue(configTarget)).toEqual(credentialValue);
    }

    if (provider.applySelectionConfig && params.pluginId) {
      const applied = provider.applySelectionConfig({} as CrawClawConfig);
      expect(applied.plugins?.entries?.[params.pluginId]?.enabled).toBe(true);
    }

    const config = {
      tools: {
        web: {
          fetch: {
            provider: provider.id,
            ...fetchConfigTarget,
          },
        },
      },
    } as CrawClawConfig;
    const tool = provider.createTool({ config, fetchConfig: fetchConfigTarget });

    expect(tool).not.toBeNull();
    expect(tool?.description.trim()).not.toBe("");
    expect(tool?.parameters).toEqual(expect.any(Object));
    expect(typeof tool?.execute).toBe("function");
  });
}
