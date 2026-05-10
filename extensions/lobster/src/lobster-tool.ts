import path from "node:path";
import { runNativePluginOperation } from "crawclaw/plugin-sdk/native-plugin-runtime";
import type { CrawClawPluginApi } from "../runtime-api.js";

const LobsterSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["run", "resume"] },
    pipeline: { type: "string" },
    argsJson: { type: "string" },
    token: { type: "string" },
    approve: { type: "boolean" },
    cwd: {
      type: "string",
      description:
        "Relative working directory (optional). Must stay within the gateway working directory.",
    },
    timeoutMs: { type: "number" },
    maxStdoutBytes: { type: "number" },
  },
  required: ["action"],
  additionalProperties: true,
};

type LobsterToolResult = {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
};

function normalizeForCwdSandbox(p: string): string {
  const normalized = path.normalize(p);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveCwd(cwdRaw: unknown): string {
  if (typeof cwdRaw !== "string" || !cwdRaw.trim()) {
    return process.cwd();
  }
  const cwd = cwdRaw.trim();
  if (path.isAbsolute(cwd)) {
    throw new Error("cwd must be a relative path");
  }
  const base = process.cwd();
  const resolved = path.resolve(base, cwd);

  const rel = path.relative(normalizeForCwdSandbox(base), normalizeForCwdSandbox(resolved));
  if (rel === "" || rel === ".") {
    return resolved;
  }
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("cwd must stay within the gateway working directory");
  }
  return resolved;
}

export function createLobsterTool(api: CrawClawPluginApi) {
  return {
    name: "lobster",
    label: "Lobster Workflow",
    description:
      "Run Lobster pipelines as a local-first workflow runtime (typed JSON envelope + resumable approvals).",
    parameters: LobsterSchema,
    async execute(_id: string, params: Record<string, unknown>) {
      if (api.runtime?.version && api.logger?.debug) {
        api.logger.debug(`lobster plugin runtime=${api.runtime.version}`);
      }
      const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 20_000;
      return await runNativePluginOperation<LobsterToolResult>({
        plugin: "lobster",
        operation: "execute",
        input: {
          params,
          cwd: resolveCwd(params.cwd),
        },
        timeoutMs,
      });
    },
  };
}
