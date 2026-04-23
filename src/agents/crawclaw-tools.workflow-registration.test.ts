import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { __testing as n8nTesting } from "../workflows/api.js";
import { createCrawClawTools } from "./crawclaw-tools.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  n8nTesting.setDepsForTest(null);
  await tempDirs.cleanup();
});

describe("crawclaw-tools workflow registration", () => {
  it("passes workflow config through to the registered workflow tool", async () => {
    const workspaceDir = await tempDirs.make("crawclaw-tools-workflow-");
    const tools = createCrawClawTools({
      workspaceDir,
      config: {
        workflow: {
          n8n: {
            baseUrl: "https://n8n.example.com",
            apiKey: "secret-token",
            triggerBearerToken: "trigger-secret",
            callbackBaseUrl: "https://gateway.example.com",
            callbackBearerToken: "callback-secret",
          },
        },
      },
    });

    const workflowize = tools.find((tool) => tool.name === "workflowize");
    const workflow = tools.find((tool) => tool.name === "workflow");
    expect(workflowize).toBeTruthy();
    expect(workflow).toBeTruthy();

    n8nTesting.setDepsForTest({
      fetchImpl: async (input) => {
        const url = input instanceof URL ? input.href : input;
        const urlText = typeof url === "string" ? url : url.url;
        if (urlText.endsWith("/api/v1/workflows")) {
          return new Response(
            JSON.stringify({
              id: "wf_remote",
              name: "Publish Redbook Note",
              nodes: [],
              connections: {},
              settings: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (urlText.endsWith("/api/v1/workflows/wf_remote/activate")) {
          return new Response(JSON.stringify({ id: "wf_remote", active: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL ${urlText}`);
      },
    });

    await workflowize?.execute("workflowize-registered", {
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
    });

    const deployed = (
      await workflow?.execute("workflow-deploy", {
        action: "deploy",
        workflow: "Publish Redbook Note",
      })
    )?.details as { workflow: { n8nWorkflowId: string } };

    expect(deployed.workflow.n8nWorkflowId).toBe("wf_remote");
  });
});
