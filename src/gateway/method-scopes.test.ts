import { afterEach, describe, expect, it } from "vitest";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import {
  authorizeOperatorScopesForMethod,
  isGatewayMethodClassified,
  resolveLeastPrivilegeOperatorScopesForMethod,
} from "./method-scopes.js";
import { listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers } from "./server-methods.js";

afterEach(() => {
  setActivePluginRegistry(createEmptyPluginRegistry());
});

describe("method scope resolution", () => {
  it.each([
    ["sessions.resolve", ["operator.read"]],
    ["config.schema.lookup", ["operator.read"]],
    ["agent.inspect", ["operator.read"]],
    ["system.health", ["operator.read"]],
    ["system.status", ["operator.read"]],
    ["system.heartbeat.last", ["operator.read"]],
    ["workflow.list", ["operator.read"]],
    ["workflow.get", ["operator.read"]],
    ["workflow.status", ["operator.read"]],
    ["memory.status", ["operator.read"]],
    ["memory.dream.status", ["operator.read"]],
    ["memory.sessionSummary.status", ["operator.read"]],
    ["channels.account.verify", ["operator.read"]],
    ["sessions.create", ["operator.write"]],
    ["sessions.send", ["operator.write"]],
    ["sessions.abort", ["operator.write"]],
    ["workflow.run", ["operator.write"]],
    ["workflow.deploy", ["operator.write"]],
    ["memory.dream.run", ["operator.write"]],
    ["memory.sessionSummary.refresh", ["operator.write"]],
    ["workflow.agent.run", ["operator.write"]],
    ["sessions.messages.subscribe", ["operator.read"]],
    ["sessions.messages.unsubscribe", ["operator.read"]],
    ["node.pair.approve", ["operator.write"]],
    ["poll", ["operator.write"]],
    ["config.patch", ["operator.admin"]],
    ["channels.account.login.start", ["operator.admin"]],
    ["channels.account.login.wait", ["operator.admin"]],
    ["channels.account.reconnect", ["operator.admin"]],
    ["channels.account.logout", ["operator.admin"]],
    ["memory.refresh", ["operator.admin"]],
    ["memory.login", ["operator.admin"]],
    ["wizard.start", ["operator.admin"]],
    ["update.run", ["operator.admin"]],
  ])("resolves least-privilege scopes for %s", (method, expected) => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod(method)).toEqual(expected);
  });

  it("leaves node-only pending drain outside operator scopes", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("node.pending.drain")).toEqual([]);
  });

  it("returns empty scopes for unknown methods", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("totally.unknown.method")).toEqual([]);
  });

  it("reads plugin-registered gateway method scopes from the active plugin registry", () => {
    const registry = createEmptyPluginRegistry();
    registry.gatewayMethodScopes = {
      "plugin.example": "operator.write",
    };
    setActivePluginRegistry(registry);

    expect(resolveLeastPrivilegeOperatorScopesForMethod("plugin.example")).toEqual([
      "operator.write",
    ]);
  });
});

describe("operator scope authorization", () => {
  it.each([
    ["health", ["operator.read"], { allowed: true }],
    ["health", ["operator.write"], { allowed: true }],
    ["system.health", ["operator.read"], { allowed: true }],
    ["config.schema.lookup", ["operator.read"], { allowed: true }],
    ["config.patch", ["operator.admin"], { allowed: true }],
  ])("authorizes %s for scopes %j", (method, scopes, expected) => {
    expect(authorizeOperatorScopesForMethod(method, scopes)).toEqual(expected);
  });

  it("requires operator.write for write methods", () => {
    expect(authorizeOperatorScopesForMethod("send", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.write",
    });
    expect(authorizeOperatorScopesForMethod("node.pair.approve", ["operator.pairing"])).toEqual({
      allowed: false,
      missingScope: "operator.write",
    });
  });

  it("requires approvals scope for approval methods", () => {
    expect(authorizeOperatorScopesForMethod("exec.approval.resolve", ["operator.write"])).toEqual({
      allowed: false,
      missingScope: "operator.approvals",
    });
  });

  it.each(["plugin.approval.request", "plugin.approval.waitDecision", "plugin.approval.resolve"])(
    "requires approvals scope for %s",
    (method) => {
      expect(authorizeOperatorScopesForMethod(method, ["operator.write"])).toEqual({
        allowed: false,
        missingScope: "operator.approvals",
      });
      expect(authorizeOperatorScopesForMethod(method, ["operator.approvals"])).toEqual({
        allowed: true,
      });
    },
  );

  it("requires admin for unknown methods", () => {
    expect(authorizeOperatorScopesForMethod("unknown.method", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.admin",
    });
  });
});

describe("plugin approval method registration", () => {
  it("lists all plugin approval methods", () => {
    const methods = listGatewayMethods();
    expect(methods).toContain("plugin.approval.request");
    expect(methods).toContain("plugin.approval.waitDecision");
    expect(methods).toContain("plugin.approval.resolve");
  });

  it("classifies plugin approval methods", () => {
    expect(isGatewayMethodClassified("plugin.approval.request")).toBe(true);
    expect(isGatewayMethodClassified("plugin.approval.waitDecision")).toBe(true);
    expect(isGatewayMethodClassified("plugin.approval.resolve")).toBe(true);
  });

  it("classifies agent.inspect as a read method", () => {
    expect(isGatewayMethodClassified("agent.inspect")).toBe(true);
    expect(resolveLeastPrivilegeOperatorScopesForMethod("agent.inspect")).toEqual([
      "operator.read",
    ]);
  });
});

describe("core gateway method classification", () => {
  it("treats node-role methods as classified even without operator scopes", () => {
    expect(isGatewayMethodClassified("node.pending.drain")).toBe(true);
    expect(isGatewayMethodClassified("node.pending.pull")).toBe(true);
  });

  it("classifies every exposed core gateway handler method", () => {
    const unclassified = Object.keys(coreGatewayHandlers).filter(
      (method) => !isGatewayMethodClassified(method),
    );
    expect(unclassified).toEqual([]);
  });

  it("classifies every listed gateway method name", () => {
    const unclassified = listGatewayMethods().filter(
      (method) => !isGatewayMethodClassified(method),
    );
    expect(unclassified).toEqual([]);
  });
});
