import type { SkillIndex } from "../types/orchestration.ts";
import { buildSkillIndex } from "./skill-metadata.ts";

export class SkillIndexStore {
  private current: SkillIndex | null = null;

  constructor(
    private readonly options: {
      workspaceDir?: string;
      extraRoots?: string[];
      logger?: { warn?(message: string): void };
      ttlMs?: number;
    },
  ) {}

  getIndex(): SkillIndex {
    const ttlMs = this.options.ttlMs ?? 60_000;
    if (this.current && Date.now() - this.current.refreshedAt < ttlMs) {
      return this.current;
    }
    this.current = buildSkillIndex({
      workspaceDir: this.options.workspaceDir,
      extraRoots: this.options.extraRoots,
      logger: this.options.logger,
    });
    return this.current;
  }

  clear() {
    this.current = null;
  }
}
