import { searchNotebookLmViaCli } from "../notebooklm/notebooklm-cli.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import type {
  ExperienceProvider,
  ExperienceRuntimeLogger,
  ExperienceSearchInput,
} from "./provider.ts";

export class NotebookLmExperienceProvider implements ExperienceProvider {
  readonly id = "notebooklm";

  constructor(
    private readonly options: {
      config?: NotebookLmConfig;
      logger: ExperienceRuntimeLogger;
    },
  ) {}

  async search(input: ExperienceSearchInput) {
    const config = this.options.config;
    if (!input.plan.enabled || !config?.enabled || !config.cli.enabled) {
      return { providerId: this.id, items: [] };
    }

    const items = await searchNotebookLmViaCli({
      config,
      query: input.query,
      limit: input.plan.limit,
      logger: this.options.logger,
      notificationScope: {
        agentId:
          typeof input.runtimeContext?.agentId === "string"
            ? input.runtimeContext.agentId
            : undefined,
        channel:
          typeof input.runtimeContext?.messageChannel === "string"
            ? input.runtimeContext.messageChannel
            : undefined,
        userId:
          typeof input.runtimeContext?.senderId === "string"
            ? input.runtimeContext.senderId
            : undefined,
      },
    });

    return { providerId: this.id, items };
  }
}
