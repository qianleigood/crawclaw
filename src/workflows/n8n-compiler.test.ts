import { describe, expect, it } from "vitest";
import { compileWorkflowSpecToN8n, getWorkflowN8nCallbackCompileError } from "./n8n-compiler.js";
import type { WorkflowSpec } from "./types.js";

function compileWorkflowSpecToN8nForTest(
  spec: WorkflowSpec,
  options?: Parameters<typeof compileWorkflowSpecToN8n>[1],
) {
  return compileWorkflowSpecToN8n(spec, {
    triggerBearerToken: "trigger-secret",
    ...options,
  });
}

describe("n8n compiler", () => {
  it("requires trigger bearer token for n8n webhook workflows", () => {
    expect(() =>
      compileWorkflowSpecToN8n({
        workflowId: "wf_trigger_auth_123",
        name: "Trigger Auth",
        goal: "Require trigger auth",
        tags: [],
        inputs: [],
        outputs: [],
        steps: [{ id: "prepare", kind: "native", title: "Prepare" }],
        createdAt: 0,
        updatedAt: 0,
      }),
    ).toThrow(/triggerBearerToken/);
  });

  it("compiles workflow steps into a sequential n8n draft", () => {
    const compiled = compileWorkflowSpecToN8nForTest({
      workflowId: "wf_publish_redbook_123",
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      sourceWorkspaceDir: "/tmp/workspace-redbook",
      sourceSessionKey: "agent:main:main",
      tags: ["redbook"],
      inputs: [{ name: "topic", type: "string", required: true }],
      outputs: [{ name: "postUrl", type: "string", required: false }],
      steps: [
        { id: "draft", kind: "crawclaw_agent", title: "Draft content", goal: "Draft content" },
        { id: "review", kind: "human_wait", prompt: "Approve publishing" },
        { id: "publish", kind: "service", service: "redbook-publisher", goal: "Publish post" },
      ],
      createdAt: 0,
      updatedAt: 0,
    });

    expect(compiled.nodes).toHaveLength(6);
    expect(compiled.nodes[0]?.type).toBe("n8n-nodes-base.webhook");
    expect(compiled.nodes[1]?.type).toBe("n8n-nodes-base.code");
    expect(compiled.nodes[2]?.type).toBe("n8n-nodes-base.code");
    expect(compiled.nodes[3]?.type).toBe("n8n-nodes-base.code");
    expect(compiled.nodes[4]?.type).toBe("n8n-nodes-base.wait");
    expect(compiled.nodes[5]?.type).toBe("n8n-nodes-base.code");
    expect(compiled.connections["When webhook is called"]).toBeTruthy();
    expect(compiled.connections["Validate CrawClaw trigger token"]).toBeTruthy();
    expect(compiled.connections["Normalize workflow input"]).toBeTruthy();
    expect(compiled.staticData.crawclawWorkflowId).toBe("wf_publish_redbook_123");
    expect(compiled.staticData.crawclawTriggerPath).toBe("crawclaw-wf_publish_redbook_123");
    expect(
      (compiled.staticData.crawclawStepContracts as Array<Record<string, unknown>>).slice(0, 2),
    ).toMatchObject([
      {
        stepId: "draft",
        path: "main",
        activation: { mode: "sequential" },
      },
      {
        stepId: "review",
        kind: "human_wait",
        waitKind: "input",
      },
    ]);
    expect(
      (
        compiled.nodes[3] as {
          meta?: {
            crawclawAgentContract?: { workspaceBinding?: { workspaceDir?: string } };
            crawclawStepContract?: { path?: string; activation?: { mode?: string } };
          };
        }
      ).meta?.crawclawAgentContract?.workspaceBinding?.workspaceDir,
    ).toBe("/tmp/workspace-redbook");
    expect(
      (
        compiled.nodes[3] as {
          meta?: { crawclawStepContract?: { path?: string; activation?: { mode?: string } } };
        }
      ).meta?.crawclawStepContract,
    ).toMatchObject({
      path: "main",
      activation: { mode: "sequential" },
    });
  });

  it("compiles crawclaw_agent steps into HTTP callback nodes with n8n credentials when callback config is set", () => {
    const compiled = compileWorkflowSpecToN8nForTest(
      {
        workflowId: "wf_publish_redbook_123",
        name: "Publish Redbook Note",
        goal: "Generate and publish a redbook post",
        sourceWorkspaceDir: "/tmp/workspace-redbook",
        sourceSessionKey: "agent:main:main",
        tags: ["redbook"],
        inputs: [{ name: "topic", type: "string", required: true }],
        outputs: [{ name: "postUrl", type: "string", required: false }],
        steps: [
          { id: "draft", kind: "crawclaw_agent", title: "Draft content", goal: "Draft content" },
        ],
        createdAt: 0,
        updatedAt: 0,
      },
      {
        callbackBaseUrl: "https://crawclaw.example.com/",
        callbackCredentialId: "cred-callback-1",
        callbackCredentialName: "CrawClaw Callback Auth",
      },
    );

    expect(compiled.nodes).toHaveLength(4);
    expect(compiled.nodes[3]?.type).toBe("n8n-nodes-base.httpRequest");
    expect(
      (
        compiled.nodes[3] as {
          parameters?: {
            url?: string;
            authentication?: string;
            genericAuthType?: string;
            headerParameters?: { parameters?: Array<{ name?: string; value?: string }> };
          };
          credentials?: { httpHeaderAuth?: { id?: string; name?: string } };
        }
      ).parameters,
    ).toMatchObject({
      url: "https://crawclaw.example.com/workflows/agent/run",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
    });
    expect(
      (
        compiled.nodes[3] as {
          credentials?: { httpHeaderAuth?: { id?: string; name?: string } };
        }
      ).credentials,
    ).toEqual({
      httpHeaderAuth: {
        id: "cred-callback-1",
        name: "CrawClaw Callback Auth",
      },
    });
    expect(
      (
        compiled.nodes[3] as {
          parameters?: {
            jsonBody?: string;
            headerParameters?: { parameters?: Array<{ name?: string; value?: string }> };
          };
        }
      ).parameters?.jsonBody,
    ).toContain("$execution.id");
    expect(
      (
        compiled.nodes[3] as {
          parameters?: {
            jsonBody?: string;
          };
          meta?: {
            crawclawAgentContract?: {
              activation?: { when?: string };
            };
          };
        }
      ).parameters?.jsonBody,
    ).not.toContain("{{ $");
    expect(
      (
        compiled.nodes[3] as {
          meta?: {
            crawclawAgentContract?: {
              activation?: { when?: string };
            };
          };
        }
      ).meta?.crawclawAgentContract?.activation?.when,
    ).toBeUndefined();
    expect(
      (
        compiled.nodes[3] as {
          parameters?: {
            headerParameters?: { parameters?: Array<{ name?: string; value?: string }> };
          };
        }
      ).parameters?.headerParameters?.parameters,
    ).toEqual([{ name: "Content-Type", value: "application/json" }]);
    expect(compiled.staticData.crawclawCallbackUrl).toBe(
      "https://crawclaw.example.com/workflows/agent/run",
    );
  });

  it("normalizes conditional activation metadata in crawclaw_agent callback contracts", () => {
    const compiled = compileWorkflowSpecToN8nForTest(
      {
        workflowId: "wf_branch_agent_123",
        name: "Branch Agent Workflow",
        goal: "Route to an agent step after approval",
        topology: "branch_v2",
        tags: [],
        inputs: [{ name: "requiresApproval", type: "boolean", required: false }],
        outputs: [],
        steps: [
          { id: "prepare", kind: "native", title: "Prepare" },
          {
            id: "approval_path",
            kind: "crawclaw_agent",
            title: "Approval Path",
            path: "approval",
            branchGroup: "review",
            activation: {
              mode: "conditional",
              when: "{{ $workflowInput.requiresApproval === true }}",
              fromStepIds: ["prepare"],
            },
          },
        ],
        createdAt: 0,
        updatedAt: 0,
      },
      {
        callbackBaseUrl: "https://crawclaw.example.com/",
        callbackCredentialId: "cred-callback-1",
        callbackCredentialName: "CrawClaw Callback Auth",
      },
    );

    const callbackNode = compiled.nodes.find(
      (node) => node.type === "n8n-nodes-base.httpRequest",
    ) as
      | {
          parameters?: { jsonBody?: string };
          meta?: {
            crawclawAgentContract?: {
              activation?: { mode?: string; when?: string; fromStepIds?: string[] };
            };
          };
        }
      | undefined;

    expect(callbackNode?.meta?.crawclawAgentContract?.activation).toEqual({
      mode: "conditional",
      when: "$workflowInput.requiresApproval === true",
      fromStepIds: ["prepare"],
    });
    expect(callbackNode?.parameters?.jsonBody).toContain(
      '"when": "$workflowInput.requiresApproval === true"',
    );
    expect(callbackNode?.parameters?.jsonBody).not.toContain("{{ $");
  });

  it("fails compile validation when crawclaw_agent steps have no callback auth", () => {
    expect(
      getWorkflowN8nCallbackCompileError(
        {
          workflowId: "wf_publish_redbook_123",
          name: "Publish Redbook Note",
          goal: "Generate and publish a redbook post",
          tags: ["redbook"],
          inputs: [{ name: "topic", type: "string", required: true }],
          outputs: [],
          steps: [
            { id: "draft", kind: "crawclaw_agent", title: "Draft content", goal: "Draft content" },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        {
          callbackBaseUrl: "https://crawclaw.example.com/",
        },
      ),
    ).toContain("callback auth is not configured");
  });

  it("compiles service steps with serviceRequest into httpRequest nodes", () => {
    const compiled = compileWorkflowSpecToN8nForTest({
      workflowId: "wf_publish_redbook_123",
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      tags: ["redbook"],
      inputs: [{ name: "topic", type: "string", required: true }],
      outputs: [],
      steps: [
        {
          id: "publish",
          kind: "service",
          title: "Publish post",
          service: "publisher",
          serviceRequest: {
            url: "https://api.example.com/publish",
            method: "POST",
            body: {
              topic: "$json.topic",
            },
          },
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    });

    expect(compiled.nodes[3]?.type).toBe("n8n-nodes-base.httpRequest");
    expect(
      (compiled.nodes[3] as { parameters?: { method?: string; url?: string } }).parameters,
    ).toMatchObject({
      method: "POST",
      url: "https://api.example.com/publish",
    });
  });

  it("rejects plaintext sensitive serviceRequest headers", () => {
    expect(() =>
      compileWorkflowSpecToN8nForTest({
        workflowId: "wf_publish_redbook_123",
        name: "Publish Redbook Note",
        goal: "Generate and publish a redbook post",
        tags: ["redbook"],
        inputs: [],
        outputs: [],
        steps: [
          {
            id: "publish",
            kind: "service",
            serviceRequest: {
              url: "https://api.example.com/publish",
              headers: {
                Authorization: "Bearer token",
              },
            },
          },
        ],
        createdAt: 0,
        updatedAt: 0,
      }),
    ).toThrow(/sensitive serviceRequest header "Authorization"/);
  });

  it("compiles native placeholder steps into real Set nodes", () => {
    const compiled = compileWorkflowSpecToN8nForTest({
      workflowId: "wf_native_123",
      name: "Prepare Inputs",
      goal: "Prepare workflow inputs",
      tags: [],
      inputs: [],
      outputs: [],
      steps: [
        {
          id: "prepare",
          kind: "native",
          title: "Prepare Input",
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    });

    expect(compiled.nodes[3]?.type).toBe("n8n-nodes-base.set");
    expect(
      (
        compiled.nodes[3] as {
          parameters?: {
            includeOtherFields?: boolean;
            assignments?: { assignments?: Array<{ name?: string }> };
          };
        }
      ).parameters,
    ).toEqual(
      expect.objectContaining({
        includeOtherFields: true,
        assignments: {
          assignments: expect.arrayContaining([
            expect.objectContaining({ name: "crawclaw_step_id" }),
            expect.objectContaining({ name: "crawclaw_step_kind" }),
          ]),
        },
      }),
    );
  });

  it("compiles branch_v2 workflows into conditional gates and join helpers", () => {
    const compiled = compileWorkflowSpecToN8nForTest({
      workflowId: "wf_branchy_123",
      name: "Branchy Workflow",
      goal: "Branch on approval and join before publish",
      topology: "branch_v2",
      tags: [],
      inputs: [],
      outputs: [],
      steps: [
        { id: "prepare", kind: "native", title: "Prepare" },
        {
          id: "approval_path",
          kind: "human_wait",
          title: "Approval Path",
          path: "approval",
          branchGroup: "review",
          activation: {
            mode: "conditional",
            when: "{{ $workflowInput.requiresApproval === true }}",
            fromStepIds: ["prepare"],
          },
        },
        {
          id: "fast_path",
          kind: "service",
          title: "Fast Path",
          path: "fast",
          branchGroup: "review",
          activation: {
            mode: "conditional",
            when: "{{ $workflowInput.requiresApproval !== true }}",
            fromStepIds: ["prepare"],
          },
          serviceRequest: {
            url: "https://api.example.com/fast-path",
            method: "POST",
          },
        },
        {
          id: "publish",
          kind: "service",
          title: "Publish",
          activation: {
            mode: "fan_in",
            fromStepIds: ["approval_path", "fast_path"],
          },
          serviceRequest: {
            url: "https://api.example.com/publish",
            method: "POST",
          },
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    });

    expect(compiled.nodes.some((node) => node.type === "n8n-nodes-base.merge")).toBe(true);
    expect(
      compiled.nodes.some(
        (node) =>
          node.type === "n8n-nodes-base.code" &&
          String((node as { meta?: { crawclawHelperKind?: string } }).meta?.crawclawHelperKind) ===
            "conditional_gate",
      ),
    ).toBe(true);
    const conditionalGateNode = compiled.nodes.find(
      (node) =>
        node.type === "n8n-nodes-base.code" &&
        String((node as { meta?: { crawclawHelperKind?: string } }).meta?.crawclawHelperKind) ===
          "conditional_gate",
    ) as { parameters?: { jsCode?: string } } | undefined;
    expect(conditionalGateNode?.parameters?.jsCode).toContain(
      "item.json.workflowInput.requiresApproval",
    );
    expect(compiled.connections["1. prepare · Prepare"]).toBeTruthy();
    expect(compiled.staticData.crawclawTopology).toBe("branch_v2");
    expect(compiled.staticData.crawclawWorkflowInputNamespace).toBe("workflowInput");
  });

  it("compiles branch_v2 fan_out workflows into parallel branch connections without conditional gates", () => {
    const compiled = compileWorkflowSpecToN8nForTest({
      workflowId: "wf_branch_fan_out_123",
      name: "Fan Out Workflow",
      goal: "Run parallel branches and join them",
      topology: "branch_v2",
      tags: [],
      inputs: [],
      outputs: [],
      steps: [
        { id: "prepare", kind: "native", title: "Prepare" },
        {
          id: "title_path",
          kind: "crawclaw_agent",
          title: "Draft Title",
          path: "title",
          branchGroup: "draft_assets",
          activation: {
            mode: "fan_out",
            fromStepIds: ["prepare"],
          },
        },
        {
          id: "cover_path",
          kind: "service",
          title: "Draft Cover",
          path: "cover",
          branchGroup: "draft_assets",
          activation: {
            mode: "fan_out",
            fromStepIds: ["prepare"],
          },
          serviceRequest: {
            url: "https://api.example.com/cover",
            method: "POST",
          },
        },
        {
          id: "publish",
          kind: "service",
          title: "Publish",
          activation: {
            mode: "fan_in",
            fromStepIds: ["title_path", "cover_path"],
          },
          serviceRequest: {
            url: "https://api.example.com/publish",
            method: "POST",
          },
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    });

    const prepareConnections = compiled.connections["1. prepare · Prepare"] as
      | { main?: Array<Array<{ node?: string }>> }
      | undefined;
    expect(prepareConnections?.main?.[0]?.map((entry) => entry.node).toSorted()).toEqual([
      "2. title_path · Draft Title",
      "3. cover_path · Draft Cover",
    ]);
    expect(
      compiled.nodes.some(
        (node) =>
          node.type === "n8n-nodes-base.code" &&
          String((node as { meta?: { crawclawHelperKind?: string } }).meta?.crawclawHelperKind) ===
            "conditional_gate",
      ),
    ).toBe(false);
    const parallelSteps = (
      compiled.staticData.crawclawStepContracts as Array<{
        stepId?: string;
        branchResolution?: string;
        activation?: { mode?: string };
      }>
    ).filter((step) => step.stepId === "title_path" || step.stepId === "cover_path");
    expect(parallelSteps).toHaveLength(2);
    expect(parallelSteps.every((step) => step.branchResolution === "parallel")).toBe(true);
    expect(parallelSteps.every((step) => step.activation?.mode === "fan_out")).toBe(true);
  });

  it("applies fan_out failure and retry controls to compiled step nodes", () => {
    const compiled = compileWorkflowSpecToN8nForTest(
      {
        workflowId: "wf_branch_fan_out_controls_123",
        name: "Fan Out Controls",
        goal: "Compile retry and failure controls",
        topology: "branch_v2",
        tags: [],
        inputs: [],
        outputs: [],
        steps: [
          { id: "prepare", kind: "native", title: "Prepare" },
          {
            id: "parallel_agent",
            kind: "crawclaw_agent",
            title: "Parallel Agent",
            path: "agent",
            branchGroup: "asset_bundle",
            activation: {
              mode: "fan_out",
              fromStepIds: ["prepare"],
              parallel: {
                failurePolicy: "continue",
                joinPolicy: "best_effort",
                maxActiveBranches: 2,
                retryOnFail: true,
                maxTries: 4,
                waitBetweenTriesMs: 1500,
              },
            },
            compensation: {
              mode: "crawclaw_agent",
              goal: "Compensate failed parallel agent step",
            },
          },
        ],
        createdAt: 0,
        updatedAt: 0,
      },
      {
        callbackBaseUrl: "https://crawclaw.example.com/",
        callbackCredentialId: "cred-callback-1",
        callbackCredentialName: "CrawClaw Callback Auth",
      },
    );

    const fanOutNode = compiled.nodes.find(
      (node) => node.name === "2. parallel_agent · Parallel Agent",
    ) as
      | {
          onError?: string;
          retryOnFail?: boolean;
          maxTries?: number;
          waitBetweenTries?: number;
          meta?: {
            crawclawStepContract?: {
              parallel?: {
                failurePolicy?: string;
                joinPolicy?: string;
                maxActiveBranches?: number;
                retryOnFail?: boolean;
                maxTries?: number;
                waitBetweenTriesMs?: number;
              };
            };
          };
        }
      | undefined;

    expect(fanOutNode?.onError).toBe("continueRegularOutput");
    expect(fanOutNode?.retryOnFail).toBe(true);
    expect(fanOutNode?.maxTries).toBe(4);
    expect(fanOutNode?.waitBetweenTries).toBe(1500);
    expect(fanOutNode?.meta?.crawclawStepContract?.parallel).toMatchObject({
      failurePolicy: "continue",
      joinPolicy: "best_effort",
      maxActiveBranches: 2,
      retryOnFail: true,
      maxTries: 4,
      waitBetweenTriesMs: 1500,
    });
  });

  it("fails fast when fan_out width exceeds the declared maxActiveBranches cap", () => {
    expect(() =>
      compileWorkflowSpecToN8nForTest({
        workflowId: "wf_branch_fan_out_throttle_123",
        name: "Fan Out Throttle",
        goal: "Reject unsupported lower-width fan out",
        topology: "branch_v2",
        tags: [],
        inputs: [],
        outputs: [],
        steps: [
          { id: "prepare", kind: "native", title: "Prepare" },
          {
            id: "title_path",
            kind: "crawclaw_agent",
            title: "Draft Title",
            path: "title",
            branchGroup: "asset_bundle",
            activation: {
              mode: "fan_out",
              fromStepIds: ["prepare"],
              parallel: {
                maxActiveBranches: 1,
              },
            },
          },
          {
            id: "cover_path",
            kind: "native",
            title: "Draft Cover",
            path: "cover",
            branchGroup: "asset_bundle",
            activation: {
              mode: "fan_out",
              fromStepIds: ["prepare"],
              parallel: {
                maxActiveBranches: 1,
              },
            },
          },
        ],
        createdAt: 0,
        updatedAt: 0,
      }),
    ).toThrow(/fan_out width/);
  });

  it("fails fast when a linear workflow includes branch-aware step metadata", () => {
    expect(() =>
      compileWorkflowSpecToN8nForTest({
        workflowId: "wf_branch_contract_123",
        name: "Branch Contract Workflow",
        goal: "Try conditional activation metadata",
        topology: "linear_v1",
        tags: [],
        inputs: [],
        outputs: [],
        steps: [
          {
            id: "prepare",
            kind: "native",
            title: "Prepare",
            activation: {
              mode: "conditional",
              when: "{{ $json.should_continue === true }}",
            },
          },
        ],
        createdAt: 0,
        updatedAt: 0,
      }),
    ).toThrow(/non-linear step metadata/);
  });
});
