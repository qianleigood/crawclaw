import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { SqliteRuntimeStore } from "./sqlite-runtime-store.js";

const tempDirs = createTrackedTempDirs();
const stores: SqliteRuntimeStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  await tempDirs.cleanup();
});

describe("SqliteRuntimeStore context assembly audits", () => {
  it("round-trips system context tokens via context assembly audits", async () => {
    const rootDir = await tempDirs.make("sqlite-context-assembly-audit-");
    const store = new SqliteRuntimeStore(`${rootDir}/runtime.sqlite`);
    await store.init();
    stores.push(store);

    await store.appendContextAssemblyAudit({
      sessionId: "session-1",
      prompt: "assemble this",
      rawMessageCount: 12,
      compactedMessageCount: 9,
      rawMessageTokens: 2_000,
      compactedMessageTokens: 1_200,
      sessionMemoryTokens: 180,
      recallTokens: 420,
      systemContextTokens: 640,
      preservedTailStartTurn: 4,
      compactionStatePresent: true,
      compactionMode: "session_memory",
      detailsJson: JSON.stringify({ test: true }),
      createdAt: 1_717_171_717_000,
    });

    const audits = await store.listRecentContextAssemblyAudits(5, "session-1");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.systemContextTokens).toBe(640);
    expect(audits[0]?.compactionMode).toBe("session_memory");
  });
});
