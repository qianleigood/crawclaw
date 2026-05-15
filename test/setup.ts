import { afterAll, afterEach, beforeAll, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...original,
    getOAuthApiKey: () => undefined,
    getOAuthProviders: () => [],
    loginOpenAICodex: vi.fn(),
  };
});

vi.mock("@mariozechner/clipboard", () => ({
  availableFormats: () => [],
  getText: async () => "",
  setText: async () => {},
  hasText: () => false,
  getImageBinary: async () => [],
  getImageBase64: async () => "",
  setImageBinary: async () => {},
  setImageBase64: async () => {},
  hasImage: () => false,
  getHtml: async () => "",
  setHtml: async () => {},
  hasHtml: () => false,
  getRtf: async () => "",
  setRtf: async () => {},
  hasRtf: () => false,
  clear: async () => {},
  watch: () => {},
  callThreadsafeFunction: () => {},
}));

// Ensure Vitest environment is properly set
process.env.VITEST = "true";
// Config validation walks plugin manifests; keep an aggressive cache in tests to avoid
// repeated filesystem discovery across suites/workers.
process.env.CRAWCLAW_PLUGIN_MANIFEST_CACHE_MS ??= "60000";
// Vitest vm forks can load transitive lockfile helpers many times per worker.
// Raise listener budget to avoid noisy MaxListeners warnings and warning-stack overhead.
const TEST_PROCESS_MAX_LISTENERS = 128;
if (process.getMaxListeners() > 0 && process.getMaxListeners() < TEST_PROCESS_MAX_LISTENERS) {
  process.setMaxListeners(TEST_PROCESS_MAX_LISTENERS);
}

import { resetContextWindowCacheForTest } from "../src/agents/context.js";
import { resetModelsJsonReadyCacheForTest } from "../src/agents/models-config.js";
import {
  drainSessionWriteLockStateForTest,
  resetSessionWriteLockStateForTest,
} from "../src/agents/session-write-lock.js";
import { installProcessWarningFilter } from "../src/infra/warning-filter.js";
import { createEmptyPluginRegistry } from "../src/plugins/registry-empty.js";
import type { PluginRegistry } from "../src/plugins/registry.js";
import {
  getActivePluginRegistry,
  releasePinnedPluginChannelRegistry,
  releasePinnedPluginHttpRouteRegistry,
  setActivePluginRegistry,
} from "../src/plugins/runtime.js";
import { cleanupSessionStateForTest } from "../src/test-utils/session-state-cleanup.js";
import { withIsolatedTestHome } from "./test-env.js";

// Set HOME/state isolation before importing any runtime CrawClaw modules.
const testEnv = withIsolatedTestHome();

installProcessWarningFilter();

let materializedDefaultPluginRegistry: PluginRegistry | null = null;

function getDefaultPluginRegistry(): PluginRegistry {
  materializedDefaultPluginRegistry ??= createEmptyPluginRegistry();
  return materializedDefaultPluginRegistry;
}

// Most unit suites never touch the plugin registry. Keep the default test registry
// behind a lazy proxy so those files avoid allocating channel fixtures up front.
const DEFAULT_PLUGIN_REGISTRY = new Proxy({} as PluginRegistry, {
  defineProperty(_target, property, attributes) {
    return Reflect.defineProperty(getDefaultPluginRegistry() as object, property, attributes);
  },
  deleteProperty(_target, property) {
    return Reflect.deleteProperty(getDefaultPluginRegistry() as object, property);
  },
  get(_target, property, receiver) {
    return Reflect.get(getDefaultPluginRegistry() as object, property, receiver);
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(getDefaultPluginRegistry() as object, property);
  },
  has(_target, property) {
    return Reflect.has(getDefaultPluginRegistry() as object, property);
  },
  ownKeys() {
    return Reflect.ownKeys(getDefaultPluginRegistry() as object);
  },
  set(_target, property, value, receiver) {
    return Reflect.set(getDefaultPluginRegistry() as object, property, value, receiver);
  },
});

function installDefaultPluginRegistry(): void {
  releasePinnedPluginHttpRouteRegistry();
  releasePinnedPluginChannelRegistry();
  setActivePluginRegistry(DEFAULT_PLUGIN_REGISTRY, "test:default");
}

beforeAll(() => {
  installDefaultPluginRegistry();
});

afterEach(async () => {
  await cleanupSessionStateForTest();
  resetContextWindowCacheForTest();
  resetModelsJsonReadyCacheForTest();
  resetSessionWriteLockStateForTest();
  if (getActivePluginRegistry() !== DEFAULT_PLUGIN_REGISTRY) {
    installDefaultPluginRegistry();
  }
});

afterAll(async () => {
  await cleanupSessionStateForTest();
  await drainSessionWriteLockStateForTest();
  testEnv.cleanup();
});
