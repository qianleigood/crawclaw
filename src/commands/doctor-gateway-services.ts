import fs from "node:fs/promises";
import path from "node:path";
import { writeConfigFile, type CrawClawConfig } from "../config/config.js";
import { resolveGatewayPort, resolveIsNixMode } from "../config/paths.js";
import { resolveSecretInputRef } from "../config/types.secrets.js";
import { findExtraGatewayServices, renderGatewayServiceCleanupHints } from "../daemon/inspect.js";
import { renderSystemNodeWarning, resolveSystemNodeInfo } from "../daemon/runtime-paths.js";
import {
  auditGatewayServiceConfig,
  needsNodeRuntimeMigration,
  readEmbeddedGatewayToken,
  SERVICE_AUDIT_CODES,
} from "../daemon/service-audit.js";
import { resolveGatewayService } from "../daemon/service.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { buildGatewayInstallPlan } from "./daemon-install-helpers.js";
import { DEFAULT_GATEWAY_DAEMON_RUNTIME, type GatewayDaemonRuntime } from "./daemon-runtime.js";
import { resolveGatewayAuthTokenForService } from "./doctor-gateway-auth-token.js";
import type { DoctorOptions, DoctorPrompter } from "./doctor-prompter.js";
import { isDoctorUpdateRepairMode } from "./doctor-repair-mode.js";

function detectGatewayRuntime(programArguments: string[] | undefined): GatewayDaemonRuntime {
  const first = programArguments?.[0];
  if (first) {
    const base = path.basename(first).toLowerCase();
    if (base === "bun" || base === "bun.exe") {
      return "bun";
    }
    if (base === "node" || base === "node.exe") {
      return "node";
    }
  }
  return DEFAULT_GATEWAY_DAEMON_RUNTIME;
}

function findGatewayEntrypoint(programArguments?: string[]): string | null {
  if (!programArguments || programArguments.length === 0) {
    return null;
  }
  const gatewayIndex = programArguments.indexOf("gateway");
  if (gatewayIndex <= 0) {
    return null;
  }
  return programArguments[gatewayIndex - 1] ?? null;
}

async function normalizeExecutablePath(value: string): Promise<string> {
  const resolvedPath = path.resolve(value);
  try {
    return await fs.realpath(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export async function maybeRepairGatewayServiceConfig(
  cfg: CrawClawConfig,
  mode: "local" | "remote",
  runtime: RuntimeEnv,
  prompter: DoctorPrompter,
) {
  if (resolveIsNixMode(process.env)) {
    note("Nix mode detected; skip service updates.", "Gateway");
    return;
  }

  if (mode === "remote") {
    note("Gateway mode is remote; skipped local service audit.", "Gateway");
    return;
  }

  const service = resolveGatewayService();
  let command: Awaited<ReturnType<typeof service.readCommand>> | null = null;
  try {
    command = await service.readCommand(process.env);
  } catch {
    command = null;
  }
  if (!command) {
    return;
  }

  const tokenRefConfigured = Boolean(
    resolveSecretInputRef({
      value: cfg.gateway?.auth?.token,
      defaults: cfg.secrets?.defaults,
    }).ref,
  );
  const gatewayTokenResolution = await resolveGatewayAuthTokenForService(cfg, process.env);
  if (gatewayTokenResolution.unavailableReason) {
    note(
      `Unable to verify gateway service token drift: ${gatewayTokenResolution.unavailableReason}`,
      "Gateway service config",
    );
  }
  const expectedGatewayToken = tokenRefConfigured ? undefined : gatewayTokenResolution.token;
  const audit = await auditGatewayServiceConfig({
    env: process.env,
    command,
    expectedGatewayToken,
  });
  const serviceToken = readEmbeddedGatewayToken(command);
  if (tokenRefConfigured && serviceToken) {
    audit.issues.push({
      code: SERVICE_AUDIT_CODES.gatewayTokenMismatch,
      message:
        "Gateway service CRAWCLAW_GATEWAY_TOKEN should be unset when gateway.auth.token is SecretRef-managed",
      detail: "service token is stale",
      level: "recommended",
    });
  }
  const needsNodeRuntime = needsNodeRuntimeMigration(audit.issues);
  const systemNodeInfo = needsNodeRuntime
    ? await resolveSystemNodeInfo({ env: process.env })
    : null;
  const systemNodePath = systemNodeInfo?.supported ? systemNodeInfo.path : null;
  if (needsNodeRuntime && !systemNodePath) {
    const warning = renderSystemNodeWarning(systemNodeInfo);
    if (warning) {
      note(warning, "Gateway runtime");
    }
    note(
      "System Node 24.x (stable) or Node 25.x (experimental) not found. Install one of them via Homebrew/apt/choco and rerun doctor to migrate off Bun/version managers.",
      "Gateway runtime",
    );
  }

  const port = resolveGatewayPort(cfg, process.env);
  const runtimeChoice = detectGatewayRuntime(command.programArguments);
  const { programArguments } = await buildGatewayInstallPlan({
    env: process.env,
    port,
    runtime: needsNodeRuntime && systemNodePath ? "node" : runtimeChoice,
    nodePath: systemNodePath ?? undefined,
    warn: (message, title) => note(message, title),
    config: cfg,
  });
  const expectedEntrypoint = findGatewayEntrypoint(programArguments);
  const currentEntrypoint = findGatewayEntrypoint(command.programArguments);
  const normalizedExpectedEntrypoint = expectedEntrypoint
    ? await normalizeExecutablePath(expectedEntrypoint)
    : null;
  const normalizedCurrentEntrypoint = currentEntrypoint
    ? await normalizeExecutablePath(currentEntrypoint)
    : null;
  if (
    normalizedExpectedEntrypoint &&
    normalizedCurrentEntrypoint &&
    normalizedExpectedEntrypoint !== normalizedCurrentEntrypoint
  ) {
    audit.issues.push({
      code: SERVICE_AUDIT_CODES.gatewayEntrypointMismatch,
      message: "Gateway service entrypoint does not match the current install.",
      detail: `${currentEntrypoint} -> ${expectedEntrypoint}`,
      level: "recommended",
    });
  }

  if (audit.issues.length === 0) {
    return;
  }

  note(
    audit.issues
      .map((issue) =>
        issue.detail ? `- ${issue.message} (${issue.detail})` : `- ${issue.message}`,
      )
      .join("\n"),
    "Gateway service config",
  );

  const aggressiveIssues = audit.issues.filter((issue) => issue.level === "aggressive");
  const needsAggressive = aggressiveIssues.length > 0;

  if (needsAggressive && !prompter.shouldForce) {
    note(
      "Custom or unexpected service edits detected. Rerun with --force to overwrite.",
      "Gateway service config",
    );
  }

  const repair = needsAggressive
    ? await prompter.confirmAggressiveAutoFix({
        message: "Overwrite gateway service config with current defaults now?",
        initialValue: prompter.shouldForce,
      })
    : await prompter.confirmAutoFix({
        message: "Update gateway service config to the recommended defaults now?",
        initialValue: true,
      });
  if (!repair) {
    return;
  }
  const updateRepairMode = isDoctorUpdateRepairMode(prompter.repairMode);
  const serviceEmbeddedToken = readEmbeddedGatewayToken(command);
  const gatewayTokenForRepair = expectedGatewayToken ?? serviceEmbeddedToken;
  const configuredGatewayToken =
    typeof cfg.gateway?.auth?.token === "string"
      ? cfg.gateway.auth.token.trim() || undefined
      : undefined;
  let cfgForServiceInstall = cfg;
  if (
    !updateRepairMode &&
    !tokenRefConfigured &&
    !configuredGatewayToken &&
    gatewayTokenForRepair
  ) {
    const nextCfg: CrawClawConfig = {
      ...cfg,
      gateway: {
        ...cfg.gateway,
        auth: {
          ...cfg.gateway?.auth,
          mode: cfg.gateway?.auth?.mode ?? "token",
          token: gatewayTokenForRepair,
        },
      },
    };
    try {
      await writeConfigFile(nextCfg);
      cfgForServiceInstall = nextCfg;
      note(
        expectedGatewayToken
          ? "Persisted gateway.auth.token from environment before reinstalling service."
          : "Persisted gateway.auth.token from existing service definition before reinstalling service.",
        "Gateway",
      );
    } catch (err) {
      runtime.error(`Failed to persist gateway.auth.token before service repair: ${String(err)}`);
      return;
    }
  }

  const updatedPort = resolveGatewayPort(cfgForServiceInstall, process.env);
  const updatedPlan = await buildGatewayInstallPlan({
    env: process.env,
    port: updatedPort,
    runtime: needsNodeRuntime && systemNodePath ? "node" : runtimeChoice,
    nodePath: systemNodePath ?? undefined,
    warn: (message, title) => note(message, title),
    config: cfgForServiceInstall,
  });
  try {
    await (updateRepairMode ? service.stage : service.install)({
      env: process.env,
      stdout: process.stdout,
      programArguments: updatedPlan.programArguments,
      workingDirectory: updatedPlan.workingDirectory,
      environment: updatedPlan.environment,
    });
  } catch (err) {
    runtime.error(`Gateway service update failed: ${String(err)}`);
  }
}

export async function maybeScanExtraGatewayServices(
  options: DoctorOptions,
  runtime: RuntimeEnv,
  prompter: DoctorPrompter,
) {
  void runtime;
  void prompter;
  const extraServices = await findExtraGatewayServices(process.env, {
    deep: options.deep,
  });
  if (extraServices.length === 0) {
    return;
  }

  note(
    extraServices.map((svc) => `- ${svc.label} (${svc.scope}, ${svc.detail})`).join("\n"),
    "Other gateway-like services detected",
  );

  const cleanupHints = renderGatewayServiceCleanupHints();
  if (cleanupHints.length > 0) {
    note(cleanupHints.map((hint) => `- ${hint}`).join("\n"), "Cleanup hints");
  }

  note(
    [
      "Recommendation: run a single gateway per machine for most setups.",
      "One gateway supports multiple agents.",
      "If you need multiple gateways (e.g., a rescue bot on the same host), isolate ports + config/state (see docs: /gateway#multiple-gateways-same-host).",
    ].join("\n"),
    "Gateway recommendation",
  );
}
