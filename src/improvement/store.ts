import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "../infra/file-lock.js";
import type {
  ImprovementProposal,
  ImprovementProposalIndexEntry,
  ImprovementRunIndexEntry,
  ImprovementRunRecord,
  ImprovementStoreIndex,
  PromotionJudgeVerdictEnvelope,
} from "./types.js";

export type ImprovementStoreContext = {
  workspaceDir?: string;
  agentDir?: string;
};

const IMPROVEMENT_ROOT_SEGMENTS = [".crawclaw", "improvements"] as const;
const STORE_FILE = "store.json";
const PROPOSALS_DIR = "proposals";
const RUNS_DIR = "runs";
const JUDGE_DIR = "judge";
const STORE_LOCK_FILE = ".store";
const improvementRootMutationQueues = new Map<string, Promise<void>>();
const IMPROVEMENT_STORE_LOCK_OPTIONS = {
  retries: {
    retries: 120,
    factor: 1.2,
    minTimeout: 25,
    maxTimeout: 250,
    randomize: true,
  },
  stale: 30_000,
};

function defaultImprovementStoreIndex(): ImprovementStoreIndex {
  return {
    version: 1,
    updatedAt: Date.now(),
    proposals: [],
    runs: [],
  };
}

export function resolveImprovementRoot(context: ImprovementStoreContext): string | null {
  const workspaceDir = context.workspaceDir?.trim();
  if (workspaceDir) {
    return path.join(workspaceDir, ...IMPROVEMENT_ROOT_SEGMENTS);
  }
  const agentDir = context.agentDir?.trim();
  if (agentDir) {
    return path.join(agentDir, "improvements");
  }
  return null;
}

export function requireImprovementRoot(context: ImprovementStoreContext): string {
  const root = resolveImprovementRoot(context);
  if (!root) {
    throw new Error("Improvement workflow requires workspaceDir or agentDir.");
  }
  return root;
}

export function resolveImprovementStorePath(context: ImprovementStoreContext): string {
  return path.join(requireImprovementRoot(context), STORE_FILE);
}

export function resolveImprovementProposalPath(
  context: ImprovementStoreContext,
  proposalId: string,
): string {
  return path.join(requireImprovementRoot(context), PROPOSALS_DIR, `${proposalId}.json`);
}

export function resolveImprovementRunPath(context: ImprovementStoreContext, runId: string): string {
  return path.join(requireImprovementRoot(context), RUNS_DIR, `${runId}.json`);
}

export function resolvePromotionJudgeVerdictPath(params: {
  workspaceDir: string;
  candidateId: string;
}): string {
  return path.join(
    requireImprovementRoot({ workspaceDir: params.workspaceDir }),
    JUDGE_DIR,
    `${params.candidateId}.json`,
  );
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFileAtomic(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function deleteFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

function queueImprovementRootMutation<T>(root: string, mutation: () => Promise<T>): Promise<T> {
  const previous = improvementRootMutationQueues.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  const gate = next.then(
    () => undefined,
    () => undefined,
  );
  improvementRootMutationQueues.set(root, gate);
  return next.finally(() => {
    if (improvementRootMutationQueues.get(root) === gate) {
      improvementRootMutationQueues.delete(root);
    }
  });
}

type ImprovementStoreMutationApi = {
  root: string;
  loadStoreIndex: () => Promise<ImprovementStoreIndex>;
  saveStoreIndex: (store: ImprovementStoreIndex) => Promise<void>;
  loadProposal: (proposalId: string) => Promise<ImprovementProposal | null>;
  saveProposal: (proposal: ImprovementProposal) => Promise<void>;
  loadRun: (runId: string) => Promise<ImprovementRunRecord | null>;
  saveRun: (run: ImprovementRunRecord) => Promise<void>;
};

async function loadStoreIndexInternal(filePath: string): Promise<ImprovementStoreIndex> {
  const existing = await readJsonFile<ImprovementStoreIndex>(filePath);
  return existing ?? defaultImprovementStoreIndex();
}

async function saveStoreIndexInternal(
  filePath: string,
  store: ImprovementStoreIndex,
): Promise<void> {
  await writeJsonFileAtomic(filePath, {
    ...store,
    updatedAt: Date.now(),
  });
}

export async function withImprovementStoreMutation<T>(
  context: ImprovementStoreContext,
  mutation: (api: ImprovementStoreMutationApi) => Promise<T>,
): Promise<T> {
  const root = requireImprovementRoot(context);
  return await withFileLock(
    path.join(root, STORE_LOCK_FILE),
    IMPROVEMENT_STORE_LOCK_OPTIONS,
    async () =>
      await queueImprovementRootMutation(
        root,
        async () =>
          await mutation({
            root,
            loadStoreIndex: async () => await loadStoreIndexInternal(path.join(root, STORE_FILE)),
            saveStoreIndex: async (store) =>
              await saveStoreIndexInternal(path.join(root, STORE_FILE), store),
            loadProposal: async (proposalId) =>
              await readJsonFile<ImprovementProposal>(
                path.join(root, PROPOSALS_DIR, `${proposalId}.json`),
              ),
            saveProposal: async (proposal) =>
              await writeJsonFileAtomic(
                path.join(root, PROPOSALS_DIR, `${proposal.id}.json`),
                proposal,
              ),
            loadRun: async (runId) =>
              await readJsonFile<ImprovementRunRecord>(path.join(root, RUNS_DIR, `${runId}.json`)),
            saveRun: async (run) =>
              await writeJsonFileAtomic(path.join(root, RUNS_DIR, `${run.runId}.json`), run),
          }),
      ),
  );
}

export async function loadImprovementStoreIndex(
  context: ImprovementStoreContext,
): Promise<ImprovementStoreIndex> {
  return await loadStoreIndexInternal(resolveImprovementStorePath(context));
}

function toProposalIndexEntry(proposal: ImprovementProposal): ImprovementProposalIndexEntry {
  return {
    id: proposal.id,
    status: proposal.status,
    candidateId: proposal.candidate.id,
    kind: proposal.patchPlan.kind,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

function toRunIndexEntry(run: ImprovementRunRecord): ImprovementRunIndexEntry {
  return {
    runId: run.runId,
    status: run.status,
    ...(run.candidateId ? { candidateId: run.candidateId } : {}),
    ...(run.proposalId ? { proposalId: run.proposalId } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function saveImprovementProposal(
  context: ImprovementStoreContext,
  proposal: ImprovementProposal,
): Promise<ImprovementProposal> {
  await withImprovementStoreMutation(context, async (api) => {
    const store = await api.loadStoreIndex();
    const nextProposal = {
      ...proposal,
      updatedAt: Date.now(),
    };
    await api.saveProposal(nextProposal);
    store.proposals = [
      toProposalIndexEntry(nextProposal),
      ...store.proposals.filter((entry) => entry.id !== nextProposal.id),
    ]
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 500);
    await api.saveStoreIndex(store);
  });
  return (await loadImprovementProposal(context, proposal.id))!;
}

export async function loadImprovementProposal(
  context: ImprovementStoreContext,
  proposalId: string,
): Promise<ImprovementProposal | null> {
  return await readJsonFile<ImprovementProposal>(
    resolveImprovementProposalPath(context, proposalId),
  );
}

export async function saveImprovementRunRecord(
  context: ImprovementStoreContext,
  run: ImprovementRunRecord,
): Promise<ImprovementRunRecord> {
  await withImprovementStoreMutation(context, async (api) => {
    const store = await api.loadStoreIndex();
    const nextRun = {
      ...run,
      updatedAt: Date.now(),
    };
    await api.saveRun(nextRun);
    store.runs = [
      toRunIndexEntry(nextRun),
      ...store.runs.filter((entry) => entry.runId !== nextRun.runId),
    ]
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 500);
    await api.saveStoreIndex(store);
  });
  return (await loadImprovementRunRecord(context, run.runId))!;
}

export async function loadImprovementRunRecord(
  context: ImprovementStoreContext,
  runId: string,
): Promise<ImprovementRunRecord | null> {
  return await readJsonFile<ImprovementRunRecord>(resolveImprovementRunPath(context, runId));
}

export async function persistPromotionJudgeVerdictEnvelope(params: {
  workspaceDir: string;
  runId: string;
  verdict: PromotionJudgeVerdictEnvelope["verdict"];
}): Promise<PromotionJudgeVerdictEnvelope> {
  const envelope: PromotionJudgeVerdictEnvelope = {
    version: 1,
    runId: params.runId,
    verdict: params.verdict,
    createdAt: Date.now(),
  };
  await writeJsonFileAtomic(
    resolvePromotionJudgeVerdictPath({
      workspaceDir: params.workspaceDir,
      candidateId: params.verdict.candidateId,
    }),
    envelope,
  );
  return envelope;
}

export async function loadPromotionJudgeVerdictEnvelope(params: {
  workspaceDir: string;
  candidateId: string;
}): Promise<PromotionJudgeVerdictEnvelope | null> {
  return await readJsonFile<PromotionJudgeVerdictEnvelope>(
    resolvePromotionJudgeVerdictPath(params),
  );
}

export async function deletePromotionJudgeVerdictEnvelope(params: {
  workspaceDir: string;
  candidateId: string;
}): Promise<void> {
  await deleteFileIfExists(resolvePromotionJudgeVerdictPath(params));
}
