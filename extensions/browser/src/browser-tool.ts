import {
  executeActAction,
  executeConsoleAction,
  executeSnapshotAction,
  executeTabsAction,
} from "./browser-tool.actions.js";
import { resolveBrowserToolRoute, type BrowserToolRouteDeps } from "./browser-tool.router.js";
import { BrowserToolSchema } from "./browser-tool.schema.js";
import type { BrowserActRequest } from "./browser/client-actions-core.js";
import {
  type AnyAgentTool,
  DEFAULT_UPLOAD_DIR,
  imageResultFromFile,
  jsonResult,
  loadConfig,
  readStringParam,
  resolveBrowserConfig,
  resolveExistingPathsWithinRoot,
} from "./core-api.js";
import { tryExecutePinchTabHostAction } from "./pinchtab/pinchtab-executor.js";
import { resolvePinchTabConnectionConfig } from "./pinchtab/pinchtab-managed-service.js";

const browserToolDeps = {
  imageResultFromFile,
  loadConfig,
};

export const __testing = {
  setDepsForTest(
    overrides: Partial<{
      imageResultFromFile: typeof imageResultFromFile;
      loadConfig: typeof loadConfig;
    }> | null,
  ) {
    browserToolDeps.imageResultFromFile = overrides?.imageResultFromFile ?? imageResultFromFile;
    browserToolDeps.loadConfig = overrides?.loadConfig ?? loadConfig;
  },
};

function readOptionalTargetAndTimeout(params: Record<string, unknown>) {
  const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? params.timeoutMs
      : undefined;
  return { targetId, timeoutMs };
}

function readTargetUrlParam(params: Record<string, unknown>) {
  return (
    readStringParam(params, "targetUrl") ??
    readStringParam(params, "url", { required: true, label: "targetUrl" })
  );
}

function readBatchSteps(params: Record<string, unknown>) {
  return Array.isArray(params.steps)
    ? params.steps.filter(
        (step): step is Record<string, unknown> => !!step && typeof step === "object",
      )
    : [];
}

const LEGACY_BROWSER_ACT_REQUEST_KEYS = [
  "targetId",
  "ref",
  "doubleClick",
  "button",
  "modifiers",
  "text",
  "submit",
  "slowly",
  "key",
  "delayMs",
  "startRef",
  "endRef",
  "values",
  "fields",
  "width",
  "height",
  "timeMs",
  "textGone",
  "selector",
  "url",
  "loadState",
  "fn",
  "timeoutMs",
] as const;

function readActRequestParam(params: Record<string, unknown>) {
  const requestParam = params.request;
  if (requestParam && typeof requestParam === "object") {
    return requestParam as BrowserActRequest;
  }

  const kind = readStringParam(params, "kind");
  if (!kind) {
    return undefined;
  }

  const request: Record<string, unknown> = { kind };
  for (const key of LEGACY_BROWSER_ACT_REQUEST_KEYS) {
    if (!Object.hasOwn(params, key)) {
      continue;
    }
    request[key] = params[key];
  }
  return request as BrowserActRequest;
}

function readConfiguredProfiles() {
  const cfg = browserToolDeps.loadConfig();
  const resolved = resolveBrowserConfig(
    (cfg as { browser?: unknown }).browser as Parameters<typeof resolveBrowserConfig>[0],
    cfg,
  );
  return Object.keys(resolved.profiles ?? {}).map((name) => ({ name }));
}

function readPinchTabConfig() {
  return resolvePinchTabConnectionConfig(browserToolDeps.loadConfig());
}

function resolvePinchTabRouteConfig(params: { routeKind: "host" }) {
  return readPinchTabConfig();
}

async function normalizeExperimentalHostInput(
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (action !== "upload") {
    return params;
  }

  const paths = Array.isArray(params.paths) ? params.paths.map((path) => String(path)) : [];
  if (paths.length === 0) {
    throw new Error("paths required");
  }

  const uploadPathsResult = await resolveExistingPathsWithinRoot({
    rootDir: DEFAULT_UPLOAD_DIR,
    requestedPaths: paths,
    scopeLabel: `uploads directory (${DEFAULT_UPLOAD_DIR})`,
  });
  if (!uploadPathsResult.ok) {
    throw new Error(uploadPathsResult.error);
  }

  return {
    ...params,
    paths: uploadPathsResult.paths,
  };
}

export function createBrowserTool(opts?: {
  allowHostControl?: boolean;
  agentSessionKey?: string;
}): AnyAgentTool {
  const hostHint =
    opts?.allowHostControl === false ? "Host target blocked by policy." : "Host target allowed.";
  const tool: AnyAgentTool = {
    label: "Browser",
    name: "browser",
    description: [
      "Control the browser through CrawClaw's unified browser tool backed by PinchTab.",
      "Browser choice: omit profile by default for the isolated CrawClaw-managed browser (`crawclaw`).",
      'For the logged-in local browser, use profile="user". Use it only when existing logins or cookies matter.',
      'Prefer snapshot + act for UI automation. For stable refs across calls, use snapshot with refs="aria"; the default refs="role" are more human-readable but less stable.',
      "Host routes use PinchTab session/tab execution. Avoid relying on legacy targetId-only workflows for new automation.",
      "target selects browser location (host). Default: host.",
      hostHint,
    ].join(" "),
    parameters: BrowserToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "batch") {
        const steps = readBatchSteps(params);
        if (steps.length === 0) {
          throw new Error("steps required");
        }
        const results: unknown[] = [];
        for (const step of steps) {
          const mergedStep = {
            target: params.target,
            node: params.node,
            profile: params.profile,
            ...step,
          } as Record<string, unknown>;
          const result = await tool.execute?.(_toolCallId, mergedStep);
          results.push({
            action: mergedStep.action,
            details: result?.details ?? null,
          });
        }
        return jsonResult({ ok: true, count: results.length, results });
      }
      const { profile, baseUrl, routeKind, proxyRequest } = await resolveBrowserToolRoute({
        profile: readStringParam(params, "profile") ?? undefined,
        requestedNode: readStringParam(params, "node") ?? undefined,
        target: (readStringParam(params, "target") as "host" | "node" | undefined) ?? undefined,
        allowHostControl: opts?.allowHostControl,
        deps: {
          loadConfig: browserToolDeps.loadConfig as unknown as BrowserToolRouteDeps["loadConfig"],
          resolveBrowserConfig:
            resolveBrowserConfig as unknown as BrowserToolRouteDeps["resolveBrowserConfig"],
        },
      });

      if (!proxyRequest && routeKind === "host") {
        const pinchTab = resolvePinchTabRouteConfig({
          routeKind,
        });
        if (!pinchTab.enabled) {
          throw new Error("PinchTab browser runtime is disabled.");
        }
        if (action === "profiles") {
          return jsonResult({ profiles: readConfiguredProfiles() });
        }
        const pinchTabInput = await normalizeExperimentalHostInput(action, params);
        const pinchTabResult = await tryExecutePinchTabHostAction({
          action,
          input: pinchTabInput,
          profile,
          agentSessionKey: opts?.agentSessionKey,
          baseUrl: pinchTab.baseUrl,
          token: pinchTab.token,
          imageResultFromFile: browserToolDeps.imageResultFromFile,
        });
        if (pinchTabResult) {
          return pinchTabResult;
        }
        throw new Error(`Action "${action}" is not supported by the PinchTab runtime.`);
      }
      if (!proxyRequest) {
        throw new Error(`No browser proxy available for route "${routeKind}".`);
      }

      switch (action) {
        case "status":
          return jsonResult(
            await proxyRequest({
              method: "GET",
              path: "/",
              profile,
            }),
          );
        case "start":
          await proxyRequest({
            method: "POST",
            path: "/start",
            profile,
          });
          return jsonResult(
            await proxyRequest({
              method: "GET",
              path: "/",
              profile,
            }),
          );
        case "stop":
          await proxyRequest({
            method: "POST",
            path: "/stop",
            profile,
          });
          return jsonResult(
            await proxyRequest({
              method: "GET",
              path: "/",
              profile,
            }),
          );
        case "profiles":
          return jsonResult(
            await proxyRequest({
              method: "GET",
              path: "/profiles",
            }),
          );
        case "tabs":
          return await executeTabsAction({ baseUrl, profile, proxyRequest });
        case "open": {
          const targetUrl = readTargetUrlParam(params);
          return jsonResult(
            await proxyRequest({
              method: "POST",
              path: "/tabs/open",
              profile,
              body: { url: targetUrl },
            }),
          );
        }
        case "focus": {
          const targetId = readStringParam(params, "targetId", {
            required: true,
          });
          return jsonResult(
            await proxyRequest({
              method: "POST",
              path: "/tabs/focus",
              profile,
              body: { targetId },
            }),
          );
        }
        case "close": {
          const targetId = readStringParam(params, "targetId");
          return jsonResult(
            targetId
              ? await proxyRequest({
                  method: "DELETE",
                  path: `/tabs/${encodeURIComponent(targetId)}`,
                  profile,
                })
              : await proxyRequest({
                  method: "POST",
                  path: "/act",
                  profile,
                  body: { kind: "close" },
                }),
          );
        }
        case "snapshot":
          return await executeSnapshotAction({
            input: params,
            baseUrl,
            profile,
            proxyRequest,
          });
        case "screenshot": {
          const targetId = readStringParam(params, "targetId");
          const fullPage = Boolean(params.fullPage);
          const ref = readStringParam(params, "ref");
          const element = readStringParam(params, "element");
          const type = params.type === "jpeg" ? "jpeg" : "png";
          const result = (await proxyRequest({
            method: "POST",
            path: "/screenshot",
            profile,
            body: {
              targetId,
              fullPage,
              ref,
              element,
              type,
            },
          })) as { path: string };
          return await browserToolDeps.imageResultFromFile({
            label: "browser:screenshot",
            path: result.path,
            details: result,
          });
        }
        case "navigate": {
          const targetUrl = readTargetUrlParam(params);
          const targetId = readStringParam(params, "targetId");
          return jsonResult(
            await proxyRequest({
              method: "POST",
              path: "/navigate",
              profile,
              body: {
                url: targetUrl,
                targetId,
              },
            }),
          );
        }
        case "console":
          return await executeConsoleAction({
            input: params,
            baseUrl,
            profile,
            proxyRequest,
          });
        case "cookies":
          return jsonResult(
            await proxyRequest({
              method: "GET",
              path: "/cookies",
              profile,
            }),
          );
        case "storage":
          return jsonResult(
            await proxyRequest({
              method: "GET",
              path: "/storage",
              profile,
              query: {
                kind:
                  typeof params.storageKind === "string" && params.storageKind.trim()
                    ? params.storageKind
                    : undefined,
                key: typeof params.key === "string" && params.key.trim() ? params.key : undefined,
              },
            }),
          );
        case "network":
          return jsonResult(
            await proxyRequest({
              method: "GET",
              path: "/network",
              profile,
              query: {
                pattern:
                  typeof params.pattern === "string" && params.pattern.trim()
                    ? params.pattern
                    : undefined,
                resourceType:
                  typeof params.resourceType === "string" && params.resourceType.trim()
                    ? params.resourceType
                    : undefined,
                limit:
                  typeof params.limit === "number" && Number.isFinite(params.limit)
                    ? params.limit
                    : undefined,
              },
            }),
          );
        case "pdf": {
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const result = (await proxyRequest({
            method: "POST",
            path: "/pdf",
            profile,
            body: { targetId },
          })) as { path: string };
          return {
            content: [{ type: "text" as const, text: `FILE:${result.path}` }],
            details: result,
          };
        }
        case "download": {
          const result = (await proxyRequest({
            method: "POST",
            path: "/download",
            profile,
            body: {
              url: typeof params.url === "string" && params.url.trim() ? params.url : undefined,
              filename:
                typeof params.filename === "string" && params.filename.trim()
                  ? params.filename
                  : undefined,
              maxBytes:
                typeof params.maxBytes === "number" && Number.isFinite(params.maxBytes)
                  ? params.maxBytes
                  : undefined,
            },
          })) as { path: string };
          return {
            content: [{ type: "text" as const, text: `FILE:${result.path}` }],
            details: result,
          };
        }
        case "upload": {
          const paths = Array.isArray(params.paths) ? params.paths.map((p) => String(p)) : [];
          if (paths.length === 0) {
            throw new Error("paths required");
          }
          const uploadPathsResult = await resolveExistingPathsWithinRoot({
            rootDir: DEFAULT_UPLOAD_DIR,
            requestedPaths: paths,
            scopeLabel: `uploads directory (${DEFAULT_UPLOAD_DIR})`,
          });
          if (!uploadPathsResult.ok) {
            throw new Error(uploadPathsResult.error);
          }
          const normalizedPaths = uploadPathsResult.paths;
          const ref = readStringParam(params, "ref");
          const inputRef = readStringParam(params, "inputRef");
          const element = readStringParam(params, "element");
          const { targetId, timeoutMs } = readOptionalTargetAndTimeout(params);
          return jsonResult(
            await proxyRequest({
              method: "POST",
              path: "/hooks/file-chooser",
              profile,
              body: {
                paths: normalizedPaths,
                ref,
                inputRef,
                element,
                targetId,
                timeoutMs,
              },
            }),
          );
        }
        case "dialog": {
          const accept = Boolean(params.accept);
          const promptText = typeof params.promptText === "string" ? params.promptText : undefined;
          const { targetId, timeoutMs } = readOptionalTargetAndTimeout(params);
          return jsonResult(
            await proxyRequest({
              method: "POST",
              path: "/hooks/dialog",
              profile,
              body: {
                accept,
                promptText,
                targetId,
                timeoutMs,
              },
            }),
          );
        }
        case "act": {
          const request = readActRequestParam(params);
          if (!request) {
            throw new Error("request required");
          }
          return await executeActAction({
            request,
            baseUrl,
            profile,
            proxyRequest,
          });
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
  return tool;
}
