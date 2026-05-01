# ComfyUI Management Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a ComfyUI management page that lists saved workflows, links to the native ComfyUI UI, shows recent runs, and shows generated outputs.

**Architecture:** Keep ComfyUI ownership inside `extensions/comfyui`: the plugin persists workflow/run/output metadata and registers plugin-owned gateway methods. The admin page in `.tmp/openclaw-admin` consumes those gateway methods through its existing RPC client, Pinia store, router, i18n, and Naive UI layout. The page does not embed or recreate the ComfyUI graph editor.

**Tech Stack:** TypeScript, Vitest, CrawClaw plugin SDK gateway methods, Vue 3 Composition API, Pinia, Vue Router, Vue I18n, Naive UI.

---

## Implementation Notes

The frontend target is currently the local untracked admin app under `.tmp/openclaw-admin`. Treat those files as the page surface for this implementation, but do not use `scripts/committer` for `.tmp/openclaw-admin/**` unless the user explicitly asks to make that app tracked. Tracked backend/plugin changes still use `scripts/committer`.

The direct gateway run method must require a UI confirmation flag because plugin `before_tool_call` approval only covers the agent tool path. Use `confirmed: true` on `comfyui.workflow.run`; reject missing confirmation before submitting a prompt.

## File Structure

Backend plugin:

- Modify `extensions/comfyui/runtime-api.ts`: export `GatewayRequestHandlerOptions` from the plugin SDK core barrel for typed gateway handlers.
- Modify `extensions/comfyui/src/store.ts`: add workflow listing, workflow detail, run history, and output summary persistence.
- Modify `extensions/comfyui/src/store.test.ts`: cover workflow list normalization, malformed metadata skipping, run history, output summaries, and invalid workflow ids.
- Modify `extensions/comfyui/src/tool.ts`: record run history for saved workflow runs.
- Modify `extensions/comfyui/src/tool.test.ts`: cover run-history persistence on successful saved workflow runs and failed waited runs.
- Create `extensions/comfyui/src/control-plane.ts`: register ComfyUI plugin gateway methods and keep response parsing/confirmation checks in one small file.
- Modify `extensions/comfyui/index.ts`: call `registerComfyUiGatewayMethods(api)`.
- Modify `extensions/comfyui/index.test.ts`: assert gateway methods are registered with read/write scopes and run rejects missing confirmation.

Admin app:

- Create `.tmp/openclaw-admin/src/api/types/comfyui.ts`: typed ComfyUI RPC payloads.
- Modify `.tmp/openclaw-admin/src/api/types/index.ts`: export ComfyUI types.
- Modify `.tmp/openclaw-admin/src/api/rpc-client.ts`: add ComfyUI RPC methods.
- Create `.tmp/openclaw-admin/src/stores/comfyui.ts`: Pinia store for status, workflows, selected detail, runs, outputs, validation, and run action.
- Modify `.tmp/openclaw-admin/src/router/routes.ts`: add the ComfyUI route.
- Modify `.tmp/openclaw-admin/src/components/layout/AppSidebar.vue`: register the ComfyUI icon.
- Modify `.tmp/openclaw-admin/src/i18n/messages/zh-CN.ts`: add Chinese route and page copy.
- Modify `.tmp/openclaw-admin/src/i18n/messages/en-US.ts`: add English route and page copy.
- Create `.tmp/openclaw-admin/src/views/comfyui/ComfyUiPage.vue`: management page.

## Tasks

### Task 1: Persist Workflow Lists, Run History, and Output Summaries

**Files:**

- Modify `extensions/comfyui/src/store.ts`
- Modify `extensions/comfyui/src/store.test.ts`

- [ ] **Step 1: Add failing store tests for workflow listing**

In `extensions/comfyui/src/store.test.ts`, expand imports and add this test inside `describe("workflow artifact store", ...)`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  appendWorkflowRunRecord,
  listWorkflowArtifacts,
  listWorkflowOutputSummaries,
  listWorkflowRunRecords,
  loadWorkflowArtifacts,
  saveWorkflowArtifacts,
} from "./store.js";

it("lists saved workflows with last run and output counts", async () => {
  const workflowsDir = await createTempDir();
  const saved = await saveWorkflowArtifacts({
    workflowsDir,
    ir: imageIrFixture,
    prompt: { "1": { class_type: "Test", inputs: {} } },
    meta: {
      goal: imageIrFixture.goal,
      baseUrl: "http://127.0.0.1:8188",
      catalogFingerprint: "abc",
      mediaKind: "image",
      diagnostics: [],
    },
    now: () => new Date("2026-04-26T00:00:00.000Z"),
  });

  await appendWorkflowRunRecord({
    workflowsDir,
    workflowId: saved.workflowId,
    record: {
      workflowId: saved.workflowId,
      promptId: "prompt-1",
      status: "success",
      startedAt: "2026-04-26T00:01:00.000Z",
      completedAt: "2026-04-26T00:01:02.000Z",
      durationMs: 2000,
      outputs: [
        {
          kind: "image",
          nodeId: "save-image",
          filename: "ComfyUI_00001_.png",
          type: "output",
          localPath: "/tmp/ComfyUI_00001_.png",
        },
      ],
    },
  });

  const workflows = await listWorkflowArtifacts({ workflowsDir });

  expect(workflows).toHaveLength(1);
  expect(workflows[0]).toMatchObject({
    workflowId: saved.workflowId,
    goal: imageIrFixture.goal,
    mediaKind: "image",
    diagnosticsCount: 0,
    outputCount: 1,
    lastRun: {
      promptId: "prompt-1",
      status: "success",
    },
  });
});
```

- [ ] **Step 2: Add failing store tests for malformed metadata and invalid ids**

Add these tests in the same `describe` block:

```ts
it("skips malformed workflow metadata instead of failing the whole list", async () => {
  const workflowsDir = await createTempDir();
  await saveWorkflowArtifacts({
    workflowsDir,
    ir: imageIrFixture,
    prompt: { "1": { class_type: "Test", inputs: {} } },
    meta: {
      goal: imageIrFixture.goal,
      baseUrl: "http://127.0.0.1:8188",
      catalogFingerprint: "abc",
      mediaKind: "image",
      diagnostics: [],
    },
  });
  await writeFile(path.join(workflowsDir, "broken.meta.json"), "{", "utf8");

  const workflows = await listWorkflowArtifacts({ workflowsDir });

  expect(workflows.map((workflow) => workflow.workflowId)).toEqual(["create-a-neon-crab-image"]);
});

it("rejects workflow ids that could escape the workflow root", async () => {
  const workflowsDir = await createTempDir();

  await expect(loadWorkflowArtifacts({ workflowsDir, workflowId: "../outside" })).rejects.toThrow(
    "Invalid ComfyUI workflow id",
  );
});
```

- [ ] **Step 3: Add failing store tests for run and output summaries**

Add this test in the same `describe` block:

```ts
it("lists run records and output summaries newest first", async () => {
  const workflowsDir = await createTempDir();
  const saved = await saveWorkflowArtifacts({
    workflowsDir,
    ir: imageIrFixture,
    prompt: { "1": { class_type: "Test", inputs: {} } },
    meta: {
      goal: imageIrFixture.goal,
      baseUrl: "http://127.0.0.1:8188",
      catalogFingerprint: "abc",
      mediaKind: "image",
      diagnostics: [],
    },
  });

  await appendWorkflowRunRecord({
    workflowsDir,
    workflowId: saved.workflowId,
    record: {
      workflowId: saved.workflowId,
      promptId: "old",
      status: "success",
      startedAt: "2026-04-26T00:00:00.000Z",
      outputs: [],
    },
  });
  await appendWorkflowRunRecord({
    workflowsDir,
    workflowId: saved.workflowId,
    record: {
      workflowId: saved.workflowId,
      promptId: "new",
      status: "success",
      startedAt: "2026-04-26T00:02:00.000Z",
      completedAt: "2026-04-26T00:02:03.000Z",
      durationMs: 3000,
      outputs: [
        {
          kind: "video",
          nodeId: "save-webp",
          filename: "animation.webp",
          mime: "image/webp",
          localPath: "/tmp/animation.webp",
        },
      ],
    },
  });

  await writeFile(path.join(workflowsDir, `${saved.workflowId}.runs.jsonl`), "\nnot-json\n", {
    flag: "a",
  });

  const runs = await listWorkflowRunRecords({ workflowsDir, workflowId: saved.workflowId });
  const outputs = await listWorkflowOutputSummaries({
    workflowsDir,
    workflowId: saved.workflowId,
  });

  expect(runs.map((run) => run.promptId)).toEqual(["new", "old"]);
  expect(outputs).toEqual([
    expect.objectContaining({
      workflowId: saved.workflowId,
      promptId: "new",
      filename: "animation.webp",
      kind: "video",
      status: "success",
    }),
  ]);
});
```

- [ ] **Step 4: Run store tests and verify they fail for missing exports**

Run:

```bash
pnpm test -- extensions/comfyui/src/store.test.ts
```

Expected: FAIL with TypeScript or runtime errors naming `appendWorkflowRunRecord`, `listWorkflowArtifacts`, `listWorkflowRunRecords`, or `listWorkflowOutputSummaries`.

- [ ] **Step 5: Implement store helpers and types**

In `extensions/comfyui/src/store.ts`, add `readdir`, `stat`, and `appendFile` imports:

```ts
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
```

Add these exported types after `SavedWorkflowArtifacts`:

```ts
export type ComfyRunStatus = "queued" | "running" | "success" | "failed" | "timed_out" | "unknown";

export type ComfyRunRecord = {
  workflowId: string;
  promptId: string;
  status: ComfyRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  outputs?: ComfyOutputArtifact[];
};

export type ComfyWorkflowSummary = {
  workflowId: string;
  goal: string;
  baseUrl: string;
  catalogFingerprint: string;
  mediaKind: ComfyMediaKind;
  diagnosticsCount: number;
  createdAt?: string;
  updatedAt?: string;
  promptId?: string;
  outputCount: number;
  lastRun?: ComfyRunRecord;
  paths: SavedWorkflowArtifacts;
};

export type ComfyWorkflowDetail = {
  workflowId: string;
  ir: ComfyGraphIr;
  prompt: ComfyApiPrompt;
  meta: ComfyWorkflowMeta;
  paths: SavedWorkflowArtifacts;
};

export type ComfyOutputSummary = ComfyOutputArtifact & {
  workflowId: string;
  promptId: string;
  status: ComfyRunStatus;
  createdAt?: string;
};
```

Add these helpers before `saveWorkflowArtifacts`:

```ts
function assertWorkflowId(workflowId: string): string {
  const normalized = workflowId.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u.test(normalized)) {
    throw new Error("Invalid ComfyUI workflow id.");
  }
  return normalized;
}

function workflowArtifactPaths(workflowsDir: string, workflowId: string): SavedWorkflowArtifacts {
  const safeWorkflowId = assertWorkflowId(workflowId);
  const prefix = path.join(workflowsDir, safeWorkflowId);
  return {
    workflowId: safeWorkflowId,
    irPath: `${prefix}.ir.json`,
    promptPath: `${prefix}.prompt.json`,
    metaPath: `${prefix}.meta.json`,
  };
}

function runsPath(workflowsDir: string, workflowId: string): string {
  return path.join(workflowsDir, `${assertWorkflowId(workflowId)}.runs.jsonl`);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function maybeStatIso(filePath: string): Promise<string | undefined> {
  try {
    return (await stat(filePath)).mtime.toISOString();
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

function compareIsoDesc(left?: string, right?: string): number {
  return (right ?? "").localeCompare(left ?? "");
}
```

Update `loadWorkflowArtifacts` to use `workflowArtifactPaths`:

```ts
export async function loadWorkflowArtifacts(params: {
  workflowsDir: string;
  workflowId: string;
}): Promise<{ ir: ComfyGraphIr; prompt: ComfyApiPrompt; meta: ComfyWorkflowMeta }> {
  const paths = workflowArtifactPaths(params.workflowsDir, params.workflowId);
  const [ir, prompt, meta] = await Promise.all([
    readJsonFile<ComfyGraphIr>(paths.irPath),
    readJsonFile<ComfyApiPrompt>(paths.promptPath),
    readJsonFile<ComfyWorkflowMeta>(paths.metaPath),
  ]);
  return { ir, prompt, meta };
}
```

Add these exported functions after `loadWorkflowArtifacts`:

```ts
export async function loadWorkflowDetail(params: {
  workflowsDir: string;
  workflowId: string;
}): Promise<ComfyWorkflowDetail> {
  const paths = workflowArtifactPaths(params.workflowsDir, params.workflowId);
  const loaded = await loadWorkflowArtifacts(params);
  return {
    workflowId: paths.workflowId,
    ...loaded,
    paths,
  };
}

export async function appendWorkflowRunRecord(params: {
  workflowsDir: string;
  workflowId: string;
  record: ComfyRunRecord;
}): Promise<void> {
  const workflowId = assertWorkflowId(params.workflowId);
  await mkdir(params.workflowsDir, { recursive: true });
  await appendFile(
    runsPath(params.workflowsDir, workflowId),
    `${JSON.stringify({ ...params.record, workflowId })}\n`,
    "utf8",
  );
}

export async function listWorkflowRunRecords(params: {
  workflowsDir: string;
  workflowId?: string;
  limit?: number;
}): Promise<ComfyRunRecord[]> {
  const limit = params.limit === undefined ? 50 : Math.max(1, Math.trunc(params.limit));
  const files = params.workflowId
    ? [runsPath(params.workflowsDir, params.workflowId)]
    : (
        await readdir(params.workflowsDir, { withFileTypes: true }).catch((err: unknown) => {
          if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
            return [];
          }
          throw err;
        })
      )
        .filter((entry) => entry.isFile() && entry.name.endsWith(".runs.jsonl"))
        .map((entry) => path.join(params.workflowsDir, entry.name));

  const records: ComfyRunRecord[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8").catch((err: unknown) => {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return "";
      }
      throw err;
    });
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as ComfyRunRecord;
        if (parsed.workflowId && parsed.promptId && parsed.startedAt) {
          records.push(parsed);
        }
      } catch {
        continue;
      }
    }
  }
  return records
    .sort((left, right) => compareIsoDesc(left.startedAt, right.startedAt))
    .slice(0, limit);
}

export async function listWorkflowArtifacts(params: {
  workflowsDir: string;
  limit?: number;
}): Promise<ComfyWorkflowSummary[]> {
  const entries = await readdir(params.workflowsDir, { withFileTypes: true }).catch(
    (err: unknown) => {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return [];
      }
      throw err;
    },
  );
  const limit = params.limit === undefined ? 100 : Math.max(1, Math.trunc(params.limit));
  const workflowIds = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".meta.json"))
    .map((entry) => entry.name.slice(0, -".meta.json".length));

  const summaries = await Promise.all(
    workflowIds.map(async (workflowId): Promise<ComfyWorkflowSummary | undefined> => {
      try {
        const paths = workflowArtifactPaths(params.workflowsDir, workflowId);
        const [meta, runs] = await Promise.all([
          readJsonFile<ComfyWorkflowMeta>(paths.metaPath),
          listWorkflowRunRecords({ workflowsDir: params.workflowsDir, workflowId, limit: 1 }),
        ]);
        const lastRun = runs[0];
        const updatedAt = await maybeStatIso(paths.metaPath);
        return {
          workflowId: paths.workflowId,
          goal: meta.goal,
          baseUrl: meta.baseUrl,
          catalogFingerprint: meta.catalogFingerprint,
          mediaKind: meta.mediaKind,
          diagnosticsCount: meta.diagnostics.length,
          createdAt: meta.createdAt,
          updatedAt,
          promptId: meta.promptId,
          outputCount: lastRun?.outputs?.length ?? meta.outputs?.length ?? 0,
          lastRun,
          paths,
        };
      } catch {
        return undefined;
      }
    }),
  );

  return summaries
    .filter((summary): summary is ComfyWorkflowSummary => !!summary)
    .sort((left, right) =>
      compareIsoDesc(
        left.lastRun?.startedAt ?? left.updatedAt ?? left.createdAt,
        right.lastRun?.startedAt ?? right.updatedAt ?? right.createdAt,
      ),
    )
    .slice(0, limit);
}

export async function listWorkflowOutputSummaries(params: {
  workflowsDir: string;
  workflowId?: string;
  limit?: number;
}): Promise<ComfyOutputSummary[]> {
  const runs = await listWorkflowRunRecords(params);
  const outputs = runs.flatMap((run) =>
    (run.outputs ?? []).map((output) => ({
      ...output,
      workflowId: run.workflowId,
      promptId: run.promptId,
      status: run.status,
      createdAt: run.completedAt ?? run.startedAt,
    })),
  );
  const limit = params.limit === undefined ? 50 : Math.max(1, Math.trunc(params.limit));
  return outputs.slice(0, limit);
}
```

- [ ] **Step 6: Run store tests and verify they pass**

Run:

```bash
pnpm test -- extensions/comfyui/src/store.test.ts
```

Expected: PASS for `workflow artifact store`.

- [ ] **Step 7: Commit tracked store changes**

Run:

```bash
FAST_COMMIT=1 scripts/committer "ComfyUI: add workflow history store" extensions/comfyui/src/store.ts extensions/comfyui/src/store.test.ts
```

Expected: commit succeeds. If the working tree contains unrelated changes, confirm the commit output only stages these two paths.

### Task 2: Record Saved Workflow Runs in the Existing Tool

**Files:**

- Modify `extensions/comfyui/src/tool.ts`
- Modify `extensions/comfyui/src/tool.test.ts`

- [ ] **Step 1: Add failing tool test for successful run history**

In `extensions/comfyui/src/tool.test.ts`, add imports for `listWorkflowRunRecords` and use the existing test fixtures/client stubs. Add this test near the `run` action tests:

```ts
it("records a successful run for saved workflow ids", async () => {
  const workspaceDir = await createTempDir();
  const tool = createComfyUiWorkflowTool(
    { workspaceDir },
    {
      createClient: () =>
        createClientStub({
          objectInfo: imageObjectInfoFixture,
          submitPrompt: async () => ({ prompt_id: "prompt-history-success", number: 7 }),
          history: {
            "prompt-history-success": {
              status: { status_str: "success" },
              outputs: {
                "9": {
                  images: [{ filename: "ComfyUI_00001_.png", type: "output" }],
                },
              },
            },
          },
        }),
    },
  );

  const createResult = await tool.execute("create", {
    action: "create",
    goal: imageIrFixture.goal,
    save: true,
  });
  const workflowId = (createResult.details as { workflowId: string }).workflowId;

  await tool.execute("run", {
    action: "run",
    workflowId,
    waitForCompletion: true,
    downloadOutputs: false,
  });

  const runs = await listWorkflowRunRecords({
    workflowsDir: path.join(workspaceDir, ".crawclaw/comfyui/workflows"),
    workflowId,
  });

  expect(runs[0]).toMatchObject({
    workflowId,
    promptId: "prompt-history-success",
    status: "success",
    outputs: [expect.objectContaining({ filename: "ComfyUI_00001_.png" })],
  });
  expect(runs[0]?.durationMs).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: Add failing tool test for failed waited run history**

Add this test next to the previous one:

```ts
it("records a failed waited run when ComfyUI returns a terminal error status", async () => {
  const workspaceDir = await createTempDir();
  const tool = createComfyUiWorkflowTool(
    { workspaceDir },
    {
      createClient: () =>
        createClientStub({
          objectInfo: imageObjectInfoFixture,
          submitPrompt: async () => ({ prompt_id: "prompt-history-failed", number: 8 }),
          history: {
            "prompt-history-failed": {
              status: { status_str: "error" },
              outputs: {},
            },
          },
        }),
    },
  );

  const createResult = await tool.execute("create", {
    action: "create",
    goal: imageIrFixture.goal,
    save: true,
  });
  const workflowId = (createResult.details as { workflowId: string }).workflowId;

  await expect(
    tool.execute("run", {
      action: "run",
      workflowId,
      waitForCompletion: true,
    }),
  ).rejects.toThrow("failed with status: error");

  const runs = await listWorkflowRunRecords({
    workflowsDir: path.join(workspaceDir, ".crawclaw/comfyui/workflows"),
    workflowId,
  });

  expect(runs[0]).toMatchObject({
    workflowId,
    promptId: "prompt-history-failed",
    status: "failed",
    error: expect.stringContaining("failed with status: error"),
  });
});
```

- [ ] **Step 3: Run tool tests and verify they fail for missing run recording**

Run:

```bash
pnpm test -- extensions/comfyui/src/tool.test.ts -t "records"
```

Expected: FAIL because no `.runs.jsonl` record exists.

- [ ] **Step 4: Update `tool.ts` imports and run-input resolution**

In `extensions/comfyui/src/tool.ts`, update the store import:

```ts
import {
  appendWorkflowRunRecord,
  loadWorkflowArtifacts,
  saveWorkflowArtifacts,
  type ComfyRunStatus,
} from "./store.js";
```

Replace `resolveIrForRun` with:

```ts
async function resolveWorkflowForRun(
  params: Record<string, unknown>,
  config: ComfyUiResolvedConfig,
): Promise<{ ir: ComfyGraphIr; workflowId?: string }> {
  if (Object.hasOwn(params, "prompt")) {
    throw new ToolInputError(
      "Raw prompt JSON is not accepted for run; use workflowId or validated graph IR.",
    );
  }
  const workflowId = readStringParam(params, "workflowId");
  if (workflowId) {
    return {
      workflowId,
      ir: (await loadWorkflowArtifacts({ workflowsDir: config.workflowsDir, workflowId })).ir,
    };
  }
  return { ir: requireIr(params.ir) };
}

function runStatusFromError(err: unknown): ComfyRunStatus {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith("Timed out waiting for ComfyUI prompt") ? "timed_out" : "failed";
}
```

- [ ] **Step 5: Record run history in the `run` action**

In the `case "run"` block, replace the first line and wrap the wait/download section with this structure:

```ts
const resolved = await resolveWorkflowForRun(params, config);
const catalog = await loadCatalog(client);
const validation = validateGraphIr(resolved.ir, catalog);
if (!validation.ok) {
  return jsonResult({ ok: false, action, diagnostics: validation.diagnostics });
}
const startedAt = new Date();
const started = await client.submitPrompt(compileGraphIrToPrompt(resolved.ir));
let history: unknown;
let outputs;
try {
  let status: ComfyRunStatus = "queued";
  if (params.waitForCompletion === true || params.downloadOutputs === true) {
    history = await waitForPromptHistory({
      client,
      promptId: started.prompt_id,
      timeoutMs: config.runTimeoutMs,
      pollIntervalMs: config.runPollIntervalMs,
    });
    status = "success";
    outputs = collectOutputArtifacts(started.prompt_id, history);
    if (params.downloadOutputs === true) {
      outputs = await downloadOutputArtifacts({
        client,
        outputDir: config.outputDir,
        promptId: started.prompt_id,
        artifacts: outputs,
      });
    }
  }
  const completedAt =
    params.waitForCompletion === true || params.downloadOutputs === true ? new Date() : undefined;
  if (resolved.workflowId) {
    await appendWorkflowRunRecord({
      workflowsDir: config.workflowsDir,
      workflowId: resolved.workflowId,
      record: {
        workflowId: resolved.workflowId,
        promptId: started.prompt_id,
        status,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt?.toISOString(),
        durationMs: completedAt ? completedAt.getTime() - startedAt.getTime() : undefined,
        outputs,
      },
    });
  }
  return jsonResult({
    ok: true,
    action,
    promptId: started.prompt_id,
    queueNumber: started.number,
    outputs,
  });
} catch (err) {
  if (resolved.workflowId) {
    const completedAt = new Date();
    await appendWorkflowRunRecord({
      workflowsDir: config.workflowsDir,
      workflowId: resolved.workflowId,
      record: {
        workflowId: resolved.workflowId,
        promptId: started.prompt_id,
        status: runStatusFromError(err),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
  throw err;
}
```

- [ ] **Step 6: Run tool tests and verify they pass**

Run:

```bash
pnpm test -- extensions/comfyui/src/tool.test.ts -t "records"
```

Expected: PASS for both run-history tests.

- [ ] **Step 7: Run all ComfyUI plugin tests**

Run:

```bash
pnpm test -- extensions/comfyui
```

Expected: PASS.

- [ ] **Step 8: Commit tracked tool changes**

Run:

```bash
FAST_COMMIT=1 scripts/committer "ComfyUI: record workflow run history" extensions/comfyui/src/tool.ts extensions/comfyui/src/tool.test.ts
```

Expected: commit succeeds and only the two listed paths are staged.

### Task 3: Register Plugin-Owned Gateway Methods

**Files:**

- Modify `extensions/comfyui/runtime-api.ts`
- Create `extensions/comfyui/src/control-plane.ts`
- Modify `extensions/comfyui/index.ts`
- Modify `extensions/comfyui/index.test.ts`

- [ ] **Step 1: Add failing plugin entry tests for gateway method registration and confirmation**

In `extensions/comfyui/index.test.ts`, update the recorder to collect methods:

```ts
const methods: Array<{
  method: string;
  handler: (event: {
    params: Record<string, unknown>;
    respond: (ok: boolean, payload?: unknown) => void;
  }) => unknown;
  opts?: { scope?: string };
}> = [];
```

Add this method to the fake `api`:

```ts
registerGatewayMethod(method: string, handler: unknown, opts?: { scope?: string }) {
  methods.push({
    method,
    handler: handler as (event: {
      params: Record<string, unknown>;
      respond: (ok: boolean, payload?: unknown) => void;
    }) => unknown,
    opts,
  });
},
```

Return `methods` from `createApiRecorder()`, then add these tests:

```ts
it("registers ComfyUI gateway methods with read and write scopes", () => {
  const recorder = createApiRecorder();

  entry.register(recorder.api);

  expect(recorder.methods.map((item) => [item.method, item.opts?.scope])).toEqual([
    ["comfyui.status", "operator.read"],
    ["comfyui.workflows.list", "operator.read"],
    ["comfyui.workflow.get", "operator.read"],
    ["comfyui.runs.list", "operator.read"],
    ["comfyui.outputs.list", "operator.read"],
    ["comfyui.workflow.validate", "operator.read"],
    ["comfyui.workflow.run", "operator.write"],
  ]);
});

it("rejects direct workflow runs unless the UI sent explicit confirmation", async () => {
  const recorder = createApiRecorder();
  entry.register(recorder.api);
  const method = recorder.methods.find((item) => item.method === "comfyui.workflow.run");
  const responses: Array<{ ok: boolean; payload?: unknown }> = [];

  await method?.handler({
    params: { workflowId: "demo" },
    respond: (ok, payload) => responses.push({ ok, payload }),
  });

  expect(responses).toEqual([
    {
      ok: false,
      payload: { error: "confirmed true required before running a ComfyUI workflow" },
    },
  ]);
});
```

- [ ] **Step 2: Run plugin entry tests and verify they fail for missing methods**

Run:

```bash
pnpm test -- extensions/comfyui/index.test.ts
```

Expected: FAIL because no gateway methods are registered.

- [ ] **Step 3: Export gateway handler type from the extension runtime barrel**

In `extensions/comfyui/runtime-api.ts`, add:

```ts
export type { GatewayRequestHandlerOptions } from "crawclaw/plugin-sdk/core";
```

- [ ] **Step 4: Create `control-plane.ts`**

Create `extensions/comfyui/src/control-plane.ts`:

```ts
import { type CrawClawPluginApi, type GatewayRequestHandlerOptions } from "../runtime-api.js";
import { createComfyUiWorkflowTool } from "./tool.js";
import { resolveComfyUiConfig } from "./config.js";
import {
  listWorkflowArtifacts,
  listWorkflowOutputSummaries,
  listWorkflowRunRecords,
  loadWorkflowDetail,
} from "./store.js";

function sendError(respond: GatewayRequestHandlerOptions["respond"], err: unknown): void {
  respond(false, { error: err instanceof Error ? err.message : String(err) });
}

function readWorkflowId(params: Record<string, unknown>): string {
  const workflowId = typeof params.workflowId === "string" ? params.workflowId.trim() : "";
  if (!workflowId) {
    throw new Error("workflowId required");
  }
  return workflowId;
}

function readLimit(params: Record<string, unknown>, fallback: number): number {
  return typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
    ? Math.trunc(params.limit)
    : fallback;
}

async function executeToolAction(api: CrawClawPluginApi, params: Record<string, unknown>) {
  const tool = createComfyUiWorkflowTool(undefined, { pluginConfig: api.pluginConfig });
  const result = await tool.execute("gateway", params);
  return result.details;
}

export function registerComfyUiGatewayMethods(api: CrawClawPluginApi): void {
  const config = () => resolveComfyUiConfig({ pluginConfig: api.pluginConfig });

  api.registerGatewayMethod(
    "comfyui.status",
    async ({ respond }) => {
      try {
        const resolved = config();
        respond(true, {
          baseUrl: resolved.baseUrl,
          workflowsDir: resolved.workflowsDir,
          outputDir: resolved.outputDir,
        });
      } catch (err) {
        sendError(respond, err);
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    "comfyui.workflows.list",
    async ({ params, respond }) => {
      try {
        respond(true, {
          workflows: await listWorkflowArtifacts({
            workflowsDir: config().workflowsDir,
            limit: readLimit(params, 100),
          }),
        });
      } catch (err) {
        sendError(respond, err);
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    "comfyui.workflow.get",
    async ({ params, respond }) => {
      try {
        respond(true, {
          workflow: await loadWorkflowDetail({
            workflowsDir: config().workflowsDir,
            workflowId: readWorkflowId(params),
          }),
        });
      } catch (err) {
        sendError(respond, err);
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    "comfyui.runs.list",
    async ({ params, respond }) => {
      try {
        const workflowId =
          typeof params.workflowId === "string" && params.workflowId.trim()
            ? params.workflowId.trim()
            : undefined;
        respond(true, {
          runs: await listWorkflowRunRecords({
            workflowsDir: config().workflowsDir,
            workflowId,
            limit: readLimit(params, 50),
          }),
        });
      } catch (err) {
        sendError(respond, err);
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    "comfyui.outputs.list",
    async ({ params, respond }) => {
      try {
        const workflowId =
          typeof params.workflowId === "string" && params.workflowId.trim()
            ? params.workflowId.trim()
            : undefined;
        respond(true, {
          outputs: await listWorkflowOutputSummaries({
            workflowsDir: config().workflowsDir,
            workflowId,
            limit: readLimit(params, 50),
          }),
        });
      } catch (err) {
        sendError(respond, err);
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    "comfyui.workflow.validate",
    async ({ params, respond }) => {
      try {
        respond(
          true,
          await executeToolAction(api, {
            action: "validate",
            workflowId: readWorkflowId(params),
          }),
        );
      } catch (err) {
        sendError(respond, err);
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    "comfyui.workflow.run",
    async ({ params, respond }) => {
      try {
        if (params.confirmed !== true) {
          respond(false, { error: "confirmed true required before running a ComfyUI workflow" });
          return;
        }
        respond(
          true,
          await executeToolAction(api, {
            action: "run",
            workflowId: readWorkflowId(params),
            waitForCompletion: params.waitForCompletion === true,
            downloadOutputs: params.downloadOutputs === true,
          }),
        );
      } catch (err) {
        sendError(respond, err);
      }
    },
    { scope: "operator.write" },
  );
}
```

- [ ] **Step 5: Register gateway methods from the plugin entry**

In `extensions/comfyui/index.ts`, import and call the registrar:

```ts
import { registerComfyUiGatewayMethods } from "./src/control-plane.js";
```

Inside `register(api: CrawClawPluginApi)`, before `api.registerTool(...)`, add:

```ts
registerComfyUiGatewayMethods(api);
```

- [ ] **Step 6: Run plugin entry tests and verify they pass**

Run:

```bash
pnpm test -- extensions/comfyui/index.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run ComfyUI plugin tests**

Run:

```bash
pnpm test -- extensions/comfyui
```

Expected: PASS.

- [ ] **Step 8: Commit tracked gateway method changes**

Run:

```bash
FAST_COMMIT=1 scripts/committer "ComfyUI: expose workflow management methods" extensions/comfyui/runtime-api.ts extensions/comfyui/src/control-plane.ts extensions/comfyui/index.ts extensions/comfyui/index.test.ts
```

Expected: commit succeeds and only the listed tracked paths are staged.

### Task 4: Add Admin RPC Types, Client Methods, and Pinia Store

**Files:**

- Create `.tmp/openclaw-admin/src/api/types/comfyui.ts`
- Modify `.tmp/openclaw-admin/src/api/types/index.ts`
- Modify `.tmp/openclaw-admin/src/api/rpc-client.ts`
- Create `.tmp/openclaw-admin/src/stores/comfyui.ts`

- [ ] **Step 1: Create ComfyUI admin API types**

Create `.tmp/openclaw-admin/src/api/types/comfyui.ts`:

```ts
export type ComfyUiMediaKind = "image" | "video" | "audio" | "mixed";
export type ComfyUiOutputKind = "image" | "video" | "audio" | "unknown";
export type ComfyUiRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "timed_out"
  | "unknown";

export interface ComfyUiDiagnostic {
  code: string;
  severity: "error" | "warning";
  nodeId?: string;
  classType?: string;
  field?: string;
  message: string;
  repairHint?: string;
}

export interface ComfyUiOutputArtifact {
  kind: ComfyUiOutputKind;
  nodeId: string;
  filename: string;
  subfolder?: string;
  type?: string;
  mime?: string;
  localPath?: string;
}

export interface ComfyUiRunRecord {
  workflowId: string;
  promptId: string;
  status: ComfyUiRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  outputs?: ComfyUiOutputArtifact[];
}

export interface ComfyUiWorkflowSummary {
  workflowId: string;
  goal: string;
  baseUrl: string;
  catalogFingerprint: string;
  mediaKind: ComfyUiMediaKind;
  diagnosticsCount: number;
  createdAt?: string;
  updatedAt?: string;
  promptId?: string;
  outputCount: number;
  lastRun?: ComfyUiRunRecord;
  paths: {
    workflowId: string;
    irPath: string;
    promptPath: string;
    metaPath: string;
  };
}

export interface ComfyUiWorkflowDetail {
  workflowId: string;
  ir: Record<string, unknown>;
  prompt: Record<string, unknown>;
  meta: {
    goal: string;
    baseUrl: string;
    catalogFingerprint: string;
    mediaKind: ComfyUiMediaKind;
    diagnostics: ComfyUiDiagnostic[];
    createdAt?: string;
    promptId?: string;
    outputs?: ComfyUiOutputArtifact[];
  };
  paths: ComfyUiWorkflowSummary["paths"];
}

export type ComfyUiOutputSummary = ComfyUiOutputArtifact & {
  workflowId: string;
  promptId: string;
  status: ComfyUiRunStatus;
  createdAt?: string;
};

export interface ComfyUiStatus {
  baseUrl: string;
  workflowsDir: string;
  outputDir: string;
}

export interface ComfyUiWorkflowListResult {
  workflows: ComfyUiWorkflowSummary[];
}

export interface ComfyUiWorkflowGetResult {
  workflow: ComfyUiWorkflowDetail;
}

export interface ComfyUiRunsResult {
  runs: ComfyUiRunRecord[];
}

export interface ComfyUiOutputsResult {
  outputs: ComfyUiOutputSummary[];
}

export interface ComfyUiValidationResult {
  ok: boolean;
  action: "validate";
  diagnostics: ComfyUiDiagnostic[];
}

export interface ComfyUiRunResult {
  ok: boolean;
  action: "run";
  promptId?: string;
  queueNumber?: number;
  outputs?: ComfyUiOutputArtifact[];
  diagnostics?: ComfyUiDiagnostic[];
}
```

- [ ] **Step 2: Export ComfyUI types**

In `.tmp/openclaw-admin/src/api/types/index.ts`, add:

```ts
export * from "./comfyui";
```

- [ ] **Step 3: Add type imports in RPC client**

In `.tmp/openclaw-admin/src/api/rpc-client.ts`, extend the existing `import type { ... } from './types'` block with:

```ts
  ComfyUiOutputsResult,
  ComfyUiRunResult,
  ComfyUiRunsResult,
  ComfyUiStatus,
  ComfyUiValidationResult,
  ComfyUiWorkflowGetResult,
  ComfyUiWorkflowListResult,
```

- [ ] **Step 4: Add ComfyUI RPC methods**

In `.tmp/openclaw-admin/src/api/rpc-client.ts`, add this section before `// --- Cron ---`:

```ts
  // --- ComfyUI ---
  getComfyUiStatus(): Promise<ComfyUiStatus> {
    return this.callWithFallback<ComfyUiStatus>(['comfyui.status'], {})
  }

  listComfyUiWorkflows(limit = 100): Promise<ComfyUiWorkflowListResult> {
    return this.callWithFallback<ComfyUiWorkflowListResult>(['comfyui.workflows.list'], { limit })
  }

  getComfyUiWorkflow(workflowId: string): Promise<ComfyUiWorkflowGetResult> {
    return this.callWithFallback<ComfyUiWorkflowGetResult>(['comfyui.workflow.get'], { workflowId })
  }

  listComfyUiRuns(workflowId?: string, limit = 50): Promise<ComfyUiRunsResult> {
    return this.callWithFallback<ComfyUiRunsResult>(
      ['comfyui.runs.list'],
      workflowId ? { workflowId, limit } : { limit }
    )
  }

  listComfyUiOutputs(workflowId?: string, limit = 50): Promise<ComfyUiOutputsResult> {
    return this.callWithFallback<ComfyUiOutputsResult>(
      ['comfyui.outputs.list'],
      workflowId ? { workflowId, limit } : { limit }
    )
  }

  validateComfyUiWorkflow(workflowId: string): Promise<ComfyUiValidationResult> {
    return this.callWithFallback<ComfyUiValidationResult>(['comfyui.workflow.validate'], { workflowId }, 60000)
  }

  runComfyUiWorkflow(workflowId: string): Promise<ComfyUiRunResult> {
    return this.callWithFallback<ComfyUiRunResult>(
      ['comfyui.workflow.run'],
      {
        workflowId,
        confirmed: true,
        waitForCompletion: true,
        downloadOutputs: true,
      },
      960000
    )
  }
```

- [ ] **Step 5: Create the Pinia store**

Create `.tmp/openclaw-admin/src/stores/comfyui.ts`:

```ts
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { useWebSocketStore } from "./websocket";
import type {
  ComfyUiDiagnostic,
  ComfyUiOutputSummary,
  ComfyUiRunRecord,
  ComfyUiRunResult,
  ComfyUiStatus,
  ComfyUiWorkflowDetail,
  ComfyUiWorkflowSummary,
} from "@/api/types";

export const useComfyUiStore = defineStore("comfyui", () => {
  const status = ref<ComfyUiStatus | null>(null);
  const workflows = ref<ComfyUiWorkflowSummary[]>([]);
  const selectedWorkflowId = ref<string | null>(null);
  const selectedWorkflow = ref<ComfyUiWorkflowDetail | null>(null);
  const runs = ref<ComfyUiRunRecord[]>([]);
  const outputs = ref<ComfyUiOutputSummary[]>([]);
  const validationDiagnostics = ref<ComfyUiDiagnostic[]>([]);
  const lastRunResult = ref<ComfyUiRunResult | null>(null);
  const loading = ref(false);
  const detailsLoading = ref(false);
  const runsLoading = ref(false);
  const outputsLoading = ref(false);
  const validating = ref(false);
  const running = ref(false);
  const lastError = ref<string | null>(null);

  const wsStore = useWebSocketStore();

  const selectedSummary = computed(
    () =>
      workflows.value.find((workflow) => workflow.workflowId === selectedWorkflowId.value) || null,
  );

  async function refreshStatus() {
    status.value = await wsStore.rpc.getComfyUiStatus();
  }

  async function fetchWorkflows() {
    const result = await wsStore.rpc.listComfyUiWorkflows();
    workflows.value = result.workflows;
    if (
      selectedWorkflowId.value &&
      !workflows.value.some((workflow) => workflow.workflowId === selectedWorkflowId.value)
    ) {
      selectedWorkflowId.value = null;
      selectedWorkflow.value = null;
      runs.value = [];
      outputs.value = [];
    }
  }

  async function fetchRuns(workflowId?: string) {
    runsLoading.value = true;
    try {
      runs.value = (await wsStore.rpc.listComfyUiRuns(workflowId, 50)).runs;
    } finally {
      runsLoading.value = false;
    }
  }

  async function fetchOutputs(workflowId?: string) {
    outputsLoading.value = true;
    try {
      outputs.value = (await wsStore.rpc.listComfyUiOutputs(workflowId, 50)).outputs;
    } finally {
      outputsLoading.value = false;
    }
  }

  async function refreshOverview() {
    loading.value = true;
    lastError.value = null;
    try {
      await Promise.all([refreshStatus(), fetchWorkflows(), fetchRuns(), fetchOutputs()]);
      if (!selectedWorkflowId.value && workflows.value[0]) {
        await selectWorkflow(workflows.value[0].workflowId);
      } else if (selectedWorkflowId.value) {
        await refreshSelected();
      }
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  async function selectWorkflow(workflowId: string) {
    selectedWorkflowId.value = workflowId;
    await refreshSelected();
  }

  async function refreshSelected() {
    if (!selectedWorkflowId.value) return;
    detailsLoading.value = true;
    lastError.value = null;
    try {
      const workflowId = selectedWorkflowId.value;
      const [detail] = await Promise.all([
        wsStore.rpc.getComfyUiWorkflow(workflowId),
        fetchRuns(workflowId),
        fetchOutputs(workflowId),
      ]);
      selectedWorkflow.value = detail.workflow;
      validationDiagnostics.value = detail.workflow.meta.diagnostics || [];
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error);
    } finally {
      detailsLoading.value = false;
    }
  }

  async function validateSelected() {
    if (!selectedWorkflowId.value) return;
    validating.value = true;
    lastError.value = null;
    try {
      const result = await wsStore.rpc.validateComfyUiWorkflow(selectedWorkflowId.value);
      validationDiagnostics.value = result.diagnostics;
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      validating.value = false;
    }
  }

  async function runSelected() {
    if (!selectedWorkflowId.value) return;
    running.value = true;
    lastError.value = null;
    try {
      lastRunResult.value = await wsStore.rpc.runComfyUiWorkflow(selectedWorkflowId.value);
      await Promise.all([fetchWorkflows(), refreshSelected()]);
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error);
      await Promise.all([fetchWorkflows(), refreshSelected()]);
      throw error;
    } finally {
      running.value = false;
    }
  }

  function openComfyUi() {
    const url =
      status.value?.baseUrl ||
      selectedSummary.value?.baseUrl ||
      selectedWorkflow.value?.meta.baseUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return {
    status,
    workflows,
    selectedWorkflowId,
    selectedWorkflow,
    selectedSummary,
    runs,
    outputs,
    validationDiagnostics,
    lastRunResult,
    loading,
    detailsLoading,
    runsLoading,
    outputsLoading,
    validating,
    running,
    lastError,
    refreshOverview,
    refreshStatus,
    fetchWorkflows,
    fetchRuns,
    fetchOutputs,
    selectWorkflow,
    refreshSelected,
    validateSelected,
    runSelected,
    openComfyUi,
  };
});
```

- [ ] **Step 6: Run admin typecheck and verify the new store compiles**

Run:

```bash
cd .tmp/openclaw-admin && npm run build
```

Expected: if dependencies are installed, build reaches Vue/TypeScript compilation. If the build fails, fix only errors caused by the ComfyUI files from this task before moving on.

### Task 5: Add Admin Route, Sidebar Icon, and I18n Strings

**Files:**

- Modify `.tmp/openclaw-admin/src/router/routes.ts`
- Modify `.tmp/openclaw-admin/src/components/layout/AppSidebar.vue`
- Modify `.tmp/openclaw-admin/src/i18n/messages/zh-CN.ts`
- Modify `.tmp/openclaw-admin/src/i18n/messages/en-US.ts`

- [ ] **Step 1: Add the route**

In `.tmp/openclaw-admin/src/router/routes.ts`, insert this route after the existing `workflows` route:

```ts
      {
        path: 'comfyui',
        name: 'ComfyUI',
        component: () => import('@/views/comfyui/ComfyUiPage.vue'),
        meta: { titleKey: 'routes.comfyui', icon: 'ImagesOutline', gateway: 'openclaw' },
      },
```

- [ ] **Step 2: Register the sidebar icon**

In `.tmp/openclaw-admin/src/components/layout/AppSidebar.vue`, add `ImagesOutline` to the Ionicons import:

```ts
  ImagesOutline,
```

Add it to `iconMap`:

```ts
  ImagesOutline,
```

- [ ] **Step 3: Add Chinese route and page strings**

In `.tmp/openclaw-admin/src/i18n/messages/zh-CN.ts`, add:

```ts
    comfyui: 'ComfyUI 管理',
```

Under `pages`, add:

```ts
    comfyui: {
      title: 'ComfyUI 管理',
      subtitle: '查看已保存的 ComfyUI 工作流、最近调用历史和生成产物。',
      openComfyUi: '打开 ComfyUI',
      refresh: '刷新',
      validate: '验证',
      run: '运行',
      runConfirmTitle: '运行这个 ComfyUI 工作流？',
      runConfirmDescription: '这会提交到本地 ComfyUI 队列，可能占用 GPU、磁盘和时间。',
      status: {
        baseUrl: 'ComfyUI 地址',
        workflowsDir: '工作流目录',
        outputDir: '产物目录',
      },
      sections: {
        workflows: '工作流',
        detail: '工作流详情',
        diagnostics: '验证结果',
        runs: '最近调用',
        outputs: '生成产物',
      },
      fields: {
        workflowId: '工作流 ID',
        goal: '目标',
        mediaKind: '类型',
        lastRun: '最近运行',
        outputCount: '产物数',
        promptId: 'Prompt ID',
        status: '状态',
        startedAt: '开始时间',
        completedAt: '完成时间',
        duration: '耗时',
        filename: '文件名',
        localPath: '本地路径',
        diagnosticsCount: '诊断数',
        createdAt: '创建时间',
        updatedAt: '更新时间',
      },
      empty: {
        workflows: '暂无保存的 ComfyUI 工作流',
        selected: '选择一个工作流查看详情',
        diagnostics: '暂无诊断信息',
        runs: '暂无调用历史',
        outputs: '暂无生成产物',
      },
      messages: {
        validateSuccess: '验证完成',
        runStarted: '运行已完成，历史和产物已刷新',
      },
      statuses: {
        queued: '排队中',
        running: '运行中',
        success: '成功',
        failed: '失败',
        timed_out: '超时',
        unknown: '未知',
      },
    },
```

- [ ] **Step 4: Add English route and page strings**

In `.tmp/openclaw-admin/src/i18n/messages/en-US.ts`, add:

```ts
    comfyui: 'ComfyUI',
```

Under `pages`, add:

```ts
    comfyui: {
      title: 'ComfyUI',
      subtitle: 'Review saved ComfyUI workflows, recent invocations, and generated outputs.',
      openComfyUi: 'Open ComfyUI',
      refresh: 'Refresh',
      validate: 'Validate',
      run: 'Run',
      runConfirmTitle: 'Run this ComfyUI workflow?',
      runConfirmDescription: 'This submits work to the local ComfyUI queue and may use GPU, disk, and time.',
      status: {
        baseUrl: 'ComfyUI URL',
        workflowsDir: 'Workflows directory',
        outputDir: 'Outputs directory',
      },
      sections: {
        workflows: 'Workflows',
        detail: 'Workflow detail',
        diagnostics: 'Validation results',
        runs: 'Recent invocations',
        outputs: 'Generated outputs',
      },
      fields: {
        workflowId: 'Workflow ID',
        goal: 'Goal',
        mediaKind: 'Kind',
        lastRun: 'Last run',
        outputCount: 'Outputs',
        promptId: 'Prompt ID',
        status: 'Status',
        startedAt: 'Started',
        completedAt: 'Completed',
        duration: 'Duration',
        filename: 'Filename',
        localPath: 'Local path',
        diagnosticsCount: 'Diagnostics',
        createdAt: 'Created',
        updatedAt: 'Updated',
      },
      empty: {
        workflows: 'No saved ComfyUI workflows',
        selected: 'Select a workflow to view details',
        diagnostics: 'No diagnostics',
        runs: 'No invocation history',
        outputs: 'No generated outputs',
      },
      messages: {
        validateSuccess: 'Validation finished',
        runStarted: 'Run finished; history and outputs refreshed',
      },
      statuses: {
        queued: 'Queued',
        running: 'Running',
        success: 'Success',
        failed: 'Failed',
        timed_out: 'Timed out',
        unknown: 'Unknown',
      },
    },
```

- [ ] **Step 5: Run admin build and fix only route/i18n/icon errors**

Run:

```bash
cd .tmp/openclaw-admin && npm run build
```

Expected: if `ComfyUiPage.vue` is not created yet, FAIL with module resolution error for `@/views/comfyui/ComfyUiPage.vue`. That failure is expected at this step. Any icon import or i18n syntax error must be fixed before continuing.

### Task 6: Build the ComfyUI Management Page

**Files:**

- Create `.tmp/openclaw-admin/src/views/comfyui/ComfyUiPage.vue`

- [ ] **Step 1: Create the page script**

Create `.tmp/openclaw-admin/src/views/comfyui/ComfyUiPage.vue` with this script section:

```vue
<script setup lang="ts">
import { computed, h, onMounted } from "vue";
import type { Component } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NIcon,
  NPopconfirm,
  NSpace,
  NSpin,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import {
  CheckmarkCircleOutline,
  CloseCircleOutline,
  ImagesOutline,
  LinkOutline,
  PlayOutline,
  RefreshOutline,
  WarningOutline,
} from "@vicons/ionicons5";
import { useI18n } from "vue-i18n";
import { useComfyUiStore } from "@/stores/comfyui";
import type {
  ComfyUiDiagnostic,
  ComfyUiOutputSummary,
  ComfyUiRunRecord,
  ComfyUiRunStatus,
  ComfyUiWorkflowSummary,
} from "@/api/types";
import { formatDate, formatRelativeTime } from "@/utils/format";

type TagType = "default" | "info" | "success" | "warning" | "error";

const store = useComfyUiStore();
const message = useMessage();
const { t } = useI18n();

const selectedSummary = computed(() => store.selectedSummary);

const stats = computed(() => ({
  workflows: store.workflows.length,
  runs: store.runs.length,
  outputs: store.outputs.length,
  successfulRuns: store.runs.filter((run) => run.status === "success").length,
}));

function renderIcon(icon: Component) {
  return () => h(NIcon, { component: icon });
}

function statusTagType(status?: ComfyUiRunStatus): TagType {
  switch (status) {
    case "success":
      return "success";
    case "failed":
    case "timed_out":
      return "error";
    case "running":
      return "info";
    case "queued":
      return "warning";
    default:
      return "default";
  }
}

function statusLabel(status?: ComfyUiRunStatus) {
  if (!status) return "-";
  return t(`pages.comfyui.statuses.${status}`, status);
}

function formatOptionalDate(value?: string) {
  return value ? formatDate(value) : "-";
}

function formatOptionalRelative(value?: string) {
  return value ? formatRelativeTime(value) : "-";
}

function formatDuration(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function outputPath(output: ComfyUiOutputSummary) {
  return output.localPath || output.filename;
}

const workflowColumns = computed<DataTableColumns<ComfyUiWorkflowSummary>>(() => [
  {
    title: t("pages.comfyui.fields.workflowId"),
    key: "workflowId",
    render(row) {
      return h(
        "button",
        {
          class: ["workflow-link", row.workflowId === store.selectedWorkflowId ? "is-active" : ""],
          onClick: () => store.selectWorkflow(row.workflowId),
        },
        row.workflowId,
      );
    },
  },
  {
    title: t("pages.comfyui.fields.mediaKind"),
    key: "mediaKind",
    width: 90,
    render(row) {
      return h(NTag, { size: "small", type: "info" }, { default: () => row.mediaKind });
    },
  },
  {
    title: t("pages.comfyui.fields.lastRun"),
    key: "lastRun",
    width: 110,
    render(row) {
      return h(
        NTag,
        { size: "small", type: statusTagType(row.lastRun?.status) },
        { default: () => statusLabel(row.lastRun?.status) },
      );
    },
  },
  {
    title: t("pages.comfyui.fields.outputCount"),
    key: "outputCount",
    width: 90,
  },
]);

const runColumns = computed<DataTableColumns<ComfyUiRunRecord>>(() => [
  { title: t("pages.comfyui.fields.promptId"), key: "promptId", minWidth: 180 },
  {
    title: t("pages.comfyui.fields.status"),
    key: "status",
    width: 110,
    render(row) {
      return h(
        NTag,
        { size: "small", type: statusTagType(row.status) },
        { default: () => statusLabel(row.status) },
      );
    },
  },
  {
    title: t("pages.comfyui.fields.startedAt"),
    key: "startedAt",
    width: 160,
    render(row) {
      return formatOptionalRelative(row.startedAt);
    },
  },
  {
    title: t("pages.comfyui.fields.duration"),
    key: "durationMs",
    width: 90,
    render(row) {
      return formatDuration(row.durationMs);
    },
  },
  {
    title: t("pages.comfyui.fields.outputCount"),
    key: "outputs",
    width: 90,
    render(row) {
      return row.outputs?.length ?? 0;
    },
  },
]);

const outputColumns = computed<DataTableColumns<ComfyUiOutputSummary>>(() => [
  {
    title: t("pages.comfyui.fields.mediaKind"),
    key: "kind",
    width: 90,
    render(row) {
      return h(
        NTag,
        { size: "small", type: row.kind === "unknown" ? "default" : "info" },
        { default: () => row.kind },
      );
    },
  },
  { title: t("pages.comfyui.fields.filename"), key: "filename", minWidth: 180 },
  { title: t("pages.comfyui.fields.promptId"), key: "promptId", minWidth: 160 },
  {
    title: t("pages.comfyui.fields.createdAt"),
    key: "createdAt",
    width: 150,
    render(row) {
      return formatOptionalRelative(row.createdAt);
    },
  },
  {
    title: t("pages.comfyui.fields.localPath"),
    key: "localPath",
    minWidth: 240,
    render(row) {
      return outputPath(row);
    },
  },
]);

function diagnosticIcon(diagnostic: ComfyUiDiagnostic) {
  if (diagnostic.severity === "error") return CloseCircleOutline;
  return WarningOutline;
}

async function validateSelected() {
  try {
    await store.validateSelected();
    message.success(t("pages.comfyui.messages.validateSuccess"));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function runSelected() {
  try {
    await store.runSelected();
    message.success(t("pages.comfyui.messages.runStarted"));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

onMounted(() => {
  void store.refreshOverview();
});
</script>
```

- [ ] **Step 2: Add the page template**

Append this template to `.tmp/openclaw-admin/src/views/comfyui/ComfyUiPage.vue`:

```vue
<template>
  <div class="comfyui-page">
    <div class="page-header">
      <div>
        <h1>{{ t("pages.comfyui.title") }}</h1>
        <p>{{ t("pages.comfyui.subtitle") }}</p>
      </div>
      <NSpace>
        <NButton :loading="store.loading" @click="store.refreshOverview">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
          {{ t("pages.comfyui.refresh") }}
        </NButton>
        <NButton type="primary" :disabled="!store.status?.baseUrl" @click="store.openComfyUi">
          <template #icon>
            <NIcon :component="LinkOutline" />
          </template>
          {{ t("pages.comfyui.openComfyUi") }}
        </NButton>
      </NSpace>
    </div>

    <NAlert v-if="store.lastError" type="error" closable>
      {{ store.lastError }}
    </NAlert>

    <div class="status-grid">
      <NCard :bordered="false">
        <NDescriptions :column="1" size="small" label-placement="left">
          <NDescriptionsItem :label="t('pages.comfyui.status.baseUrl')">
            <NText code>{{ store.status?.baseUrl || "-" }}</NText>
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('pages.comfyui.status.workflowsDir')">
            <NText code>{{ store.status?.workflowsDir || "-" }}</NText>
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('pages.comfyui.status.outputDir')">
            <NText code>{{ store.status?.outputDir || "-" }}</NText>
          </NDescriptionsItem>
        </NDescriptions>
      </NCard>
      <NCard :bordered="false">
        <div class="metric-row">
          <div>
            <strong>{{ stats.workflows }}</strong>
            <span>{{ t("pages.comfyui.sections.workflows") }}</span>
          </div>
          <div>
            <strong>{{ stats.runs }}</strong>
            <span>{{ t("pages.comfyui.sections.runs") }}</span>
          </div>
          <div>
            <strong>{{ stats.outputs }}</strong>
            <span>{{ t("pages.comfyui.sections.outputs") }}</span>
          </div>
        </div>
      </NCard>
    </div>

    <div class="main-grid">
      <NCard :title="t('pages.comfyui.sections.workflows')" :bordered="false">
        <NSpin :show="store.loading">
          <NEmpty
            v-if="!store.workflows.length"
            :description="t('pages.comfyui.empty.workflows')"
          />
          <NDataTable
            v-else
            :columns="workflowColumns"
            :data="store.workflows"
            :pagination="{ pageSize: 12 }"
            size="small"
          />
        </NSpin>
      </NCard>

      <NCard :title="t('pages.comfyui.sections.detail')" :bordered="false">
        <NEmpty v-if="!selectedSummary" :description="t('pages.comfyui.empty.selected')" />
        <NSpin v-else :show="store.detailsLoading">
          <div class="detail-header">
            <div>
              <h2>{{ selectedSummary.goal }}</h2>
              <NText code>{{ selectedSummary.workflowId }}</NText>
            </div>
            <NSpace>
              <NButton :loading="store.validating" @click="validateSelected">
                <template #icon>
                  <NIcon :component="CheckmarkCircleOutline" />
                </template>
                {{ t("pages.comfyui.validate") }}
              </NButton>
              <NPopconfirm
                :positive-text="t('common.confirm')"
                :negative-text="t('common.cancel')"
                @positive-click="runSelected"
              >
                <template #trigger>
                  <NButton type="primary" :loading="store.running">
                    <template #icon>
                      <NIcon :component="PlayOutline" />
                    </template>
                    {{ t("pages.comfyui.run") }}
                  </NButton>
                </template>
                <strong>{{ t("pages.comfyui.runConfirmTitle") }}</strong>
                <p>{{ t("pages.comfyui.runConfirmDescription") }}</p>
              </NPopconfirm>
            </NSpace>
          </div>

          <NDescriptions :column="2" size="small" label-placement="left">
            <NDescriptionsItem :label="t('pages.comfyui.fields.mediaKind')">
              <NTag size="small" type="info">{{ selectedSummary.mediaKind }}</NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.comfyui.fields.lastRun')">
              <NTag size="small" :type="statusTagType(selectedSummary.lastRun?.status)">
                {{ statusLabel(selectedSummary.lastRun?.status) }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.comfyui.fields.createdAt')">
              {{ formatOptionalDate(selectedSummary.createdAt) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.comfyui.fields.updatedAt')">
              {{ formatOptionalDate(selectedSummary.updatedAt) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.comfyui.fields.diagnosticsCount')">
              {{ selectedSummary.diagnosticsCount }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.comfyui.fields.outputCount')">
              {{ selectedSummary.outputCount }}
            </NDescriptionsItem>
          </NDescriptions>

          <section class="diagnostics">
            <h3>{{ t("pages.comfyui.sections.diagnostics") }}</h3>
            <NEmpty
              v-if="!store.validationDiagnostics.length"
              :description="t('pages.comfyui.empty.diagnostics')"
            />
            <div v-else class="diagnostic-list">
              <div
                v-for="diagnostic in store.validationDiagnostics"
                :key="`${diagnostic.code}-${diagnostic.nodeId || diagnostic.field || diagnostic.message}`"
                class="diagnostic-row"
              >
                <NIcon :component="diagnosticIcon(diagnostic)" />
                <div>
                  <strong>{{ diagnostic.code }}</strong>
                  <p>{{ diagnostic.message }}</p>
                </div>
              </div>
            </div>
          </section>
        </NSpin>
      </NCard>
    </div>

    <div class="history-grid">
      <NCard :title="t('pages.comfyui.sections.runs')" :bordered="false">
        <NSpin :show="store.runsLoading">
          <NEmpty v-if="!store.runs.length" :description="t('pages.comfyui.empty.runs')" />
          <NDataTable
            v-else
            :columns="runColumns"
            :data="store.runs"
            :pagination="{ pageSize: 8 }"
            size="small"
          />
        </NSpin>
      </NCard>

      <NCard :title="t('pages.comfyui.sections.outputs')" :bordered="false">
        <NSpin :show="store.outputsLoading">
          <NEmpty v-if="!store.outputs.length" :description="t('pages.comfyui.empty.outputs')" />
          <NDataTable
            v-else
            :columns="outputColumns"
            :data="store.outputs"
            :pagination="{ pageSize: 8 }"
            size="small"
          />
        </NSpin>
      </NCard>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Add page styles**

Append this style block to `.tmp/openclaw-admin/src/views/comfyui/ComfyUiPage.vue`:

```vue
<style scoped>
.comfyui-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header,
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-header h1,
.detail-header h2 {
  margin: 0;
}

.page-header p {
  margin: 6px 0 0;
  color: var(--text-color-3);
}

.status-grid,
.main-grid,
.history-grid {
  display: grid;
  gap: 16px;
}

.status-grid {
  grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
}

.main-grid {
  grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.1fr);
}

.history-grid {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.metric-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.metric-row div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-row strong {
  font-size: 24px;
  line-height: 1;
}

.metric-row span {
  color: var(--text-color-3);
}

.workflow-link {
  border: 0;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: left;
}

.workflow-link.is-active {
  font-weight: 600;
}

.diagnostics {
  margin-top: 16px;
}

.diagnostics h3 {
  margin: 0 0 8px;
}

.diagnostic-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.diagnostic-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.diagnostic-row p {
  margin: 2px 0 0;
  color: var(--text-color-2);
}

@media (max-width: 1100px) {
  .status-grid,
  .main-grid,
  .history-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .page-header,
  .detail-header {
    flex-direction: column;
  }
}
</style>
```

- [ ] **Step 4: Run admin build and fix page compile errors**

Run:

```bash
cd .tmp/openclaw-admin && npm run build
```

Expected: PASS. If it fails, fix only type, template, or import errors in the files touched for this ComfyUI page.

### Task 7: Final Verification and Handoff

**Files:**

- Verify tracked backend/plugin changes.
- Verify `.tmp/openclaw-admin` local page changes.

- [ ] **Step 1: Run ComfyUI backend tests**

Run:

```bash
pnpm test -- extensions/comfyui
```

Expected: PASS.

- [ ] **Step 2: Run admin build**

Run:

```bash
cd .tmp/openclaw-admin && npm run build
```

Expected: PASS.

- [ ] **Step 3: Run the local admin dev server**

If no server is already running for `.tmp/openclaw-admin`, run:

```bash
cd .tmp/openclaw-admin && npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`.

- [ ] **Step 4: Browser smoke the page**

Open the Vite URL in the in-app browser and verify:

- The sidebar includes `ComfyUI 管理` in Chinese.
- The page opens at `/comfyui`.
- The page shows the configured ComfyUI base URL and the `打开 ComfyUI` button.
- With no saved workflows, the workflow empty state renders.
- With a saved workflow, selecting it updates detail, recent calls, and outputs.
- The run action shows a confirmation before calling the backend.

- [ ] **Step 5: Check tracked and untracked status**

Run:

```bash
git status --short
```

Expected: tracked backend changes are committed if Tasks 1-3 were completed. `.tmp/openclaw-admin/**` remains untracked/local unless the user explicitly asked to track that admin app.

## Self-Review

Spec coverage:

- Workflow list: Task 1 backend list helpers, Task 4 store, Task 6 table.
- Link to ComfyUI page: Task 3 `comfyui.status`, Task 4 `openComfyUi`, Task 6 header button.
- Avoid cramming everything into one page: Task 6 uses separate workflow, detail, recent run, and output regions.
- Recent invocation history: Task 1 run JSONL, Task 2 tool recording, Task 6 run table.
- Generated outputs: Task 1 output summaries, Task 6 output table.
- ComfyUI remains the graph editor: no task embeds or recreates a node editor.
- Explicit side effects: Task 3 requires `confirmed: true`; Task 6 uses `NPopconfirm`.

Placeholder scan:

- No open placeholder markers.
- No empty "write tests" steps.
- No unnamed files.
- No generic "handle edge cases" steps.

Type consistency:

- Backend uses `workflowId`, `promptId`, `status`, `startedAt`, `completedAt`, `durationMs`, `outputs`.
- Frontend types mirror backend names.
- Gateway methods are `comfyui.status`, `comfyui.workflows.list`, `comfyui.workflow.get`, `comfyui.runs.list`, `comfyui.outputs.list`, `comfyui.workflow.validate`, and `comfyui.workflow.run`.
