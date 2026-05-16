import type { AgentMessage } from "../agent-types.js";

export type TestSessionEntry =
  | {
      id: string;
      type: "message";
      parentId: string | null;
      message: AgentMessage;
    }
  | {
      id: string;
      type: "custom";
      parentId: string | null;
      customType: string;
      data: unknown;
    };

export type TestSessionManager = {
  appendMessage: (message: AgentMessage) => string;
  appendCustomEntry: (customType: string, data: unknown) => string;
  getEntries: () => TestSessionEntry[];
  getBranch: () => TestSessionEntry[];
  getSessionFile?: () => string | null | undefined;
};

type TestSessionEntryPayload =
  | {
      type: "message";
      message: AgentMessage;
    }
  | {
      type: "custom";
      customType: string;
      data: unknown;
    };

export function createInMemorySessionManager(): TestSessionManager {
  const entries: TestSessionEntry[] = [];
  let nextId = 0;
  let leafId: string | null = null;
  const appendEntry = (entry: TestSessionEntryPayload) => {
    const id = `entry_${++nextId}`;
    entries.push({ ...entry, id, parentId: leafId } as TestSessionEntry);
    leafId = id;
    return id;
  };
  return {
    appendMessage: (message) => appendEntry({ type: "message", message }),
    appendCustomEntry: (customType, data) => appendEntry({ type: "custom", customType, data }),
    getEntries: () => [...entries],
    getBranch: () => [...entries],
  };
}
