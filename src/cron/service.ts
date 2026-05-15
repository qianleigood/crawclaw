import { runCrawClawRuntimeTool } from "../agents/runtime-tools/native.js";
import type { CronServiceDeps } from "./service/state.js";
import type { CronJob, CronJobCreate, CronJobPatch } from "./types.js";

export type { CronEvent, CronServiceDeps } from "./service/state.js";

export type CronListPageOptions = {
  includeDisabled?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  enabled?: "all" | "enabled" | "disabled";
  sortBy?: "nextRunAtMs" | "updatedAtMs" | "name";
  sortDir?: "asc" | "desc";
};

type CronListPage = {
  jobs: CronJob[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset?: number;
};

type CronStatus = {
  enabled: boolean;
  storePath: string;
  jobs: number;
  nextWakeAtMs?: number | null;
};

type CronRemoveResult = {
  ok: boolean;
  removed: boolean;
};

type CronRunResult = {
  ok?: boolean;
  ran?: boolean;
  enqueued?: boolean;
  runId?: string;
  reason?: string;
};

const DEFAULT_CRON_TIMEOUT_MS = 60_000;

export class CronService {
  private readonly storePath: string;

  constructor(deps: CronServiceDeps) {
    this.storePath = deps.storePath;
  }

  async start() {
    await this.call<CronStatus>("cron.start");
  }

  stop() {
    void this.call<CronStatus>("cron.stop");
  }

  async status() {
    return await this.call<CronStatus>("cron.status");
  }

  async list(opts?: { includeDisabled?: boolean }) {
    const page = await this.listPage(opts);
    return page.jobs;
  }

  async listPage(opts?: CronListPageOptions) {
    return await this.call<CronListPage>("cron.list", opts);
  }

  async add(input: CronJobCreate) {
    return await this.call<CronJob>("cron.add", input);
  }

  async update(id: string, patch: CronJobPatch) {
    return await this.call<CronJob>("cron.update", { id, patch });
  }

  async remove(id: string) {
    return await this.call<CronRemoveResult>("cron.remove", { id });
  }

  async run(id: string, mode?: "due" | "force") {
    return await this.call<CronRunResult>("cron.run", { id, mode });
  }

  async enqueueRun(id: string, mode?: "due" | "force") {
    return await this.run(id, mode);
  }

  getJob(_id: string): CronJob | undefined {
    return undefined;
  }

  wake(opts: { mode: "now"; text: string }) {
    void this.call("wake", opts);
    return { status: "ok", mode: opts.mode };
  }

  private async call<T>(method: string, input?: Record<string, unknown>): Promise<T> {
    return await runCrawClawRuntimeTool<T>(
      method,
      {
        ...input,
        storePath: this.storePath,
      },
      { timeoutMs: DEFAULT_CRON_TIMEOUT_MS },
    );
  }
}
