import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { coreGatewayHandlers } from "./legacy-ts-gateway-handlers.js";
import {
  authorizeOperatorScopesForMethod,
  isGatewayMethodClassified,
  resolveLeastPrivilegeOperatorScopesForMethod,
} from "./method-scopes.js";
import { listGatewayMethods } from "./server-methods-list.js";

const gatewayDir = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  setActivePluginRegistry(createEmptyPluginRegistry());
});

describe("method scope resolution", () => {
  it.each([
    ["sessions.resolve", ["operator.read"]],
    ["config.schema.lookup", ["operator.read"]],
    ["agent.inspect", ["operator.read"]],
    ["agent.observations.list", ["operator.read"]],
    ["system.health", ["operator.read"]],
    ["system.status", ["operator.read"]],
    ["system.mainSessionWake.last", ["operator.read"]],
    ["workflow.list", ["operator.read"]],
    ["workflow.get", ["operator.read"]],
    ["workflow.status", ["operator.read"]],
    ["memory.status", ["operator.read"]],
    ["memory.admin.overview", ["operator.read"]],
    ["memory.durable.index.list", ["operator.read"]],
    ["memory.durable.index.get", ["operator.read"]],
    ["memory.dream.status", ["operator.read"]],
    ["memory.sessionSummary.status", ["operator.read"]],
    ["channels.capabilities", ["operator.read"]],
    ["channels.setup.surface", ["operator.read"]],
    ["channels.config.get", ["operator.read"]],
    ["channels.config.schema", ["operator.read"]],
    ["channels.account.verify", ["operator.read"]],
    ["channel.directory.lookup", ["operator.read"]],
    ["channel.lifecycle.status", ["operator.read"]],
    ["sessions.create", ["operator.write"]],
    ["sessions.send", ["operator.write"]],
    ["sessions.abort", ["operator.write"]],
    ["workflow.run", ["operator.write"]],
    ["workflow.deploy", ["operator.write"]],
    ["memory.dream.run", ["operator.write"]],
    ["memory.sessionSummary.refresh", ["operator.write"]],
    ["workflow.agent.run", ["operator.write"]],
    ["agent.runTurn", ["operator.write"]],
    ["agent.streamEvents", ["operator.read"]],
    ["agent.cancel", ["operator.write"]],
    ["sessions.messages.subscribe", ["operator.read"]],
    ["sessions.messages.unsubscribe", ["operator.read"]],
    ["channel.outbound.send", ["operator.write"]],
    ["channel.outbound.poll", ["operator.write"]],
    ["channel.outbound.action", ["operator.write"]],
    ["channel.inbound.handle", ["operator.write"]],
    ["poll", ["operator.write"]],
    ["config.patch", ["operator.admin"]],
    ["channels.account.login.start", ["operator.admin"]],
    ["channels.account.login.wait", ["operator.admin"]],
    ["channels.account.reconnect", ["operator.admin"]],
    ["channels.config.patch", ["operator.admin"]],
    ["channels.config.apply", ["operator.admin"]],
    ["channels.account.logout", ["operator.admin"]],
    ["channel.lifecycle.start", ["operator.admin"]],
    ["channel.lifecycle.stop", ["operator.admin"]],
    ["channel.lifecycle.restart", ["operator.admin"]],
    ["memory.refresh", ["operator.admin"]],
    ["memory.login", ["operator.admin"]],
    ["wizard.start", ["operator.admin"]],
    ["update.run", ["operator.admin"]],
  ])("resolves least-privilege scopes for %s", (method, expected) => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod(method)).toEqual(expected);
  });

  it("returns empty scopes for removed methods", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("removed.method")).toEqual([]);
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
    expect(authorizeOperatorScopesForMethod("sessions.create", ["operator.read"])).toEqual({
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

  it("classifies agent.runTurn as a write method", () => {
    expect(listGatewayMethods()).toContain("agent.runTurn");
    expect(listGatewayMethods()).toContain("agent.streamEvents");
    expect(listGatewayMethods()).toContain("agent.cancel");
    expect(isGatewayMethodClassified("agent.runTurn")).toBe(true);
    expect(isGatewayMethodClassified("agent.streamEvents")).toBe(true);
    expect(isGatewayMethodClassified("agent.cancel")).toBe(true);
    expect(resolveLeastPrivilegeOperatorScopesForMethod("agent.runTurn")).toEqual([
      "operator.write",
    ]);
    expect(resolveLeastPrivilegeOperatorScopesForMethod("agent.streamEvents")).toEqual([
      "operator.read",
    ]);
    expect(resolveLeastPrivilegeOperatorScopesForMethod("agent.cancel")).toEqual([
      "operator.write",
    ]);
  });
});

describe("core gateway method classification", () => {
  it("keeps the core method list independent from the TS channel plugin registry", () => {
    const source = fs.readFileSync(path.join(gatewayDir, "server-methods-list.ts"), "utf8");

    expect(source).not.toMatch(/channels\/plugins\/index\.js/);
    expect(source).not.toMatch(/listChannelPlugins/);
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
