import { getPinchTabSessionState } from "../pinchtab/pinchtab-state.js";
import type { BrowserTransport } from "./client.js";
import { resolveProfile } from "./config.js";
import {
  listPinchTabBrowserTabs,
  openPinchTabBrowserTab,
  focusPinchTabBrowserTab,
  closePinchTabBrowserTab,
  startPinchTabBrowser,
  stopPinchTabBrowser,
} from "./routes/pinchtab-backend.js";
import type {
  BrowserRouteContext,
  BrowserServerState,
  BrowserTab,
  ContextOptions,
  ProfileContext,
  ProfileStatus,
} from "./server-context.types.js";

export type { BrowserServerState } from "./server-context.types.js";

function buildProfileContext(state: () => BrowserServerState, profileName: string): ProfileContext {
  const current = state();
  const profile = resolveProfile(current.resolved, profileName);
  if (!profile) {
    const available = Object.keys(current.resolved.profiles).join(", ");
    throw new Error(
      `Profile "${profileName}" not found. Available profiles: ${available || "(none)"}`,
    );
  }
  return {
    profile,
    ensureBrowserAvailable: async () => {
      await startPinchTabBrowser(profile.name);
    },
    ensureTabAvailable: async (targetId?: string): Promise<BrowserTab> => {
      const listed = await listPinchTabBrowserTabs(profile.name);
      const existing =
        (targetId ? listed.tabs.find((tab) => tab.targetId === targetId) : undefined) ??
        listed.tabs[0];
      if (existing) {
        return existing;
      }
      return await openPinchTabBrowserTab(profile.name, "about:blank");
    },
    isHttpReachable: async () => {
      const session = getPinchTabSessionState(`server:${profile.name}`);
      return Boolean(session.instanceId);
    },
    isReachable: async () => {
      const session = getPinchTabSessionState(`server:${profile.name}`);
      return Boolean(session.instanceId);
    },
    listTabs: async () => (await listPinchTabBrowserTabs(profile.name)).tabs,
    openTab: async (url: string) => await openPinchTabBrowserTab(profile.name, url),
    focusTab: async (targetId: string) => {
      await focusPinchTabBrowserTab(profile.name, targetId);
    },
    closeTab: async (targetId: string) => {
      await closePinchTabBrowserTab(profile.name, targetId);
    },
    stopRunningBrowser: async () => {
      const result = await stopPinchTabBrowser(profile.name);
      return { stopped: result.stopped };
    },
    resetProfile: async () => {
      await stopPinchTabBrowser(profile.name);
      return { moved: false, from: "pinchtab-session" };
    },
  };
}

export function createPinchTabBrowserRouteContext(opts: ContextOptions): BrowserRouteContext {
  const state = () => {
    const current = opts.getState();
    if (!current) {
      throw new Error("Browser server not started");
    }
    return current;
  };

  const forProfile = (profileName?: string): ProfileContext => {
    const current = state();
    return buildProfileContext(state, profileName ?? current.resolved.defaultProfile);
  };

  const listProfiles = async (): Promise<ProfileStatus[]> => {
    const current = state();
    const profiles: ProfileStatus[] = [];
    for (const name of Object.keys(current.resolved.profiles).sort((a, b) => a.localeCompare(b))) {
      const profile = resolveProfile(current.resolved, name);
      if (!profile) {
        continue;
      }
      const session = getPinchTabSessionState(`server:${name}`);
      const transport: BrowserTransport = "pinchtab";
      profiles.push({
        name,
        transport,
        cdpPort: null,
        cdpUrl: null,
        color: profile.color,
        driver: "crawclaw",
        running: Boolean(session.instanceId),
        tabCount: 0,
        isDefault: name === current.resolved.defaultProfile,
        isRemote: false,
        missingFromConfig: false,
        reconcileReason: null,
      });
    }
    return profiles;
  };

  return {
    state,
    forProfile,
    listProfiles,
    mapTabError: (err) => ({ status: 500, message: String(err) }),
    ensureBrowserAvailable: async () => {
      await forProfile().ensureBrowserAvailable();
    },
    ensureTabAvailable: async (targetId) => await forProfile().ensureTabAvailable(targetId),
    isHttpReachable: async () => await forProfile().isHttpReachable(),
    isReachable: async () => await forProfile().isReachable(),
    listTabs: async () => await forProfile().listTabs(),
    openTab: async (url) => await forProfile().openTab(url),
    focusTab: async (targetId) => {
      await forProfile().focusTab(targetId);
    },
    closeTab: async (targetId) => {
      await forProfile().closeTab(targetId);
    },
    stopRunningBrowser: async () => await forProfile().stopRunningBrowser(),
    resetProfile: async () => await forProfile().resetProfile(),
  };
}
