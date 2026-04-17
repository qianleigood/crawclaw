import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { jsonResult, resolvePreferredCrawClawTmpDir, wrapExternalContent } from "../core-api.js";
import { createPinchTabClient, type PinchTabClient } from "./pinchtab-client.js";
import {
  clearPinchTabSessionState,
  getPinchTabSessionState,
  updatePinchTabSessionState,
} from "./pinchtab-state.js";

type PinchTabExecutorDeps = {
  createClient: typeof createPinchTabClient;
};

const pinchTabExecutorDeps: PinchTabExecutorDeps = {
  createClient: createPinchTabClient,
};

export const __testing = {
  setDepsForTest(overrides: Partial<PinchTabExecutorDeps> | null) {
    pinchTabExecutorDeps.createClient = overrides?.createClient ?? createPinchTabClient;
  },
};

function sanitizeSessionPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveSessionName(params: { agentSessionKey?: string; profile?: string }) {
  const base = sanitizeSessionPart(params.agentSessionKey ?? "main") || "main";
  const profile = sanitizeSessionPart(params.profile ?? "default") || "default";
  return `host:${base}:${profile}`;
}

function buildTmpPath(ext: string) {
  return path.join(
    resolvePreferredCrawClawTmpDir(),
    `crawclaw-pinchtab-${crypto.randomUUID()}.${ext}`,
  );
}

function unwrapEvalPayload<T>(value: Record<string, unknown> | null | undefined): T | null {
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

function wrapExternalJson(payload: unknown, kind: string): AgentToolResult<unknown> {
  const extractedText = JSON.stringify(payload, null, 2);
  return {
    content: [
      {
        type: "text",
        text: wrapExternalContent(extractedText, {
          source: "browser",
          includeWarning: false,
        }),
      },
    ],
    details: {
      ok: true,
      externalContent: {
        untrusted: true,
        source: "browser",
        kind,
        wrapped: true,
      },
    },
  };
}

async function ensureProfileId(client: PinchTabClient, profileName: string) {
  const profiles = await client.listProfiles();
  const matched = profiles.find((entry) => entry.name === profileName || entry.id === profileName);
  if (matched?.id && typeof matched.id === "string") {
    return matched.id;
  }
  const created = await client.createProfile({ name: profileName });
  if (typeof created.id !== "string" || !created.id.trim()) {
    throw new Error(`PinchTab profile creation failed for "${profileName}".`);
  }
  return created.id;
}

async function ensureSessionRuntime(params: {
  client: PinchTabClient;
  sessionName: string;
  profile?: string;
}) {
  const current = getPinchTabSessionState(params.sessionName);
  if (current.instanceId) {
    return current;
  }

  const profileName =
    params.profile && params.profile !== "default" && params.profile !== "crawclaw"
      ? params.profile
      : undefined;
  const profileId = profileName ? await ensureProfileId(params.client, profileName) : undefined;
  const started = await params.client.startInstance({ profileId });
  const instanceId =
    typeof started.id === "string"
      ? started.id
      : typeof started.instanceId === "string"
        ? started.instanceId
        : null;
  if (!instanceId) {
    throw new Error("PinchTab instance start failed.");
  }
  return updatePinchTabSessionState(params.sessionName, { instanceId, profileId });
}

async function ensureTabId(params: {
  client: PinchTabClient;
  sessionName: string;
  profile?: string;
}) {
  const state = await ensureSessionRuntime(params);
  if (state.tabId) {
    return { ...state, tabId: state.tabId };
  }
  const tabs = await params.client.listTabs(state.instanceId!);
  const first = tabs.find((entry) => typeof entry.id === "string");
  if (first?.id && typeof first.id === "string") {
    return updatePinchTabSessionState(params.sessionName, { tabId: first.id });
  }
  throw new Error("No active PinchTab tab. Open a page first.");
}

function mapActRequestToPinchTab(request: Record<string, unknown>) {
  const kind = typeof request.kind === "string" ? request.kind : "";
  switch (kind) {
    case "click":
      return typeof request.ref === "string" ? { kind: "click", ref: request.ref } : null;
    case "type":
      return typeof request.ref === "string" && typeof request.text === "string"
        ? { kind: "type", ref: request.ref, text: request.text }
        : null;
    case "press":
      return typeof request.key === "string" ? { kind: "press", key: request.key } : null;
    case "hover":
      return typeof request.ref === "string" ? { kind: "hover", ref: request.ref } : null;
    case "select":
      return typeof request.ref === "string" && Array.isArray(request.values) && request.values[0]
        ? { kind: "select", ref: request.ref, text: String(request.values[0]) }
        : null;
    case "fill":
      if (Array.isArray(request.fields) && request.fields.length > 0) {
        const actions = request.fields
          .map((field) => {
            if (!field || typeof field !== "object") {
              return null;
            }
            const ref =
              typeof (field as Record<string, unknown>).ref === "string"
                ? (field as Record<string, unknown>).ref
                : null;
            const text =
              typeof (field as Record<string, unknown>).text === "string"
                ? (field as Record<string, unknown>).text
                : typeof (field as Record<string, unknown>).value === "string"
                  ? (field as Record<string, unknown>).value
                  : null;
            return ref && text != null ? { kind: "fill", ref, text } : null;
          })
          .filter((entry): entry is { kind: string; ref: string; text: string } => entry !== null);
        return actions.length > 0 ? actions : null;
      }
      return typeof request.ref === "string" && typeof request.text === "string"
        ? { kind: "fill", ref: request.ref, text: request.text }
        : null;
    default:
      return null;
  }
}

export async function tryExecutePinchTabHostAction(params: {
  action: string;
  input: Record<string, unknown>;
  profile?: string;
  agentSessionKey?: string;
  baseUrl: string;
  token?: string;
  imageResultFromFile: (input: {
    label: string;
    path: string;
    extraText?: string;
    details?: Record<string, unknown>;
  }) => Promise<AgentToolResult<unknown>>;
}): Promise<AgentToolResult<unknown> | null> {
  const client = pinchTabExecutorDeps.createClient({
    baseUrl: params.baseUrl,
    token: params.token,
  });
  const sessionName = resolveSessionName({
    agentSessionKey: params.agentSessionKey,
    profile: params.profile,
  });

  switch (params.action) {
    case "status": {
      const health = await client.health();
      const state = getPinchTabSessionState(sessionName);
      return jsonResult({
        ok: true,
        running: Boolean(state.instanceId),
        session: sessionName,
        instanceId: state.instanceId,
        tabId: state.tabId,
        health,
      });
    }
    case "start": {
      const state = await ensureSessionRuntime({ client, sessionName, profile: params.profile });
      return jsonResult({
        ok: true,
        running: true,
        session: sessionName,
        instanceId: state.instanceId,
      });
    }
    case "stop": {
      const state = getPinchTabSessionState(sessionName);
      if (state.instanceId) {
        await client.stopInstance(state.instanceId);
      }
      clearPinchTabSessionState(sessionName);
      return jsonResult({ ok: true, running: false, session: sessionName });
    }
    case "open": {
      const targetUrl =
        typeof (params.input.targetUrl ?? params.input.url) === "string"
          ? String(params.input.targetUrl ?? params.input.url).trim()
          : "";
      if (!targetUrl) {
        throw new Error("targetUrl required");
      }
      const state = await ensureSessionRuntime({ client, sessionName, profile: params.profile });
      const opened = await client.openTab(state.instanceId!, targetUrl);
      const tabId =
        typeof opened.id === "string"
          ? opened.id
          : typeof opened.tabId === "string"
            ? opened.tabId
            : null;
      if (!tabId) {
        throw new Error("PinchTab open tab failed.");
      }
      updatePinchTabSessionState(sessionName, { tabId });
      return jsonResult({
        ok: true,
        session: sessionName,
        instanceId: state.instanceId,
        tabId,
        url: targetUrl,
      });
    }
    case "navigate": {
      const targetUrl =
        typeof (params.input.targetUrl ?? params.input.url) === "string"
          ? String(params.input.targetUrl ?? params.input.url).trim()
          : "";
      if (!targetUrl) {
        throw new Error("targetUrl required");
      }
      const state = await ensureTabId({ client, sessionName, profile: params.profile });
      const result = await client.runAction(state.tabId!, { kind: "navigate", url: targetUrl });
      return jsonResult({
        ok: true,
        session: sessionName,
        instanceId: state.instanceId,
        tabId: state.tabId,
        url: targetUrl,
        result,
      });
    }
    case "tabs": {
      const state = await ensureSessionRuntime({ client, sessionName, profile: params.profile });
      const tabs = await client.listTabs(state.instanceId!);
      return wrapExternalJson({ tabs }, "tabs");
    }
    case "focus": {
      const targetId =
        typeof params.input.targetId === "string" && params.input.targetId.trim()
          ? params.input.targetId.trim()
          : null;
      if (targetId) {
        updatePinchTabSessionState(sessionName, { tabId: targetId });
        return jsonResult({ ok: true, session: sessionName, tabId: targetId });
      }
      if (typeof params.input.ref === "string" && params.input.ref.trim()) {
        const state = await ensureTabId({ client, sessionName, profile: params.profile });
        const result = await client.runAction(state.tabId!, {
          kind: "focus",
          ref: params.input.ref,
        });
        return jsonResult({ ok: true, session: sessionName, tabId: state.tabId, result });
      }
      return null;
    }
    case "close": {
      const state = getPinchTabSessionState(sessionName);
      const targetId =
        typeof params.input.targetId === "string" && params.input.targetId.trim()
          ? params.input.targetId.trim()
          : state.tabId;
      if (!targetId) {
        return jsonResult({ ok: true, session: sessionName });
      }
      await client.closeTab(targetId);
      if (state.tabId === targetId) {
        updatePinchTabSessionState(sessionName, { tabId: undefined });
      }
      return jsonResult({ ok: true, session: sessionName, tabId: targetId });
    }
    case "snapshot": {
      const state = await ensureTabId({ client, sessionName, profile: params.profile });
      const snapshot = await client.getSnapshot(state.tabId!);
      const wrapped = wrapExternalContent(JSON.stringify(snapshot, null, 2), {
        source: "browser",
        includeWarning: true,
      });
      return {
        content: [{ type: "text", text: wrapped }],
        details: {
          ok: true,
          session: sessionName,
          instanceId: state.instanceId,
          tabId: state.tabId,
        },
      };
    }
    case "screenshot": {
      const state = await ensureTabId({ client, sessionName, profile: params.profile });
      const outputPath = buildTmpPath("png");
      const data = await client.getScreenshot(state.tabId!);
      await fs.writeFile(outputPath, data);
      return await params.imageResultFromFile({
        label: "browser:screenshot",
        path: outputPath,
        details: { ok: true, path: outputPath, session: sessionName, tabId: state.tabId },
      });
    }
    case "pdf": {
      const state = await ensureTabId({ client, sessionName, profile: params.profile });
      const outputPath = buildTmpPath("pdf");
      const data = await client.getPdf(state.tabId!);
      await fs.writeFile(outputPath, data);
      return {
        content: [{ type: "text", text: `FILE:${outputPath}` }],
        details: { ok: true, path: outputPath, session: sessionName, tabId: state.tabId },
      };
    }
    case "cookies": {
      const state = await ensureTabId({ client, sessionName, profile: params.profile });
      const cookies = await client.getCookies(state.tabId!);
      return wrapExternalJson(cookies, "cookies");
    }
    case "storage":
    case "network":
    case "download":
    case "console": {
      const state = await ensureSessionRuntime({ client, sessionName, profile: params.profile });
      const expression =
        params.action === "storage"
          ? `JSON.stringify((() => { const mode = ${JSON.stringify(
              params.input.storageKind === "session" ? "session" : "local",
            )}; const target = mode === "session" ? window.sessionStorage : window.localStorage; const key = ${JSON.stringify(
              typeof params.input.key === "string" ? params.input.key : null,
            )}; const values = {}; if (key) { values[key] = target.getItem(key); } else { for (let i = 0; i < target.length; i += 1) { const k = target.key(i); if (k) values[k] = target.getItem(k); } } return { kind: mode, values }; })())`
          : params.action === "network"
            ? `JSON.stringify((() => ({ entries: performance.getEntriesByType("resource").slice(-${JSON.stringify(
                typeof params.input.limit === "number"
                  ? Math.max(1, Math.floor(params.input.limit))
                  : 20,
              )}).map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType, duration: entry.duration })) }))())`
            : params.action === "download"
              ? `fetch(${JSON.stringify(
                  typeof params.input.url === "string" && params.input.url.trim()
                    ? params.input.url.trim()
                    : null,
                )} || window.location.href, { credentials: "include" }).then(async (res) => { const bytes = new Uint8Array(await res.arrayBuffer()); let binary = ""; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) { binary += String.fromCharCode(...bytes.slice(i, i + chunk)); } return JSON.stringify({ ok: res.ok, url: res.url, status: res.status, base64: btoa(binary), contentType: res.headers.get("content-type") || undefined }); })`
              : `JSON.stringify({ messages: [] })`;
      const evaluated = unwrapEvalPayload<Record<string, unknown>>(
        await client.evaluate(state.instanceId!, expression),
      );
      if (params.action === "download") {
        const payload = evaluated ?? {};
        const outputPath = buildTmpPath("bin");
        if (typeof payload.base64 !== "string" || !payload.base64) {
          throw new Error("PinchTab download failed.");
        }
        await fs.writeFile(outputPath, Buffer.from(payload.base64, "base64"));
        return {
          content: [{ type: "text", text: `FILE:${outputPath}` }],
          details: {
            ok: payload.ok !== false,
            path: outputPath,
            url: payload.url,
            status: payload.status,
          },
        };
      }
      return wrapExternalJson(evaluated ?? {}, params.action);
    }
    case "upload": {
      const state = await ensureTabId({ client, sessionName, profile: params.profile });
      const ref =
        typeof params.input.ref === "string" && params.input.ref.trim() ? params.input.ref : null;
      const paths = Array.isArray(params.input.paths)
        ? params.input.paths.filter(Boolean).map(String)
        : [];
      if (!ref || paths.length === 0) {
        return null;
      }
      const result = await client.runAction(state.tabId!, { kind: "upload", ref, paths });
      return jsonResult({ ok: true, session: sessionName, result });
    }
    case "dialog": {
      const state = await ensureTabId({ client, sessionName, profile: params.profile });
      const result = await client.runAction(state.tabId!, {
        kind: "dialog",
        accept: params.input.accept === true,
        promptText: params.input.promptText,
      });
      return jsonResult({ ok: true, session: sessionName, result });
    }
    case "act": {
      const request =
        params.input.request && typeof params.input.request === "object"
          ? (params.input.request as Record<string, unknown>)
          : params.input;
      const mapped = mapActRequestToPinchTab(request);
      if (!mapped) {
        return null;
      }
      const state = await ensureTabId({ client, sessionName, profile: params.profile });
      if (Array.isArray(mapped)) {
        const results = [];
        for (const action of mapped) {
          results.push(await client.runAction(state.tabId!, action));
        }
        return jsonResult({ ok: true, session: sessionName, tabId: state.tabId, results });
      }
      const result = await client.runAction(state.tabId!, mapped);
      return jsonResult({ ok: true, session: sessionName, tabId: state.tabId, result });
    }
    default:
      return null;
  }
}
