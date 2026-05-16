import { resolveSessionAgentIds } from "../../agents/agent-scope.js";
import type { AgentTool } from "../../agents/agent-types.js";
import { resolveBootstrapContextForRun } from "../../agents/bootstrap-files.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import type { RuntimeContextFile } from "../../agents/runtime-context-file.js";
import { buildWorkspaceSkillsPrompt } from "../../agents/skills.js";
import { buildSystemPromptParams } from "../../agents/system-prompt-params.js";
import { buildAgentSystemPrompt } from "../../agents/system-prompt.js";
import { buildToolSummaryMap } from "../../agents/tool-summaries.js";
import type { WorkspaceBootstrapFile } from "../../agents/workspace.js";
import { callGateway } from "../../gateway/call.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { buildTtsSystemPromptHint } from "../../tts/tts.js";
import type { HandleCommandsParams } from "./commands-types.js";

export type CommandsSystemPromptBundle = {
  systemPrompt: string;
  tools: AgentTool[];
  skillsPrompt: string;
  bootstrapFiles: WorkspaceBootstrapFile[];
  injectedFiles: RuntimeContextFile[];
};

type RustGatewayToolEntry = {
  id?: unknown;
  name?: unknown;
  label?: unknown;
  description?: unknown;
  rawDescription?: unknown;
  parameters?: unknown;
};

type RustGatewayToolsResponse = {
  groups?: Array<{
    tools?: RustGatewayToolEntry[];
  }>;
};

async function loadRustRuntimeTools(params: HandleCommandsParams): Promise<AgentTool[]> {
  try {
    const result = await callGateway<RustGatewayToolsResponse>({
      method: "tools.effective",
      config: params.cfg,
      timeoutMs: 2_000,
      params: {
        agentId: params.agentId,
        sessionKey: params.sessionKey,
      },
    });
    const entries = result.groups?.flatMap((group) => group.tools ?? []) ?? [];
    return entries
      .map((tool) => {
        const name =
          typeof tool.name === "string" && tool.name.trim()
            ? tool.name.trim()
            : typeof tool.id === "string" && tool.id.trim()
              ? tool.id.trim()
              : "";
        if (!name) {
          return null;
        }
        return {
          name,
          label: typeof tool.label === "string" ? tool.label : name,
          description:
            typeof tool.rawDescription === "string"
              ? tool.rawDescription
              : typeof tool.description === "string"
                ? tool.description
                : undefined,
          parameters:
            tool.parameters && typeof tool.parameters === "object"
              ? tool.parameters
              : { type: "object" },
        } as AgentTool;
      })
      .filter((tool): tool is AgentTool => tool != null);
  } catch {
    return [];
  }
}

export async function resolveCommandsSystemPromptBundle(
  params: HandleCommandsParams,
): Promise<CommandsSystemPromptBundle> {
  const workspaceDir = params.workspaceDir;
  const { bootstrapFiles, contextFiles: injectedFiles } = await resolveBootstrapContextForRun({
    workspaceDir,
    config: params.cfg,
    sessionKey: params.sessionKey,
    sessionId: params.sessionEntry?.sessionId,
  });
  const skillsPrompt = (() => {
    try {
      return buildWorkspaceSkillsPrompt(workspaceDir, {
        config: params.cfg,
        eligibility: { remote: getRemoteSkillEligibility() },
      });
    } catch {
      return "";
    }
  })();
  const tools = await loadRustRuntimeTools(params);
  const toolSummaries = buildToolSummaryMap(tools);
  const toolNames = tools.map((tool) => tool.name);
  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.cfg,
    agentId: params.agentId,
  });
  const defaultModelRef = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: sessionAgentId,
  });
  const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
  const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
    config: params.cfg,
    agentId: sessionAgentId,
    workspaceDir,
    cwd: process.cwd(),
    runtime: {
      host: "unknown",
      os: "unknown",
      arch: "unknown",
      node: process.version,
      model: `${params.provider}/${params.model}`,
      defaultModel: defaultModelLabel,
    },
  });
  const ttsHint = params.cfg ? buildTtsSystemPromptHint(params.cfg) : undefined;

  const systemPrompt = buildAgentSystemPrompt({
    workspaceDir,
    defaultThinkLevel: params.resolvedThinkLevel,
    reasoningLevel: params.resolvedReasoningLevel,
    extraSystemPrompt: undefined,
    ownerNumbers: undefined,
    reasoningTagHint: false,
    toolNames,
    toolSummaries,
    modelAliasLines: [],
    userTimezone,
    userTime,
    userTimeFormat,
    contextFiles: injectedFiles,
    skillsPrompt,
    heartbeatPrompt: undefined,
    ttsHint,
    acpEnabled: params.cfg?.acp?.enabled !== false,
    runtimeInfo,
  });

  return { systemPrompt, tools, skillsPrompt, bootstrapFiles, injectedFiles };
}
