import { describe, expect, it } from "vitest";
import { AUTH_NONE, sendRequest, withGatewayServer } from "./server-http.test-harness.js";

describe("Observation Workbench HTTP surface", () => {
  it("serves the workbench shell at /observations", async () => {
    await withGatewayServer({
      prefix: "crawclaw-observation-workbench-",
      resolvedAuth: AUTH_NONE,
      run: async (server) => {
        const response = await sendRequest(server, {
          path: "/observations",
          host: "127.0.0.1:18789",
        });

        expect(response.res.statusCode).toBe(200);
        expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
        expect(response.getBody()).toContain("Observation Workbench");
        expect(response.getBody()).toContain("crawclaw.observation.locale");
        expect(response.getBody()).toContain("/observations/app.js");
        expect(response.getBody()).toContain("/observations/styles.css");
      },
    });
  });

  it("serves browser assets with localized copy and redaction helpers", async () => {
    await withGatewayServer({
      prefix: "crawclaw-observation-workbench-assets-",
      resolvedAuth: AUTH_NONE,
      run: async (server) => {
        const script = await sendRequest(server, {
          path: "/observations/app.js",
          host: "127.0.0.1:18789",
        });
        const styles = await sendRequest(server, {
          path: "/observations/styles.css",
          host: "127.0.0.1:18789",
        });

        expect(script.res.statusCode).toBe(200);
        expect(script.setHeader).toHaveBeenCalledWith(
          "Content-Type",
          "application/javascript; charset=utf-8",
        );
        expect(script.getBody()).toContain("agent.observations.list");
        expect(script.getBody()).toContain("agent.inspect");
        expect(script.getBody()).toContain("from");
        expect(script.getBody()).toContain("to");
        expect(script.getBody()).toContain("Load more");
        expect(script.getBody()).toContain("setInterval(loadRuns, 10000)");
        expect(script.getBody()).toContain("2000");
        expect(script.getBody()).toContain("中文");
        expect(script.getBody()).toContain("EN");
        expect(script.getBody()).toContain("prompt");
        expect(script.getBody()).toContain("transcript");
        expect(script.getBody()).toContain("tool result");
        expect(styles.res.statusCode).toBe(200);
        expect(styles.setHeader).toHaveBeenCalledWith("Content-Type", "text/css; charset=utf-8");
        expect(styles.getBody()).toContain("@media (max-width: 860px)");
        expect(styles.getBody()).toContain("grid-template-columns");
      },
    });
  });
});
