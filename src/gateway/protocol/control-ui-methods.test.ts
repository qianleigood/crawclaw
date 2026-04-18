import { describe, expect, it } from "vitest";
import {
  ControlUiMethodContract,
  ControlUiMethodList,
  LegacyAliasControlUiMethodList,
  OptionalControlUiMethodList,
  PreferredControlUiMethodList,
  StableControlUiMethodList,
  getControlUiMethodDefinition,
  hasControlUiMethodDefinition,
} from "./control-ui-methods.js";
import { ProtocolSchemas } from "./schema/protocol-schemas.js";

const FIRST_BATCH_METHODS = [
  "config.get",
  "config.schema",
  "config.schema.lookup",
  "config.set",
  "config.patch",
  "config.apply",
  "sessions.list",
  "sessions.get",
  "sessions.preview",
  "sessions.resolve",
  "sessions.subscribe",
  "sessions.unsubscribe",
  "sessions.messages.subscribe",
  "sessions.messages.unsubscribe",
  "sessions.create",
  "sessions.send",
  "sessions.steer",
  "sessions.abort",
  "sessions.patch",
  "sessions.reset",
  "sessions.delete",
  "sessions.compact",
  "sessions.usage",
  "sessions.usage.timeseries",
  "sessions.usage.logs",
  "channels.status",
  "channels.login.start",
  "channels.login.wait",
  "web.login.start",
  "web.login.wait",
  "exec.approvals.get",
  "exec.approvals.set",
  "exec.approvals.node.get",
  "exec.approvals.node.set",
  "agents.list",
  "agent.inspect",
  "tools.catalog",
  "tools.effective",
  "usage.status",
  "usage.cost",
  "workflow.list",
  "workflow.get",
  "workflow.match",
  "workflow.versions",
  "workflow.diff",
  "workflow.runs",
  "workflow.status",
  "workflow.enable",
  "workflow.disable",
  "workflow.archive",
  "workflow.unarchive",
  "workflow.delete",
  "workflow.update",
  "workflow.deploy",
  "workflow.republish",
  "workflow.rollback",
  "workflow.run",
  "workflow.cancel",
  "workflow.resume",
  "system.health",
  "system.status",
  "health",
  "status",
  "system-presence",
  "system.heartbeat.last",
  "last-heartbeat",
] as const;

describe("control-plane method contract", () => {
  it("covers the PR-CPA-04 method surface", () => {
    expect(ControlUiMethodList).toEqual(FIRST_BATCH_METHODS);
  });

  it("classifies every contract method with explicit least-privilege scopes", () => {
    const missingScopes = ControlUiMethodList.filter((method) => {
      const scopes = ControlUiMethodContract[method].requiredScopes;
      return !Array.isArray(scopes) || scopes.length === 0;
    });
    expect(missingScopes).toEqual([]);
  });

  it("marks login + node approvals as optional capability-gated surface", () => {
    expect(OptionalControlUiMethodList).toEqual([
      "channels.login.start",
      "channels.login.wait",
      "web.login.start",
      "web.login.wait",
      "exec.approvals.node.get",
      "exec.approvals.node.set",
    ]);
    expect(getControlUiMethodDefinition("channels.login.start")).toMatchObject({
      capability: "channels.login",
      stability: "optional",
      requiredScopes: ["operator.admin"],
    });
    expect(getControlUiMethodDefinition("channels.login.wait")).toMatchObject({
      capability: "channels.login",
      stability: "optional",
      requiredScopes: ["operator.admin"],
    });
    expect(getControlUiMethodDefinition("web.login.start")).toMatchObject({
      capability: "channels.login",
      stability: "optional",
      requiredScopes: ["operator.admin"],
      aliasFor: "channels.login.start",
    });
    expect(getControlUiMethodDefinition("web.login.wait")).toMatchObject({
      capability: "channels.login",
      stability: "optional",
      requiredScopes: ["operator.admin"],
      aliasFor: "channels.login.wait",
    });
    expect(getControlUiMethodDefinition("exec.approvals.node.get")).toMatchObject({
      capability: "exec.approvals.node",
      stability: "optional",
      requiredScopes: ["operator.read"],
    });
    expect(getControlUiMethodDefinition("exec.approvals.node.set")).toMatchObject({
      capability: "exec.approvals.node",
      stability: "optional",
      requiredScopes: ["operator.admin"],
    });
  });

  it("keeps the rest of the first batch on the stable surface", () => {
    expect(StableControlUiMethodList).toEqual(
      FIRST_BATCH_METHODS.filter(
        (method) =>
          method !== "web.login.start" &&
          method !== "web.login.wait" &&
          method !== "channels.login.start" &&
          method !== "channels.login.wait" &&
          method !== "exec.approvals.node.get" &&
          method !== "exec.approvals.node.set",
      ),
    );
  });

  it("tracks preferred names and legacy aliases for renamed control-plane methods", () => {
    expect(LegacyAliasControlUiMethodList).toEqual([
      "web.login.start",
      "web.login.wait",
      "health",
      "status",
      "last-heartbeat",
    ]);
    expect(PreferredControlUiMethodList).toContain("channels.login.start");
    expect(PreferredControlUiMethodList).toContain("system.health");
    expect(PreferredControlUiMethodList).toContain("system.status");
    expect(PreferredControlUiMethodList).toContain("system.heartbeat.last");
    expect(getControlUiMethodDefinition("health").aliasFor).toBe("system.health");
    expect(getControlUiMethodDefinition("status").aliasFor).toBe("system.status");
    expect(getControlUiMethodDefinition("last-heartbeat").aliasFor).toBe("system.heartbeat.last");
  });

  it("classifies workflow mutators and execution controls with write scope", () => {
    expect(getControlUiMethodDefinition("workflow.enable").requiredScopes).toEqual([
      "operator.write",
    ]);
    expect(getControlUiMethodDefinition("workflow.run").requiredScopes).toEqual(["operator.write"]);
    expect(getControlUiMethodDefinition("workflow.resume").requiredScopes).toEqual([
      "operator.write",
    ]);
  });

  it("keeps workflow reads, usage reads, and agent/tool inspection on read scope", () => {
    expect(getControlUiMethodDefinition("workflow.list").requiredScopes).toEqual(["operator.read"]);
    expect(getControlUiMethodDefinition("workflow.status").requiredScopes).toEqual([
      "operator.read",
    ]);
    expect(getControlUiMethodDefinition("usage.cost").requiredScopes).toEqual(["operator.read"]);
    expect(getControlUiMethodDefinition("agents.list").requiredScopes).toEqual(["operator.read"]);
    expect(getControlUiMethodDefinition("tools.effective").requiredScopes).toEqual([
      "operator.read",
    ]);
    expect(getControlUiMethodDefinition("agent.inspect").requiredScopes).toEqual(["operator.read"]);
  });

  it("records config write effects for mutating config methods", () => {
    expect(getControlUiMethodDefinition("config.set").effects).toEqual({
      writesConfig: true,
      restart: "none",
    });
    expect(getControlUiMethodDefinition("config.patch").effects).toEqual({
      writesConfig: true,
      restart: "reload",
    });
    expect(getControlUiMethodDefinition("config.apply").effects).toEqual({
      writesConfig: true,
      restart: "reload",
    });
  });

  it("keeps gateway exec approvals on stable methods and node approvals on optional capability gates", () => {
    expect(getControlUiMethodDefinition("exec.approvals.get").requiredScopes).toEqual([
      "operator.read",
    ]);
    expect(getControlUiMethodDefinition("exec.approvals.set").requiredScopes).toEqual([
      "operator.admin",
    ]);
  });

  it("exposes lookup helpers for shared consumers", () => {
    expect(hasControlUiMethodDefinition("channels.status")).toBe(true);
    expect(hasControlUiMethodDefinition("totally.unknown.method")).toBe(false);
    expect(getControlUiMethodDefinition("channels.status")).toBe(
      ControlUiMethodContract["channels.status"],
    );
  });

  it("reuses protocol schemas for PR-CPA-05 control-plane domains", () => {
    expect(ControlUiMethodContract["agent.inspect"].paramsSchema).toBe(
      ProtocolSchemas.AgentInspectParams,
    );
    expect(ControlUiMethodContract["agent.inspect"].resultSchema).toBe(
      ProtocolSchemas.AgentInspectionSnapshot,
    );
    expect(ControlUiMethodContract["usage.cost"].paramsSchema).toBe(
      ProtocolSchemas.UsageCostParams,
    );
    expect(ControlUiMethodContract["usage.cost"].resultSchema).toBe(
      ProtocolSchemas.CostUsageSummary,
    );
    expect(ControlUiMethodContract["sessions.usage"].resultSchema).toBe(
      ProtocolSchemas.SessionsUsageResult,
    );
    expect(ControlUiMethodContract["sessions.usage.timeseries"].resultSchema).toBe(
      ProtocolSchemas.SessionsUsageTimeSeriesResult,
    );
    expect(ControlUiMethodContract["workflow.list"].paramsSchema).toBe(
      ProtocolSchemas.WorkflowListParams,
    );
    expect(ControlUiMethodContract["workflow.list"].resultSchema).toBe(
      ProtocolSchemas.WorkflowListResult,
    );
    expect(ControlUiMethodContract["workflow.get"].resultSchema).toBe(
      ProtocolSchemas.WorkflowGetResult,
    );
    expect(ControlUiMethodContract["workflow.runs"].resultSchema).toBe(
      ProtocolSchemas.WorkflowRunsResult,
    );
    expect(ControlUiMethodContract["workflow.status"].resultSchema).toBe(
      ProtocolSchemas.WorkflowExecutionActionResult,
    );
    expect(ControlUiMethodContract["workflow.versions"].resultSchema).toBe(
      ProtocolSchemas.WorkflowVersionsResult,
    );
    expect(ControlUiMethodContract["workflow.diff"].resultSchema).toBe(
      ProtocolSchemas.WorkflowDiffResult,
    );
    expect(ControlUiMethodContract["exec.approvals.get"].paramsSchema).toBe(
      ProtocolSchemas.ExecApprovalsGetParams,
    );
    expect(ControlUiMethodContract["exec.approvals.get"].resultSchema).toBe(
      ProtocolSchemas.ExecApprovalsSnapshot,
    );
    expect(ControlUiMethodContract["exec.approvals.node.set"].paramsSchema).toBe(
      ProtocolSchemas.ExecApprovalsNodeSetParams,
    );
  });
});
