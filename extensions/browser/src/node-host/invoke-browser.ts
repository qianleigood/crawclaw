import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectMime,
  isPersistentBrowserProfileMutation,
  loadConfig,
  normalizeBrowserRequestPath,
  resolveBrowserConfig,
  resolveRequestedBrowserProfile,
} from "../core-api.js";
import { createPinchTabClient } from "../pinchtab/pinchtab-client.js";
import {
  clearPinchTabSessionState,
  getPinchTabSessionState,
  updatePinchTabSessionState,
} from "../pinchtab/pinchtab-state.js";

type BrowserProxyParams = {
  method?: string;
  path?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
};

type BrowserProxyFile = {
  path: string;
  base64: string;
  mimeType?: string;
};

type BrowserProxyResult = {
  result: unknown;
  files?: BrowserProxyFile[];
};

const BROWSER_PROXY_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_BROWSER_PROXY_TIMEOUT_MS = 20_000;
const BROWSER_PROXY_STATUS_TIMEOUT_MS = 750;

export const __testing = {};

function resolvePinchTabConfig() {
  const cfg = loadConfig();
  return {
    baseUrl:
      typeof cfg.browser?.pinchtab?.baseUrl === "string" && cfg.browser.pinchtab.baseUrl.trim()
        ? cfg.browser.pinchtab.baseUrl.trim().replace(/\/$/, "")
        : "http://127.0.0.1:9867",
    token:
      typeof cfg.browser?.pinchtab?.token === "string" && cfg.browser.pinchtab.token.trim()
        ? cfg.browser.pinchtab.token.trim()
        : undefined,
  };
}

function resolvePinchTabNodeSession(profile?: string) {
  return `node:${(profile?.trim() || "default").toLowerCase()}`;
}

function buildPinchTabTempPath(ext: "png" | "pdf" | "bin") {
  return path.join(os.tmpdir(), `crawclaw-pinchtab-${crypto.randomUUID()}.${ext}`);
}

async function ensurePinchTabNodeRuntime(
  client: ReturnType<typeof createPinchTabClient>,
  profile?: string,
) {
  const session = resolvePinchTabNodeSession(profile);
  const state = getPinchTabSessionState(session);
  if (state.instanceId) {
    return { session, state };
  }
  const started = await client.startInstance({});
  const instanceId =
    typeof started.id === "string"
      ? started.id
      : typeof started.instanceId === "string"
        ? started.instanceId
        : null;
  if (!instanceId) {
    throw new Error("PinchTab instance start failed.");
  }
  return { session, state: updatePinchTabSessionState(session, { instanceId }) };
}

async function ensurePinchTabNodeTab(
  client: ReturnType<typeof createPinchTabClient>,
  profile?: string,
) {
  const { session, state } = await ensurePinchTabNodeRuntime(client, profile);
  if (state.tabId) {
    return { session, state };
  }
  const tabs = await client.listTabs(state.instanceId!);
  const first = tabs.find((entry) => typeof entry.id === "string");
  if (!first?.id || typeof first.id !== "string") {
    throw new Error("No active PinchTab tab. Open a page first.");
  }
  return { session, state: updatePinchTabSessionState(session, { tabId: first.id }) };
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

async function tryRunPinchTabProxy(params: {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  profile?: string;
}): Promise<BrowserProxyResult | null> {
  try {
    const body =
      params.body && typeof params.body === "object"
        ? (params.body as Record<string, unknown>)
        : {};
    const query = params.query;
    const pinchTabCfg = resolvePinchTabConfig();
    const client = createPinchTabClient(pinchTabCfg);
    if (params.method === "GET" && params.path === "/") {
      const health = await client.health();
      const state = getPinchTabSessionState(resolvePinchTabNodeSession(params.profile));
      return {
        result: {
          ok: true,
          running: Boolean(state.instanceId),
          instanceId: state.instanceId,
          tabId: state.tabId,
          health,
        },
      };
    }
    if (params.method === "GET" && params.path === "/tabs") {
      const { state } = await ensurePinchTabNodeRuntime(client, params.profile);
      const tabs = await client.listTabs(state.instanceId!);
      return { result: { tabs } };
    }
    if (params.method === "GET" && params.path === "/cookies") {
      const { state } = await ensurePinchTabNodeTab(client, params.profile);
      return { result: await client.getCookies(state.tabId!) };
    }
    if (params.method === "GET" && params.path === "/storage") {
      const { state } = await ensurePinchTabNodeRuntime(client, params.profile);
      const result = unwrapPinchTabEval<Record<string, unknown>>(
        await client.evaluate(
          state.instanceId!,
          `JSON.stringify((() => { const mode = ${JSON.stringify(
            typeof query.kind === "string" && query.kind === "session" ? "session" : "local",
          )}; const target = mode === "session" ? window.sessionStorage : window.localStorage; const key = ${JSON.stringify(
            typeof query.key === "string" ? query.key : null,
          )}; const values = {}; if (key) { values[key] = target.getItem(key); } else { for (let i = 0; i < target.length; i += 1) { const k = target.key(i); if (k) values[k] = target.getItem(k); } } return { kind: mode, values }; })())`,
        ),
      );
      return { result: result ?? { kind: "local", values: {} } };
    }
    if (params.method === "GET" && params.path === "/network") {
      const { state } = await ensurePinchTabNodeRuntime(client, params.profile);
      const limit =
        typeof query.limit === "string" && query.limit.trim()
          ? Math.max(1, Number.parseInt(query.limit, 10) || 20)
          : 20;
      const result = unwrapPinchTabEval<Record<string, unknown>>(
        await client.evaluate(
          state.instanceId!,
          `JSON.stringify((() => ({ entries: performance.getEntriesByType("resource").slice(-${JSON.stringify(
            limit,
          )}).map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType, duration: entry.duration })) }))())`,
        ),
      );
      return { result: result ?? { entries: [] } };
    }
    if (params.method === "GET" && params.path === "/snapshot") {
      const { state } = await ensurePinchTabNodeTab(client, params.profile);
      return { result: await client.getSnapshot(state.tabId!) };
    }
    if (params.method === "GET" && params.path === "/console") {
      return { result: { messages: [] } };
    }
    if (params.method === "POST" && params.path === "/tabs/open") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) {
        throw new Error("url required");
      }
      const { session, state } = await ensurePinchTabNodeRuntime(client, params.profile);
      const opened = await client.openTab(state.instanceId!, url);
      const tabId =
        typeof opened.id === "string"
          ? opened.id
          : typeof opened.tabId === "string"
            ? opened.tabId
            : null;
      if (!tabId) {
        throw new Error("PinchTab open tab failed.");
      }
      updatePinchTabSessionState(session, { tabId });
      return { result: { ok: true, instanceId: state.instanceId, tabId, url } };
    }
    if (params.method === "POST" && params.path === "/navigate") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) {
        throw new Error("url required");
      }
      const { state } = await ensurePinchTabNodeTab(client, params.profile);
      const result = await client.runAction(state.tabId!, { kind: "navigate", url });
      return { result: { ok: true, url, result } };
    }
    if (params.method === "POST" && params.path === "/screenshot") {
      const { state } = await ensurePinchTabNodeTab(client, params.profile);
      const outputPath = buildPinchTabTempPath("png");
      await fsPromises.writeFile(outputPath, await client.getScreenshot(state.tabId!));
      const file = await readBrowserProxyFile(outputPath);
      if (!file) {
        throw new Error("browser proxy file read failed for screenshot output");
      }
      return { result: { ok: true, path: outputPath }, files: [file] };
    }
    if (params.method === "POST" && params.path === "/pdf") {
      const { state } = await ensurePinchTabNodeTab(client, params.profile);
      const outputPath = buildPinchTabTempPath("pdf");
      await fsPromises.writeFile(outputPath, await client.getPdf(state.tabId!));
      const file = await readBrowserProxyFile(outputPath);
      if (!file) {
        throw new Error("browser proxy file read failed for pdf output");
      }
      return { result: { ok: true, path: outputPath }, files: [file] };
    }
    if (params.method === "POST" && params.path === "/download") {
      const { state } = await ensurePinchTabNodeRuntime(client, params.profile);
      const targetUrl = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
      const result = unwrapPinchTabEval<Record<string, unknown>>(
        await client.evaluate(
          state.instanceId!,
          `fetch(${JSON.stringify(targetUrl)} || window.location.href, { credentials: "include" }).then(async (res) => { const bytes = new Uint8Array(await res.arrayBuffer()); let binary = ""; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) { binary += String.fromCharCode(...bytes.slice(i, i + chunk)); } return JSON.stringify({ ok: res.ok, url: res.url, status: res.status, base64: btoa(binary), contentType: res.headers.get("content-type") || undefined }); })`,
        ),
      );
      if (!result?.base64 || typeof result.base64 !== "string") {
        throw new Error("download failed");
      }
      const outputPath = buildPinchTabTempPath("bin");
      await fsPromises.writeFile(outputPath, Buffer.from(result.base64, "base64"));
      const file = await readBrowserProxyFile(outputPath);
      if (!file) {
        throw new Error("browser proxy file read failed for download output");
      }
      return {
        result: {
          ok: result.ok,
          path: outputPath,
          url: result.url,
          status: result.status,
          contentType: result.contentType,
        },
        files: [file],
      };
    }
    if (params.method === "POST" && params.path === "/hooks/dialog") {
      const { state } = await ensurePinchTabNodeTab(client, params.profile);
      return {
        result: await client.runAction(state.tabId!, {
          kind: "dialog",
          accept: body.accept === true,
          promptText: body.promptText,
        }),
      };
    }
    if (params.method === "POST" && params.path === "/hooks/file-chooser") {
      const { state } = await ensurePinchTabNodeTab(client, params.profile);
      const ref = typeof body.ref === "string" ? body.ref.trim() : "";
      const paths = isStringArray(body.paths) ? body.paths : [];
      if (!ref || paths.length === 0) {
        return null;
      }
      return { result: await client.runAction(state.tabId!, { kind: "upload", ref, paths }) };
    }
    if (params.method === "POST" && params.path === "/act") {
      const { state } = await ensurePinchTabNodeTab(client, params.profile);
      if (body.kind === "fill" && Array.isArray(body.fields)) {
        const results = [];
        for (const field of body.fields) {
          if (!field || typeof field !== "object") {
            return null;
          }
          const ref =
            typeof (field as Record<string, unknown>).ref === "string"
              ? String((field as Record<string, unknown>).ref)
              : "";
          const text =
            (field as Record<string, unknown>).value ?? (field as Record<string, unknown>).text;
          if (!ref) {
            return null;
          }
          results.push(await client.runAction(state.tabId!, { kind: "fill", ref, text }));
        }
        return { result: { ok: true, count: results.length } };
      }
      const action = buildBrowserActArgs(body);
      if (!action) {
        return null;
      }
      const mapped =
        action[0] === "dblclick"
          ? { kind: "click", ref: action[1], doubleClick: true }
          : action[0] === "click"
            ? { kind: "click", ref: action[1] }
            : action[0] === "fill"
              ? { kind: "fill", ref: action[1], text: action[2] }
              : action[0] === "type"
                ? { kind: "type", ref: action[1], text: action[2] }
                : action[0] === "hover"
                  ? { kind: "hover", ref: action[1] }
                  : action[0] === "press"
                    ? { kind: "press", key: action[1] }
                    : action[0] === "select"
                      ? { kind: "select", ref: action[1], text: action[2] }
                      : action[0] === "drag"
                        ? { kind: "drag", startRef: action[1], endRef: action[2] }
                        : action[0] === "close"
                          ? { kind: "close" }
                          : action[0] === "eval"
                            ? { kind: "eval", expression: action[1] }
                            : action[0] === "wait"
                              ? { kind: "wait", value: action.slice(1) }
                              : action[0] === "set" && action[1] === "viewport"
                                ? { kind: "resize", width: action[2], height: action[3] }
                                : null;
      if (!mapped) {
        return null;
      }
      return { result: await client.runAction(state.tabId!, mapped) };
    }
    if (params.method === "POST" && params.path === "/stop") {
      const session = resolvePinchTabNodeSession(params.profile);
      const state = getPinchTabSessionState(session);
      if (state.instanceId) {
        await client.stopInstance(state.instanceId);
      }
      clearPinchTabSessionState(session);
      return { result: { ok: true, running: false } };
    }
    if (params.method === "POST" && params.path === "/start") {
      const { state } = await ensurePinchTabNodeRuntime(client, params.profile);
      return { result: { ok: true, running: true, instanceId: state.instanceId } };
    }
    return null;
  } catch {
    return null;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function buildBrowserActArgs(request: Record<string, unknown>): string[] | null {
  const kind = typeof request.kind === "string" ? request.kind : "";
  switch (kind) {
    case "click": {
      const ref = typeof request.ref === "string" ? request.ref.trim() : "";
      if (!ref || typeof request.targetId === "string" || typeof request.selector === "string") {
        return null;
      }
      return [request.doubleClick === true ? "dblclick" : "click", ref];
    }
    case "type": {
      const ref = typeof request.ref === "string" ? request.ref.trim() : "";
      const text = typeof request.text === "string" ? request.text : null;
      if (
        !ref ||
        text == null ||
        typeof request.targetId === "string" ||
        typeof request.selector === "string"
      ) {
        return null;
      }
      return [request.slowly === true ? "type" : "fill", ref, text];
    }
    case "press": {
      const key = typeof request.key === "string" ? request.key.trim() : "";
      return key ? ["press", key] : null;
    }
    case "hover": {
      const ref = typeof request.ref === "string" ? request.ref.trim() : "";
      if (!ref || typeof request.targetId === "string" || typeof request.selector === "string") {
        return null;
      }
      return ["hover", ref];
    }
    case "drag": {
      const startRef = typeof request.startRef === "string" ? request.startRef.trim() : "";
      const endRef = typeof request.endRef === "string" ? request.endRef.trim() : "";
      return startRef && endRef ? ["drag", startRef, endRef] : null;
    }
    case "select": {
      const ref = typeof request.ref === "string" ? request.ref.trim() : "";
      if (!ref || typeof request.targetId === "string" || typeof request.selector === "string") {
        return null;
      }
      return isStringArray(request.values) && request.values.length > 0
        ? ["select", ref, ...request.values]
        : null;
    }
    case "fill": {
      const fields = Array.isArray(request.fields) ? request.fields : [];
      if (fields.length === 0) {
        return null;
      }
      return null;
    }
    case "wait":
      if (typeof request.selector === "string" && request.selector.trim()) {
        return ["wait", request.selector.trim()];
      }
      if (typeof request.timeMs === "number" && Number.isFinite(request.timeMs)) {
        return ["wait", String(Math.max(0, Math.floor(request.timeMs)))];
      }
      if (typeof request.text === "string" && request.text.trim()) {
        return ["wait", "--text", request.text];
      }
      if (typeof request.textGone === "string" && request.textGone.trim()) {
        return [
          "wait",
          "--fn",
          `!document.body?.innerText?.includes(${JSON.stringify(request.textGone)})`,
        ];
      }
      if (typeof request.url === "string" && request.url.trim()) {
        return ["wait", "--url", request.url];
      }
      if (typeof request.loadState === "string" && request.loadState.trim()) {
        return ["wait", "--load", request.loadState];
      }
      if (typeof request.fn === "string" && request.fn.trim()) {
        return ["wait", "--fn", request.fn];
      }
      return null;
    case "evaluate": {
      const fn = typeof request.fn === "string" ? request.fn.trim() : "";
      if (!fn || typeof request.ref === "string" || typeof request.targetId === "string") {
        return null;
      }
      return ["eval", fn];
    }
    case "resize": {
      const width =
        typeof request.width === "number" && Number.isFinite(request.width)
          ? Math.floor(request.width)
          : 0;
      const height =
        typeof request.height === "number" && Number.isFinite(request.height)
          ? Math.floor(request.height)
          : 0;
      return width > 0 && height > 0 ? ["set", "viewport", String(width), String(height)] : null;
    }
    case "close":
      return ["close"];
    default:
      return null;
  }
}

function normalizeProfileAllowlist(raw?: string[]): string[] {
  return Array.isArray(raw) ? raw.map((entry) => entry.trim()).filter(Boolean) : [];
}

function resolveBrowserProxyConfig() {
  const cfg = loadConfig();
  const proxy = cfg.nodeHost?.browserProxy;
  const allowProfiles = normalizeProfileAllowlist(proxy?.allowProfiles);
  const enabled = proxy?.enabled !== false;
  return { enabled, allowProfiles };
}

function isProfileAllowed(params: { allowProfiles: string[]; profile?: string | null }) {
  const { allowProfiles, profile } = params;
  if (!allowProfiles.length) {
    return true;
  }
  if (!profile) {
    return false;
  }
  return allowProfiles.includes(profile.trim());
}

function collectBrowserProxyPaths(payload: unknown): string[] {
  const paths = new Set<string>();
  const obj =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  if (!obj) {
    return [];
  }
  if (typeof obj.path === "string" && obj.path.trim()) {
    paths.add(obj.path.trim());
  }
  if (typeof obj.imagePath === "string" && obj.imagePath.trim()) {
    paths.add(obj.imagePath.trim());
  }
  const download = obj.download;
  if (download && typeof download === "object") {
    const dlPath = (download as Record<string, unknown>).path;
    if (typeof dlPath === "string" && dlPath.trim()) {
      paths.add(dlPath.trim());
    }
  }
  return [...paths];
}

async function readBrowserProxyFile(filePath: string): Promise<BrowserProxyFile | null> {
  const stat = await fsPromises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return null;
  }
  if (stat.size > BROWSER_PROXY_MAX_FILE_BYTES) {
    throw new Error(
      `browser proxy file exceeds ${Math.round(BROWSER_PROXY_MAX_FILE_BYTES / (1024 * 1024))}MB`,
    );
  }
  const buffer = await fsPromises.readFile(filePath);
  const mimeType = await detectMime({ buffer, filePath });
  return { path: filePath, base64: buffer.toString("base64"), mimeType };
}

function decodeParams<T>(raw?: string | null): T {
  if (!raw) {
    throw new Error("INVALID_REQUEST: paramsJSON required");
  }
  return JSON.parse(raw) as T;
}

function resolveBrowserProxyTimeout(timeoutMs?: number): number {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
    ? Math.max(1, Math.floor(timeoutMs))
    : DEFAULT_BROWSER_PROXY_TIMEOUT_MS;
}

export async function runBrowserProxyCommand(paramsJSON?: string | null): Promise<string> {
  const params = decodeParams<BrowserProxyParams>(paramsJSON);
  const pathValue = typeof params.path === "string" ? params.path.trim() : "";
  if (!pathValue) {
    throw new Error("INVALID_REQUEST: path required");
  }
  const proxyConfig = resolveBrowserProxyConfig();
  if (!proxyConfig.enabled) {
    throw new Error("UNAVAILABLE: node browser proxy disabled");
  }
  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";
  const path = normalizeBrowserRequestPath(pathValue);
  const body = params.body;
  const requestedProfile =
    resolveRequestedBrowserProfile({
      query: params.query,
      body,
      profile: params.profile,
    }) ?? "";
  const allowedProfiles = proxyConfig.allowProfiles;
  if (allowedProfiles.length > 0) {
    if (isPersistentBrowserProfileMutation(method, path)) {
      throw new Error(
        "INVALID_REQUEST: browser.proxy cannot mutate persistent browser profiles when allowProfiles is configured",
      );
    }
    if (path !== "/profiles") {
      const profileToCheck = requestedProfile || resolved.defaultProfile;
      if (!isProfileAllowed({ allowProfiles: allowedProfiles, profile: profileToCheck })) {
        throw new Error("INVALID_REQUEST: browser profile not allowed");
      }
    } else if (requestedProfile) {
      if (!isProfileAllowed({ allowProfiles: allowedProfiles, profile: requestedProfile })) {
        throw new Error("INVALID_REQUEST: browser profile not allowed");
      }
    }
  }

  const timeoutMs = resolveBrowserProxyTimeout(params.timeoutMs);
  const query: Record<string, unknown> = {};
  const rawQuery = params.query ?? {};
  for (const [key, value] of Object.entries(rawQuery)) {
    if (value === undefined || value === null) {
      continue;
    }
    query[key] = typeof value === "string" ? value : String(value);
  }
  if (requestedProfile) {
    query.profile = requestedProfile;
  }

  const pinchTabResult = await tryRunPinchTabProxy({
    method,
    path,
    query,
    body,
    profile: requestedProfile || resolved.defaultProfile,
  });
  if (pinchTabResult) {
    return JSON.stringify(pinchTabResult);
  }
  throw new Error(
    `UNAVAILABLE: browser.proxy path not supported by PinchTab runtime: ${method} ${path}`,
  );
}
