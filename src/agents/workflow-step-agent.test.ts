import { describe, expect, it } from "vitest";
import {
  buildWorkflowStepAgentMessage,
  buildWorkflowStepAgentRunParams,
  buildWorkflowStepAgentSessionKey,
  buildWorkflowStepAgentSystemPrompt,
  extractWorkflowStepAgentResult,
  runWorkflowStepAgent,
} from "./workflow-step-agent.js";

describe("workflow-step-agent helpers", () => {
  it("builds stable session keys and constrained run params", () => {
    const request = {
      workflowId: "wf_publish_redbook_123",
      executionId: "exec_456",
      topology: "branch_v2",
      stepId: "draft_post",
      stepPath: "approval",
      branchGroup: "review",
      activation: {
        mode: "conditional",
        when: "{{ $json.requiresApproval === true }}",
      },
      goal: "Draft the post copy",
      inputs: { topic: "AI workflow" },
      allowedTools: ["browser", "web_search"],
      allowedSkills: ["redbook-skills"],
      timeoutMs: 120000,
      maxSteps: 6,
    } as const;

    const sessionKey = buildWorkflowStepAgentSessionKey(request);
    expect(sessionKey).toContain("agent:workflow:");

    const prompt = buildWorkflowStepAgentSystemPrompt(request);
    expect(prompt).toContain("Topology: branch_v2");
    expect(prompt).toContain("Path: approval");
    expect(prompt).toContain("Branch group: review");
    expect(prompt).toContain("Activation mode: conditional");
    expect(prompt).toContain("Allowed tools: browser, web_search");
    expect(prompt).toContain("Allowed skills: redbook-skills");

    const message = buildWorkflowStepAgentMessage(request);
    expect(message).toContain("Draft the post copy");
    expect(message).toContain("AI workflow");

    const runParams = buildWorkflowStepAgentRunParams(request);
    expect(runParams.sessionKey).toBe(sessionKey);
    expect(runParams.toolsAllow).toEqual(["browser", "web_search"]);
    expect(runParams.skillsAllow).toEqual(["redbook-skills"]);
    expect(runParams.lane).toBe("workflow-step");
    expect(runParams.deliver).toBe(false);
    expect(runParams.idempotencyKey).toBe(
      "workflow-step:wf_publish_redbook_123:exec_456:draft_post",
    );
  });

  it("extracts structured results and runs workflow step agents through the subagent runtime", async () => {
    const request = {
      workflowId: "wf_publish_redbook_123",
      executionId: "exec_456",
      stepId: "draft_post",
      goal: "Draft the post copy",
      timeoutMs: 120000,
    };

    const parsed = extractWorkflowStepAgentResult([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "succeeded",
              summary: "Drafted post copy",
              output: { title: "AI workflow" },
            }),
          },
        ],
      },
    ]);
    expect(parsed?.status).toBe("succeeded");
    expect(
      parsed && "output" in parsed ? (parsed.output as { title: string }).title : undefined,
    ).toBe("AI workflow");

    let seenRunParams: unknown;
    const subagent = {
      run: async (params: unknown) => {
        seenRunParams = params;
        return { runId: "run-1" };
      },
      waitForRun: async () => ({ status: "ok" as const }),
      getSessionMessages: async () => ({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "succeeded",
                  summary: "Drafted post copy",
                  output: { title: "AI workflow" },
                }),
              },
            ],
          },
        ],
      }),
      deleteSession: async () => {},
    };

    const ran = await runWorkflowStepAgent(subagent, request);
    expect(seenRunParams).toMatchObject({
      sessionKey: expect.stringContaining("agent:workflow:"),
    });
    expect(ran.runId).toBe("run-1");
    expect(ran.waitStatus).toBe("ok");
    expect(ran.result?.status).toBe("succeeded");
  });
});
