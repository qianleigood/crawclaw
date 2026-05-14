import type { CrawClawConfig } from "../../../config/config.js";
import type {
  SessionBindingCapabilities,
  SessionBindingRecord,
} from "../../../infra/outbound/session-binding-service.js";
import { listBundledChannelPlugins } from "../bundled.js";
import type { ChannelPlugin } from "../types.js";
import type { ChannelPluginSurface } from "./manifest.js";

type PluginContractEntry = {
  id: string;
  plugin: Pick<ChannelPlugin, "id" | "meta" | "capabilities" | "config">;
};

type ActionsContractEntry = {
  id: string;
  plugin: Pick<ChannelPlugin, "id" | "actions">;
  unsupportedAction?: string;
  cases: Array<{
    name: string;
    cfg: CrawClawConfig;
    expectedActions: string[];
    expectedCapabilities?: string[];
    beforeTest?: () => void;
  }>;
};

type SetupContractEntry = {
  id: string;
  plugin: Pick<ChannelPlugin, "id" | "config" | "setup">;
  cases: Array<{
    name: string;
    cfg: CrawClawConfig;
    accountId?: string;
    input: Record<string, unknown>;
  }>;
};

type StatusContractEntry = {
  id: string;
  plugin: Pick<ChannelPlugin, "id" | "config" | "status">;
  cases: Array<{
    name: string;
    cfg: CrawClawConfig;
    accountId?: string;
    runtime?: Record<string, unknown>;
    probe?: unknown;
  }>;
};

type SurfaceContractEntry = {
  id: string;
  plugin: Pick<
    ChannelPlugin,
    | "id"
    | "actions"
    | "setup"
    | "status"
    | "outbound"
    | "messaging"
    | "threading"
    | "directory"
    | "gateway"
  >;
  surfaces: readonly ChannelPluginSurface[];
};

type ThreadingContractEntry = {
  id: string;
  plugin: Pick<ChannelPlugin, "id" | "threading">;
};

type DirectoryContractEntry = {
  id: string;
  plugin: Pick<ChannelPlugin, "id" | "directory">;
  coverage: "lookups" | "presence";
  cfg?: CrawClawConfig;
  accountId?: string;
};

type SessionBindingContractEntry = {
  id: string;
  expectedCapabilities: SessionBindingCapabilities;
  getCapabilities: () => SessionBindingCapabilities | Promise<SessionBindingCapabilities>;
  bindAndResolve: () => Promise<SessionBindingRecord>;
  unbindAndVerify: (binding: SessionBindingRecord) => Promise<void>;
  cleanup: () => Promise<void> | void;
};

export const pluginContractRegistry: PluginContractEntry[] = listBundledChannelPlugins().map(
  (plugin) => ({
    id: plugin.id,
    plugin,
  }),
);

export const actionContractRegistry: ActionsContractEntry[] = [];
export const setupContractRegistry: SetupContractEntry[] = [];
export const statusContractRegistry: StatusContractEntry[] = [];
export const surfaceContractRegistry: SurfaceContractEntry[] = listBundledChannelPlugins().map(
  (plugin) => ({
    id: plugin.id,
    plugin,
    surfaces: [],
  }),
);
export const threadingContractRegistry: ThreadingContractEntry[] = [];
export const directoryContractRegistry: DirectoryContractEntry[] = [];
export const sessionBindingContractRegistry: SessionBindingContractEntry[] = [];
