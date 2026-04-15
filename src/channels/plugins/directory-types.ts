import type { CrawClawConfig } from "../../config/types.js";

export type DirectoryConfigParams = {
  cfg: CrawClawConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
