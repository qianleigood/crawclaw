import { describe, expect, it } from "vitest";
import { validateConfigObjectRaw } from "./validation.js";

describe("config validation SecretRef policy guards", () => {
  it("surfaces a policy error for hooks.token SecretRef objects", () => {
    const result = validateConfigObjectRaw({
      hooks: {
        token: {
          source: "env",
          provider: "default",
          id: "HOOK_TOKEN",
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.path === "hooks.token");
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("SecretRef objects are not supported at hooks.token");
      expect(issue?.message).toContain(
        "https://docs.crawclaw.ai/reference/secretref-credential-surface",
      );
      expect(
        result.issues.some(
          (entry) =>
            entry.path === "hooks.token" &&
            entry.message.includes("Invalid input: expected string, received object"),
        ),
      ).toBe(false);
    }
  });

  it("keeps standard schema errors for non-SecretRef objects", () => {
    const result = validateConfigObjectRaw({
      hooks: {
        token: {
          unexpected: "value",
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.path === "hooks.token");
      expect(issue).toBeDefined();
      expect(issue?.message).toBe("Invalid input: expected string, received object");
    }
  });

  it("allows env-template strings on unsupported mutable paths", () => {
    const result = validateConfigObjectRaw({
      hooks: {
        token: "${HOOK_TOKEN}",
      },
    });

    expect(result.ok).toBe(true);
  });

});
