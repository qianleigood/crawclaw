export type SpawnAcpParams = {
  task: string;
  label?: string;
  agentId?: string;
  resumeSessionId?: string;
  cwd?: string;
  mode?: "run" | "session";
  thread?: boolean;
  streamTo?: "parent";
};

export type SpawnAcpContext = {
  agentSessionKey?: string;
  agentChannel?: string;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string;
};

export type SpawnAcpResult =
  | {
      status: "accepted";
      childSessionKey?: string;
      runId?: string;
      mode?: "run" | "session";
    }
  | {
      status: "error";
      error: string;
      childSessionKey?: string;
      runId?: string;
      mode?: "run" | "session";
    };

export async function spawnAcpDirect(
  params: SpawnAcpParams,
  context?: SpawnAcpContext,
): Promise<SpawnAcpResult> {
  void params;
  void context;
  return {
    status: "error",
    error: "ACP spawning is not available in this TS runtime surface.",
  };
}
