import { loadConfig } from "../../config/config.js";
import { createPinchTabClient } from "../../pinchtab/pinchtab-client.js";
import { resolvePinchTabConnectionConfig } from "../../pinchtab/pinchtab-managed-service.js";
import {
  clearPinchTabSessionState,
  getPinchTabSessionState,
  updatePinchTabSessionState,
} from "../../pinchtab/pinchtab-state.js";
import type { BrowserActRequest } from "../client-actions-core.js";
import type { BrowserStatus, BrowserTab, ProfileStatus } from "../client.js";
import type { BrowserRouteContext } from "../server-context.types.js";

type PinchTabTab = Record<string, unknown>;

function sanitizeSessionPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveSessionName(profileName: string) {
  const profile = sanitizeSessionPart(profileName || "default") || "default";
  return `server:${profile}`;
}

function resolvePinchTabConfig() {
  return resolvePinchTabConnectionConfig(loadConfig());
}

async function createClient() {
  return createPinchTabClient(resolvePinchTabConfig());
}

function toBrowserTab(tab: PinchTabTab): BrowserTab {
  return {
    targetId: typeof tab.id === "string" ? tab.id : typeof tab.tabId === "string" ? tab.tabId : "",
    title: typeof tab.title === "string" ? tab.title : "",
    url: typeof tab.url === "string" ? tab.url : "",
    type: typeof tab.type === "string" ? tab.type : "page",
  };
}

async function ensureProfileId(
  client: ReturnType<typeof createPinchTabClient>,
  profileName: string,
) {
  const profiles = await client.listProfiles();
  const matched = profiles.find((entry) => entry.name === profileName || entry.id === profileName);
  if (typeof matched?.id === "string" && matched.id.trim()) {
    return matched.id;
  }
  const created = await client.createProfile({ name: profileName });
  if (typeof created.id !== "string" || !created.id.trim()) {
    throw new Error(`PinchTab profile creation failed for "${profileName}".`);
  }
  return created.id;
}

async function ensureRuntime(profileName: string) {
  const sessionName = resolveSessionName(profileName);
  const current = getPinchTabSessionState(sessionName);
  const client = await createClient();
  if (current.instanceId) {
    return { client, sessionName, state: current };
  }
  const profileId = await ensureProfileId(client, profileName);
  const started = await client.startInstance({ profileId });
  const instanceId =
    typeof started.id === "string"
      ? started.id
      : typeof started.instanceId === "string"
        ? started.instanceId
        : null;
  if (!instanceId) {
    throw new Error("PinchTab instance start failed.");
  }
  const state = updatePinchTabSessionState(sessionName, { instanceId, profileId });
  return { client, sessionName, state };
}

async function listTabsInternal(profileName: string): Promise<{
  running: boolean;
  sessionName: string;
  instanceId?: string;
  tabs: BrowserTab[];
}> {
  const sessionName = resolveSessionName(profileName);
  const current = getPinchTabSessionState(sessionName);
  if (!current.instanceId) {
    return { running: false, sessionName, tabs: [] };
  }
  const client = await createClient();
  const tabs = (await client.listTabs(current.instanceId)).map(toBrowserTab);
  return {
    running: true,
    sessionName,
    instanceId: current.instanceId,
    tabs,
  };
}

async function ensureSelectedTab(
  profileName: string,
  targetId?: string,
): Promise<{
  client: ReturnType<typeof createPinchTabClient>;
  sessionName: string;
  instanceId: string;
  tab: BrowserTab;
}> {
  const { client, sessionName, state } = await ensureRuntime(profileName);
  const tabs = (await client.listTabs(state.instanceId!)).map(toBrowserTab);
  const tab =
    (targetId ? tabs.find((entry) => entry.targetId === targetId) : undefined) ??
    (state.tabId ? tabs.find((entry) => entry.targetId === state.tabId) : undefined) ??
    tabs[0];
  if (!tab) {
    throw new Error("No active PinchTab tab. Open a page first.");
  }
  updatePinchTabSessionState(sessionName, { tabId: tab.targetId });
  return {
    client,
    sessionName,
    instanceId: state.instanceId!,
    tab,
  };
}

function mapActRequestToPinchTab(request: BrowserActRequest) {
  switch (request.kind) {
    case "click":
      return typeof request.ref === "string" ? { kind: "click", ref: request.ref } : null;
    case "type":
      return typeof request.ref === "string"
        ? { kind: "type", ref: request.ref, text: request.text }
        : null;
    case "press":
      return { kind: "press", key: request.key };
    case "hover":
      return typeof request.ref === "string" ? { kind: "hover", ref: request.ref } : null;
    case "select":
      return typeof request.ref === "string" && request.values[0]
        ? { kind: "select", ref: request.ref, text: String(request.values[0]) }
        : null;
    case "fill": {
      if (request.fields.length === 1) {
        const field = request.fields[0];
        if (field?.ref && typeof field.value === "string") {
          return { kind: "fill", ref: field.ref, text: field.value };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function unwrapPinchTabEval<T>(value: Record<string, unknown> | null | undefined): T | null {
  if (!value) {
    return null;
  }
  const result = value.result;
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as T;
    } catch {
      return result as T;
    }
  }
  return result as T;
}

export async function getPinchTabBrowserStatus(
  ctx: BrowserRouteContext,
  profileName: string,
): Promise<BrowserStatus> {
  const current = ctx.state();
  const profileCtx = ctx.forProfile(profileName);
  const sessionName = resolveSessionName(profileCtx.profile.name);
  const sessionState = getPinchTabSessionState(sessionName);
  const running = Boolean(sessionState.instanceId);
  return {
    enabled: current.resolved.enabled,
    profile: profileCtx.profile.name,
    driver: "crawclaw",
    transport: "pinchtab",
    running,
    cdpReady: running,
    cdpHttp: running,
    pid: null,
    cdpPort: null,
    cdpUrl: null,
    chosenBrowser: running ? "pinchtab" : null,
    detectedBrowser: "pinchtab",
    detectedExecutablePath: null,
    detectError: null,
    color: profileCtx.profile.color,
    headless: current.resolved.headless,
    noSandbox: current.resolved.noSandbox,
    executablePath: null,
  };
}

export async function startPinchTabBrowser(
  profileName: string,
): Promise<{ ok: true; profile: string }> {
  const { state } = await ensureRuntime(profileName);
  if (!state.instanceId) {
    throw new Error("PinchTab instance start failed.");
  }
  return { ok: true, profile: profileName };
}

export async function stopPinchTabBrowser(
  profileName: string,
): Promise<{ ok: true; stopped: boolean; profile: string }> {
  const sessionName = resolveSessionName(profileName);
  const current = getPinchTabSessionState(sessionName);
  if (current.instanceId) {
    const client = await createClient();
    await client.stopInstance(current.instanceId);
    clearPinchTabSessionState(sessionName);
    return { ok: true, stopped: true, profile: profileName };
  }
  return { ok: true, stopped: false, profile: profileName };
}

export async function listPinchTabBrowserTabs(profileName: string) {
  return await listTabsInternal(profileName);
}

export async function openPinchTabBrowserTab(
  profileName: string,
  url: string,
): Promise<BrowserTab> {
  const { client, sessionName, state } = await ensureRuntime(profileName);
  const opened = await client.openTab(state.instanceId!, url);
  const tab = toBrowserTab(opened);
  updatePinchTabSessionState(sessionName, { tabId: tab.targetId });
  return tab;
}

export async function navigatePinchTabBrowserTab(
  profileName: string,
  url: string,
  targetId?: string,
): Promise<{ ok: true; targetId: string; url: string; result: unknown }> {
  const { client, tab } = await ensureSelectedTab(profileName, targetId);
  const result = await client.runAction(tab.targetId, { kind: "navigate", url });
  return { ok: true, targetId: tab.targetId, url, result };
}

export async function snapshotPinchTabBrowserTab(
  profileName: string,
  opts: { targetId?: string; format?: "ai" | "aria" },
): Promise<Record<string, unknown>> {
  const { client, tab } = await ensureSelectedTab(profileName, opts.targetId);
  const snapshot = await client.getSnapshot(tab.targetId);
  if (opts.format === "aria") {
    const nodes = Array.isArray((snapshot as { nodes?: unknown }).nodes)
      ? ((snapshot as { nodes: unknown[] }).nodes as unknown[])
      : [];
    return {
      ok: true,
      format: "aria",
      targetId: tab.targetId,
      url: tab.url,
      nodes,
    };
  }
  return {
    ok: true,
    format: "ai",
    targetId: tab.targetId,
    url: tab.url,
    snapshot:
      typeof (snapshot as { snapshot?: unknown }).snapshot === "string"
        ? (snapshot as { snapshot: string }).snapshot
        : JSON.stringify(snapshot, null, 2),
    refs:
      snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        ? ((snapshot as { refs?: unknown }).refs as
            | Record<string, { role: string; name?: string; nth?: number }>
            | undefined)
        : undefined,
  };
}

export async function screenshotPinchTabBrowserTab(
  profileName: string,
  targetId?: string,
): Promise<{ buffer: Buffer; targetId: string; url: string }> {
  const { client, tab } = await ensureSelectedTab(profileName, targetId);
  const buffer = await client.getScreenshot(tab.targetId);
  return { buffer, targetId: tab.targetId, url: tab.url };
}

export async function pdfPinchTabBrowserTab(
  profileName: string,
  targetId?: string,
): Promise<{ buffer: Buffer; targetId: string; url: string }> {
  const { client, tab } = await ensureSelectedTab(profileName, targetId);
  const buffer = await client.getPdf(tab.targetId);
  return { buffer, targetId: tab.targetId, url: tab.url };
}

export async function actPinchTabBrowserTab(
  profileName: string,
  request: BrowserActRequest,
  targetId?: string,
): Promise<{ ok: true; targetId: string; url?: string; result?: unknown; results?: unknown[] }> {
  if (request.kind === "close") {
    const selected = await ensureSelectedTab(profileName, targetId ?? request.targetId);
    await selected.client.closeTab(selected.tab.targetId);
    if (getPinchTabSessionState(selected.sessionName).tabId === selected.tab.targetId) {
      updatePinchTabSessionState(selected.sessionName, { tabId: undefined });
    }
    return { ok: true, targetId: selected.tab.targetId };
  }
  const mapped = mapActRequestToPinchTab(request);
  if (!mapped) {
    throw new Error(
      `PinchTab action "${request.kind}" is not supported by the unified backend yet.`,
    );
  }
  const selected = await ensureSelectedTab(profileName, targetId ?? request.targetId);
  const result = await selected.client.runAction(selected.tab.targetId, mapped);
  return { ok: true, targetId: selected.tab.targetId, url: selected.tab.url, result };
}

export async function evaluatePinchTabBrowserInstance<T>(
  profileName: string,
  expression: string,
  targetId?: string,
): Promise<{ targetId: string; value: T | null }> {
  const selected = await ensureSelectedTab(profileName, targetId);
  const result = unwrapPinchTabEval<T>(
    await selected.client.evaluate(selected.instanceId, expression),
  );
  return { targetId: selected.tab.targetId, value: result };
}

export async function getPinchTabCookies(profileName: string, targetId?: string) {
  const selected = await ensureSelectedTab(profileName, targetId);
  const result = await selected.client.getCookies(selected.tab.targetId);
  return { targetId: selected.tab.targetId, result };
}

export async function setPinchTabUpload(
  profileName: string,
  paths: string[],
  ref: string,
  targetId?: string,
) {
  const selected = await ensureSelectedTab(profileName, targetId);
  const result = await selected.client.runAction(selected.tab.targetId, {
    kind: "upload",
    ref,
    paths,
  });
  return { ok: true, targetId: selected.tab.targetId, result };
}

export async function armPinchTabDialog(
  profileName: string,
  params: { accept: boolean; promptText?: string; targetId?: string },
) {
  const selected = await ensureSelectedTab(profileName, params.targetId);
  const result = await selected.client.runAction(selected.tab.targetId, {
    kind: "dialog",
    accept: params.accept,
    promptText: params.promptText,
  });
  return { ok: true, targetId: selected.tab.targetId, result };
}

export async function focusPinchTabBrowserTab(
  profileName: string,
  targetId: string,
): Promise<void> {
  const tabs = await listTabsInternal(profileName);
  if (!tabs.running || !tabs.tabs.some((tab) => tab.targetId === targetId)) {
    throw new Error(`Tab "${targetId}" not found.`);
  }
  updatePinchTabSessionState(resolveSessionName(profileName), { tabId: targetId });
}

export async function closePinchTabBrowserTab(
  profileName: string,
  targetId: string,
): Promise<void> {
  const sessionName = resolveSessionName(profileName);
  const current = getPinchTabSessionState(sessionName);
  if (!current.instanceId) {
    throw new Error("browser not running");
  }
  const client = await createClient();
  await client.closeTab(targetId);
  if (current.tabId === targetId) {
    updatePinchTabSessionState(sessionName, { tabId: undefined });
  }
}

export async function listPinchTabProfiles(ctx: BrowserRouteContext): Promise<ProfileStatus[]> {
  const current = ctx.state();
  const listed = await ctx.listProfiles();
  return listed.map((profile) => {
    const sessionState = getPinchTabSessionState(resolveSessionName(profile.name));
    return {
      ...profile,
      transport: "pinchtab",
      cdpPort: null,
      cdpUrl: null,
      driver: "crawclaw",
      running: Boolean(sessionState.instanceId),
    };
  });
}
