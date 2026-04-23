import path from "node:path";
import type { CrawClawConfig } from "../../config/config.js";
import { createProviderEmbeddingProvider } from "../../plugins/provider-runtime.js";
import type { PluginEmbeddingProvider } from "../../plugins/types.js";
import type {
  SkillDiscoveryCandidate,
  SkillSemanticRetrieveRequest,
  SkillSemanticRetriever,
} from "./discovery.js";
import { getSkillsSnapshotVersion } from "./refresh.js";

type SkillEmbeddingProvider = Pick<
  PluginEmbeddingProvider,
  "id" | "model" | "embedQuery" | "embedBatch"
>;

type CreateEmbeddingProvider = () => Promise<SkillEmbeddingProvider | null | undefined>;

type SkillVectorIndexEntry = {
  skill: SkillDiscoveryCandidate;
  embedding: number[];
};

type SkillVectorIndex = {
  signature: string;
  entries: SkillVectorIndexEntry[];
};

const MAX_RECALL_LIMIT = 40;
const DEFAULT_BATCH_SIZE = 32;
const indexCache = new Map<string, Promise<SkillVectorIndex>>();

function normalizeLimit(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? MAX_RECALL_LIMIT, MAX_RECALL_LIMIT));
}

function normalizeBatchSize(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? DEFAULT_BATCH_SIZE, 128));
}

function normalizeVector(vector: readonly number[]): number[] {
  const sanitized = vector.map((value) => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
  if (magnitude < 1e-10) {
    return sanitized;
  }
  return sanitized.map((value) => value / magnitude);
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return sum;
}

function resolveLocationBasename(location: string): string {
  const fileBase = path.basename(location);
  if (fileBase.toLowerCase() !== "skill.md") {
    return fileBase;
  }
  return path.basename(path.dirname(location));
}

function buildSkillEmbeddingText(skill: SkillDiscoveryCandidate): string {
  return [skill.name, skill.description ?? "", resolveLocationBasename(skill.location)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

function buildSkillSignature(skills: readonly SkillDiscoveryCandidate[]): string {
  return skills
    .map((skill) => [skill.name, skill.description ?? "", skill.location].join("\u0000"))
    .join("\u0001");
}

function buildCacheKey(params: {
  workspaceDir: string;
  provider: string;
  model: string;
  snapshotVersion: number;
}): string {
  return [
    path.resolve(params.workspaceDir || "."),
    params.provider.trim().toLowerCase(),
    params.model.trim(),
    String(params.snapshotVersion),
  ].join("\u0000");
}

async function buildVectorIndex(params: {
  provider: SkillEmbeddingProvider;
  availableSkills: readonly SkillDiscoveryCandidate[];
  batchSize: number;
}): Promise<SkillVectorIndex> {
  const entries: SkillVectorIndexEntry[] = [];
  const signature = buildSkillSignature(params.availableSkills);
  for (let index = 0; index < params.availableSkills.length; index += params.batchSize) {
    const batch = params.availableSkills.slice(index, index + params.batchSize);
    const embeddings = await params.provider.embedBatch(batch.map(buildSkillEmbeddingText));
    for (let offset = 0; offset < batch.length; offset += 1) {
      const embedding = embeddings[offset];
      if (!Array.isArray(embedding) || embedding.length === 0) {
        continue;
      }
      entries.push({
        skill: batch[offset]!,
        embedding: normalizeVector(embedding),
      });
    }
  }
  return { signature, entries };
}

export function clearSkillSemanticRetrievalCache() {
  indexCache.clear();
}

export function createSkillSemanticRetriever(params: {
  workspaceDir: string;
  provider: string;
  model: string;
  snapshotVersion: number;
  batchSize?: number;
  createEmbeddingProvider: CreateEmbeddingProvider;
}): SkillSemanticRetriever {
  const cacheKey = buildCacheKey(params);
  const batchSize = normalizeBatchSize(params.batchSize);
  return async (request: SkillSemanticRetrieveRequest) => {
    const taskDescription = request.taskDescription.trim();
    if (!taskDescription || request.availableSkills.length === 0) {
      return [];
    }
    const excluded = new Set(
      (request.excludeSkillNames ?? []).map((name) => name.trim()).filter(Boolean),
    );
    const availableSkills = request.availableSkills.filter(
      (skill) => skill.name.trim() && !excluded.has(skill.name),
    );
    if (!availableSkills.length) {
      return [];
    }
    const provider = await params.createEmbeddingProvider();
    if (!provider) {
      return [];
    }
    const signature = buildSkillSignature(availableSkills);
    const cached = await (async () => {
      const existing = indexCache.get(cacheKey);
      if (!existing) {
        return undefined;
      }
      const resolved = await existing;
      return resolved.signature === signature ? resolved : undefined;
    })();
    const index =
      cached ??
      (await (() => {
        const next = buildVectorIndex({ provider, availableSkills, batchSize });
        indexCache.set(cacheKey, next);
        return next;
      })());
    const queryEmbedding = normalizeVector(await provider.embedQuery(taskDescription));
    const limit = normalizeLimit(request.recallLimit);
    return index.entries
      .map((entry) => ({
        ...entry.skill,
        semanticScore: Number(cosineSimilarity(queryEmbedding, entry.embedding).toFixed(4)),
        semanticSource: "vector" as const,
      }))
      .filter((skill) => (skill.semanticScore ?? 0) > 0)
      .toSorted(
        (left, right) =>
          (right.semanticScore ?? 0) - (left.semanticScore ?? 0) ||
          left.name.localeCompare(right.name),
      )
      .slice(0, limit);
  };
}

export function createSkillSemanticRetrieverFromConfig(params: {
  config?: CrawClawConfig;
  workspaceDir: string;
  getProviderApiKey?: (provider: string) => Promise<string | undefined>;
}): SkillSemanticRetriever | undefined {
  const semanticConfig = params.config?.skills?.discovery?.semantic;
  if (semanticConfig?.enabled !== true) {
    return undefined;
  }
  const provider = semanticConfig.provider?.trim();
  const model = semanticConfig.model?.trim();
  if (!provider || !model) {
    return undefined;
  }
  return createSkillSemanticRetriever({
    workspaceDir: params.workspaceDir,
    provider,
    model,
    snapshotVersion: getSkillsSnapshotVersion(params.workspaceDir),
    batchSize: semanticConfig.batchSize,
    createEmbeddingProvider: async () => {
      const providerApiKey = await params.getProviderApiKey?.(provider);
      return await createProviderEmbeddingProvider({
        provider,
        config: params.config,
        workspaceDir: params.workspaceDir,
        context: {
          config: params.config ?? {},
          workspaceDir: params.workspaceDir,
          provider,
          model,
          providerApiKey,
        },
      });
    },
  });
}
