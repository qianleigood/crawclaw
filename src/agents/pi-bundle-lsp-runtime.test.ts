import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearPluginManifestRegistryCache } from "../plugins/manifest-registry.js";
import { createBundleLspToolRuntime } from "./pi-bundle-lsp-runtime.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeClaudeLspBundle(params: {
  workspaceDir: string;
  pluginId: string;
  serverName: string;
  serverConfig: Record<string, unknown>;
}): Promise<void> {
  const pluginRoot = path.join(params.workspaceDir, ".crawclaw", "extensions", params.pluginId);
  await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(pluginRoot, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: params.pluginId }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(pluginRoot, ".lsp.json"),
    `${JSON.stringify(
      {
        lspServers: {
          [params.serverName]: params.serverConfig,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeHoverLspServer(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `let buffer = "";
process.stdin.setEncoding("utf8");
function send(message) {
  const json = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(json) + "\\r\\n\\r\\n" + json);
}
function tryRead() {
  const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
  if (headerEnd === -1) return;
  const header = buffer.slice(0, headerEnd);
  const match = header.match(/Content-Length:\\s*(\\d+)/i);
  if (!match) return;
  const bodyStart = headerEnd + 4;
  const length = Number(match[1]);
  if (Buffer.byteLength(buffer.slice(bodyStart), "utf8") < length) return;
  const body = buffer.slice(bodyStart, bodyStart + length);
  buffer = buffer.slice(bodyStart + length);
  const request = JSON.parse(body);
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { capabilities: { hoverProvider: true } },
    });
  }
}
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  tryRead();
});
`,
    { encoding: "utf8", mode: 0o755 },
  );
}

afterEach(async () => {
  clearPluginManifestRegistryCache();
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("createBundleLspToolRuntime", () => {
  it("skips missing LSP commands without crashing the process", async () => {
    const workspaceDir = await makeTempDir("crawclaw-lsp-missing-");
    await writeClaudeLspBundle({
      workspaceDir,
      pluginId: "lsp-probe",
      serverName: "missingServer",
      serverConfig: { command: "definitely-not-a-crawclaw-lsp-command" },
    });

    const runtime = await createBundleLspToolRuntime({
      workspaceDir,
      cfg: {
        plugins: {
          entries: {
            "lsp-probe": { enabled: true },
          },
        },
      },
    });

    expect(runtime.tools).toEqual([]);
    expect(runtime.sessions).toEqual([]);
  });

  it("uses provider-safe names for LSP tools", async () => {
    const workspaceDir = await makeTempDir("crawclaw-lsp-safe-name-");
    const serverPath = path.join(workspaceDir, "hover-lsp.mjs");
    await writeHoverLspServer(serverPath);
    await writeClaudeLspBundle({
      workspaceDir,
      pluginId: "lsp-probe",
      serverName: "bad server/name",
      serverConfig: { command: "node", args: [serverPath] },
    });

    const runtime = await createBundleLspToolRuntime({
      workspaceDir,
      cfg: {
        plugins: {
          entries: {
            "lsp-probe": { enabled: true },
          },
        },
      },
    });

    try {
      expect(runtime.tools.map((tool) => tool.name)).toEqual(["lsp_hover_bad-server-name"]);
    } finally {
      await runtime.dispose();
    }
  });
});
