import type { MemoryRuntimeContext } from "../engine/types.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import type { UnifiedQueryClassification, UnifiedRecallItem } from "../types/orchestration.ts";
import { LocalExperienceIndexProvider } from "./local-index-provider.ts";
import { NotebookLmExperienceProvider } from "./notebooklm-provider.ts";
import { buildExperienceQueryPlan, type ExperienceQueryPlan } from "./query-plan.ts";

export type ExperienceRuntimeLogger = {
  warn(message: string): void;
};

export interface ExperienceSearchInput {
  query: string;
  classification: UnifiedQueryClassification;
  recentMessages?: string[];
  runtimeContext?: MemoryRuntimeContext;
  plan: ExperienceQueryPlan;
}

export interface ExperienceProviderSearchResult {
  providerId: string;
  items: UnifiedRecallItem[];
}

export interface ExperienceProvider {
  readonly id: string;
  search(input: ExperienceSearchInput): Promise<ExperienceProviderSearchResult>;
}

export interface ExperienceRecallResult {
  items: UnifiedRecallItem[];
  queryPlan: ExperienceQueryPlan;
  providerIds: string[];
}

export class ExperienceProviderRegistry {
  constructor(
    private readonly providers: readonly ExperienceProvider[],
    private readonly options: {
      defaultLimit: number;
      logger: ExperienceRuntimeLogger;
    },
  ) {}

  getProviderIds(): string[] {
    return this.providers.map((provider) => provider.id);
  }

  async search(input: {
    query: string;
    classification: UnifiedQueryClassification;
    recentMessages?: string[];
    runtimeContext?: MemoryRuntimeContext;
  }): Promise<ExperienceRecallResult> {
    const providerIds = this.getProviderIds();
    const queryPlan = buildExperienceQueryPlan({
      query: input.query,
      classification: input.classification,
      defaultLimit: this.options.defaultLimit,
      providerIds,
    });
    if (!queryPlan.enabled || queryPlan.limit <= 0 || queryPlan.providerIds.length === 0) {
      return {
        items: [],
        queryPlan,
        providerIds: [],
      };
    }

    const plannedProviderIds = new Set(queryPlan.providerIds);
    const providerResults = await Promise.all(
      this.providers
        .filter((provider) => plannedProviderIds.has(provider.id))
        .map((provider) =>
          provider
            .search({
              ...input,
              plan: queryPlan,
            })
            .catch((error) => {
              this.options.logger.warn(
                `[memory] experience provider ${provider.id} skipped | ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return { providerId: provider.id, items: [] };
            }),
        ),
    );
    return {
      items: providerResults.flatMap((result) => result.items),
      queryPlan,
      providerIds: providerResults
        .filter((result) => result.items.length > 0 || plannedProviderIds.has(result.providerId))
        .map((result) => result.providerId),
    };
  }
}

export function createDefaultExperienceProviderRegistry(options: {
  notebooklm?: NotebookLmConfig;
  logger: ExperienceRuntimeLogger;
}): ExperienceProviderRegistry {
  return new ExperienceProviderRegistry(
    [
      new NotebookLmExperienceProvider({
        config: options.notebooklm,
        logger: options.logger,
      }),
      new LocalExperienceIndexProvider(),
    ],
    {
      defaultLimit: options.notebooklm?.cli.limit ?? 5,
      logger: options.logger,
    },
  );
}
