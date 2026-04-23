import type { Command } from "commander";
import { resolveMatrixAccount, resolveMatrixAccountConfig } from "./matrix/accounts.js";
import { withResolvedActionClient, withStartedActionClient } from "./matrix/actions/client.js";
import { listMatrixOwnDevices, pruneMatrixStaleGatewayDevices } from "./matrix/actions/devices.js";
import { updateMatrixOwnProfile } from "./matrix/actions/profile.js";
import {
  bootstrapMatrixVerification,
  getMatrixRoomKeyBackupStatus,
  getMatrixVerificationStatus,
  resetMatrixRoomKeyBackup,
  restoreMatrixRoomKeyBackup,
  verifyMatrixRecoveryKey,
} from "./matrix/actions/verification.js";
import { resolveMatrixRoomKeyBackupIssue } from "./matrix/backup-health.js";
import { resolveMatrixAuthContext } from "./matrix/client.js";
import { setMatrixSdkConsoleLogging, setMatrixSdkLogMode } from "./matrix/client/logging.js";
import { resolveMatrixConfigPath, updateMatrixAccountConfig } from "./matrix/config-update.js";
import { isCrawClawManagedMatrixDevice } from "./matrix/device-health.js";
import {
  inspectMatrixDirectRooms,
  repairMatrixDirectRooms,
  type MatrixDirectRoomCandidate,
} from "./matrix/direct-management.js";
import { applyMatrixProfileUpdate, type MatrixProfileUpdateResult } from "./profile-update.js";
import { formatZonedTimestamp, normalizeAccountId, type ChannelSetupInput } from "./runtime-api.js";
import { getMatrixRuntime } from "./runtime.js";
import { matrixSetupAdapter } from "./setup-core.js";
import type { CoreConfig } from "./types.js";

let matrixCliExitScheduled = false;

type MatrixCliLocale = "en" | "zh-CN";

function matrixCliText(locale: MatrixCliLocale | undefined, en: string, zhCN: string): string {
  return locale === "zh-CN" ? zhCN : en;
}

export function resetMatrixCliStateForTests(): void {
  matrixCliExitScheduled = false;
}

function scheduleMatrixCliExit(): void {
  if (matrixCliExitScheduled || process.env.VITEST) {
    return;
  }
  matrixCliExitScheduled = true;
  // matrix-js-sdk rust crypto can leave background async work alive after command completion.
  setTimeout(() => {
    process.exit(process.exitCode ?? 0);
  }, 0);
}

function markCliFailure(): void {
  process.exitCode = 1;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function formatLocalTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }
  return formatZonedTimestamp(parsed, { displaySeconds: true }) ?? value;
}

function printTimestamp(label: string, value: string | null | undefined): void {
  const formatted = formatLocalTimestamp(value);
  if (formatted) {
    console.log(`${label}: ${formatted}`);
  }
}

function printAccountLabel(accountId?: string): void {
  console.log(`Account: ${normalizeAccountId(accountId)}`);
}

function resolveMatrixCliAccountId(accountId?: string): string {
  const cfg = getMatrixRuntime().config.loadConfig() as CoreConfig;
  return resolveMatrixAuthContext({ cfg, accountId }).accountId;
}

function formatMatrixCliCommand(command: string, accountId?: string): string {
  const normalizedAccountId = normalizeAccountId(accountId);
  const suffix = normalizedAccountId === "default" ? "" : ` --account ${normalizedAccountId}`;
  return `crawclaw matrix ${command}${suffix}`;
}

function printMatrixOwnDevices(
  devices: Array<{
    deviceId: string;
    displayName: string | null;
    lastSeenIp: string | null;
    lastSeenTs: number | null;
    current: boolean;
  }>,
): void {
  if (devices.length === 0) {
    console.log("Devices: none");
    return;
  }
  for (const device of devices) {
    const labels = [device.current ? "current" : null, device.displayName].filter(Boolean);
    console.log(`- ${device.deviceId}${labels.length ? ` (${labels.join(", ")})` : ""}`);
    if (device.lastSeenTs) {
      printTimestamp("  Last seen", new Date(device.lastSeenTs).toISOString());
    }
    if (device.lastSeenIp) {
      console.log(`  Last IP: ${device.lastSeenIp}`);
    }
  }
}

function configureCliLogMode(verbose: boolean): void {
  setMatrixSdkLogMode(verbose ? "default" : "quiet");
  setMatrixSdkConsoleLogging(verbose);
}

function parseOptionalInt(value: string | undefined, fieldName: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}

type MatrixCliAccountAddResult = {
  accountId: string;
  configPath: string;
  useEnv: boolean;
  deviceHealth: {
    currentDeviceId: string | null;
    staleCrawClawDeviceIds: string[];
    error?: string;
  };
  verificationBootstrap: {
    attempted: boolean;
    success: boolean;
    recoveryKeyCreatedAt: string | null;
    backupVersion: string | null;
    error?: string;
  };
  profile: {
    attempted: boolean;
    displayNameUpdated: boolean;
    avatarUpdated: boolean;
    resolvedAvatarUrl: string | null;
    convertedAvatarFromHttp: boolean;
    error?: string;
  };
};

async function addMatrixAccount(params: {
  account?: string;
  name?: string;
  avatarUrl?: string;
  homeserver?: string;
  proxy?: string;
  userId?: string;
  accessToken?: string;
  password?: string;
  deviceName?: string;
  initialSyncLimit?: string;
  allowPrivateNetwork?: boolean;
  useEnv?: boolean;
}): Promise<MatrixCliAccountAddResult> {
  const runtime = getMatrixRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  if (!matrixSetupAdapter.applyAccountConfig) {
    throw new Error("Matrix account setup is unavailable.");
  }

  const input: ChannelSetupInput & { avatarUrl?: string } = {
    name: params.name,
    avatarUrl: params.avatarUrl,
    homeserver: params.homeserver,
    allowPrivateNetwork: params.allowPrivateNetwork,
    proxy: params.proxy,
    userId: params.userId,
    accessToken: params.accessToken,
    password: params.password,
    deviceName: params.deviceName,
    initialSyncLimit: parseOptionalInt(params.initialSyncLimit, "--initial-sync-limit"),
    useEnv: params.useEnv === true,
  };
  const accountId =
    matrixSetupAdapter.resolveAccountId?.({
      cfg,
      accountId: params.account,
      input,
    }) ?? normalizeAccountId(params.account?.trim() || params.name?.trim());
  const validationError = matrixSetupAdapter.validateInput?.({
    cfg,
    accountId,
    input,
  });
  if (validationError) {
    throw new Error(validationError);
  }

  const updated = matrixSetupAdapter.applyAccountConfig({
    cfg,
    accountId,
    input,
  }) as CoreConfig;
  await runtime.config.writeConfigFile(updated as never);
  const accountConfig = resolveMatrixAccountConfig({ cfg: updated, accountId });

  let verificationBootstrap: MatrixCliAccountAddResult["verificationBootstrap"] = {
    attempted: false,
    success: false,
    recoveryKeyCreatedAt: null,
    backupVersion: null,
  };
  if (accountConfig.encryption === true) {
    const { maybeBootstrapNewEncryptedMatrixAccount } = await import("./setup-bootstrap.js");
    verificationBootstrap = await maybeBootstrapNewEncryptedMatrixAccount({
      previousCfg: cfg,
      cfg: updated,
      accountId,
    });
  }

  const desiredDisplayName = input.name?.trim();
  const desiredAvatarUrl = input.avatarUrl?.trim();
  let profile: MatrixCliAccountAddResult["profile"] = {
    attempted: false,
    displayNameUpdated: false,
    avatarUpdated: false,
    resolvedAvatarUrl: null,
    convertedAvatarFromHttp: false,
  };
  if (desiredDisplayName || desiredAvatarUrl) {
    try {
      const synced = await updateMatrixOwnProfile({
        accountId,
        displayName: desiredDisplayName,
        avatarUrl: desiredAvatarUrl,
      });
      let resolvedAvatarUrl = synced.resolvedAvatarUrl;
      if (synced.convertedAvatarFromHttp && synced.resolvedAvatarUrl) {
        const latestCfg = runtime.config.loadConfig() as CoreConfig;
        const withAvatar = updateMatrixAccountConfig(latestCfg, accountId, {
          avatarUrl: synced.resolvedAvatarUrl,
        });
        await runtime.config.writeConfigFile(withAvatar as never);
        resolvedAvatarUrl = synced.resolvedAvatarUrl;
      }
      profile = {
        attempted: true,
        displayNameUpdated: synced.displayNameUpdated,
        avatarUpdated: synced.avatarUpdated,
        resolvedAvatarUrl,
        convertedAvatarFromHttp: synced.convertedAvatarFromHttp,
      };
    } catch (err) {
      profile = {
        attempted: true,
        displayNameUpdated: false,
        avatarUpdated: false,
        resolvedAvatarUrl: null,
        convertedAvatarFromHttp: false,
        error: toErrorMessage(err),
      };
    }
  }

  let deviceHealth: MatrixCliAccountAddResult["deviceHealth"] = {
    currentDeviceId: null,
    staleCrawClawDeviceIds: [],
  };
  try {
    const addedDevices = await listMatrixOwnDevices({ accountId });
    deviceHealth = {
      currentDeviceId: addedDevices.find((device) => device.current)?.deviceId ?? null,
      staleCrawClawDeviceIds: addedDevices
        .filter((device) => !device.current && isCrawClawManagedMatrixDevice(device.displayName))
        .map((device) => device.deviceId),
    };
  } catch (err) {
    deviceHealth = {
      currentDeviceId: null,
      staleCrawClawDeviceIds: [],
      error: toErrorMessage(err),
    };
  }

  return {
    accountId,
    configPath: resolveMatrixConfigPath(updated, accountId),
    useEnv: input.useEnv === true,
    deviceHealth,
    verificationBootstrap,
    profile,
  };
}

function printDirectRoomCandidate(room: MatrixCliDirectRoomCandidate): void {
  const members =
    room.joinedMembers === null ? "unavailable" : room.joinedMembers.join(", ") || "none";
  console.log(
    `- ${room.roomId} [${room.source}] strict=${room.strict ? "yes" : "no"} joined=${members}`,
  );
}

function printDirectRoomInspection(result: MatrixCliDirectRoomInspection): void {
  printAccountLabel(result.accountId);
  console.log(`Peer: ${result.remoteUserId}`);
  console.log(`Self: ${result.selfUserId ?? "unknown"}`);
  console.log(`Active direct room: ${result.activeRoomId ?? "none"}`);
  console.log(
    `Mapped rooms: ${result.mappedRoomIds.length ? result.mappedRoomIds.join(", ") : "none"}`,
  );
  console.log(
    `Discovered strict rooms: ${result.discoveredStrictRoomIds.length ? result.discoveredStrictRoomIds.join(", ") : "none"}`,
  );
  if (result.mappedRooms.length > 0) {
    console.log("Mapped room details:");
    for (const room of result.mappedRooms) {
      printDirectRoomCandidate(room);
    }
  }
}

async function inspectMatrixDirectRoom(params: {
  accountId: string;
  userId: string;
}): Promise<MatrixCliDirectRoomInspection> {
  return await withResolvedActionClient(
    { accountId: params.accountId },
    async (client) => {
      const inspection = await inspectMatrixDirectRooms({
        client,
        remoteUserId: params.userId,
      });
      return {
        accountId: params.accountId,
        remoteUserId: inspection.remoteUserId,
        selfUserId: inspection.selfUserId,
        mappedRoomIds: inspection.mappedRoomIds,
        mappedRooms: inspection.mappedRooms.map(toCliDirectRoomCandidate),
        discoveredStrictRoomIds: inspection.discoveredStrictRoomIds,
        activeRoomId: inspection.activeRoomId,
      };
    },
    "persist",
  );
}

async function repairMatrixDirectRoom(params: {
  accountId: string;
  userId: string;
}): Promise<MatrixCliDirectRoomRepair> {
  const cfg = getMatrixRuntime().config.loadConfig() as CoreConfig;
  const account = resolveMatrixAccount({ cfg, accountId: params.accountId });
  return await withStartedActionClient({ accountId: params.accountId }, async (client) => {
    const repaired = await repairMatrixDirectRooms({
      client,
      remoteUserId: params.userId,
      encrypted: account.config.encryption === true,
    });
    return {
      accountId: params.accountId,
      remoteUserId: repaired.remoteUserId,
      selfUserId: repaired.selfUserId,
      mappedRoomIds: repaired.mappedRoomIds,
      mappedRooms: repaired.mappedRooms.map(toCliDirectRoomCandidate),
      discoveredStrictRoomIds: repaired.discoveredStrictRoomIds,
      activeRoomId: repaired.activeRoomId,
      encrypted: account.config.encryption === true,
      createdRoomId: repaired.createdRoomId,
      changed: repaired.changed,
      directContentBefore: repaired.directContentBefore,
      directContentAfter: repaired.directContentAfter,
    };
  });
}

type MatrixCliProfileSetResult = MatrixProfileUpdateResult;

async function setMatrixProfile(params: {
  account?: string;
  name?: string;
  avatarUrl?: string;
}): Promise<MatrixCliProfileSetResult> {
  return await applyMatrixProfileUpdate({
    account: params.account,
    displayName: params.name,
    avatarUrl: params.avatarUrl,
  });
}

type MatrixCliCommandConfig<TResult> = {
  verbose: boolean;
  json: boolean;
  run: () => Promise<TResult>;
  onText: (result: TResult, verbose: boolean) => void;
  onJson?: (result: TResult) => unknown;
  shouldFail?: (result: TResult) => boolean;
  errorPrefix: string;
  onJsonError?: (message: string) => unknown;
};

async function runMatrixCliCommand<TResult>(
  config: MatrixCliCommandConfig<TResult>,
): Promise<void> {
  configureCliLogMode(config.verbose);
  try {
    const result = await config.run();
    if (config.json) {
      printJson(config.onJson ? config.onJson(result) : result);
    } else {
      config.onText(result, config.verbose);
    }
    if (config.shouldFail?.(result)) {
      markCliFailure();
    }
  } catch (err) {
    const message = toErrorMessage(err);
    if (config.json) {
      printJson(config.onJsonError ? config.onJsonError(message) : { error: message });
    } else {
      console.error(`${config.errorPrefix}: ${message}`);
    }
    markCliFailure();
  } finally {
    scheduleMatrixCliExit();
  }
}

type MatrixCliBackupStatus = {
  serverVersion: string | null;
  activeVersion: string | null;
  trusted: boolean | null;
  matchesDecryptionKey: boolean | null;
  decryptionKeyCached: boolean | null;
  keyLoadAttempted: boolean;
  keyLoadError: string | null;
};

type MatrixCliVerificationStatus = {
  encryptionEnabled: boolean;
  verified: boolean;
  userId: string | null;
  deviceId: string | null;
  localVerified: boolean;
  crossSigningVerified: boolean;
  signedByOwner: boolean;
  backupVersion: string | null;
  backup?: MatrixCliBackupStatus;
  recoveryKeyStored: boolean;
  recoveryKeyCreatedAt: string | null;
  pendingVerifications: number;
};

type MatrixCliDirectRoomCandidate = {
  roomId: string;
  source: "account-data" | "joined";
  strict: boolean;
  joinedMembers: string[] | null;
};

type MatrixCliDirectRoomInspection = {
  accountId: string;
  remoteUserId: string;
  selfUserId: string | null;
  mappedRoomIds: string[];
  mappedRooms: MatrixCliDirectRoomCandidate[];
  discoveredStrictRoomIds: string[];
  activeRoomId: string | null;
};

type MatrixCliDirectRoomRepair = MatrixCliDirectRoomInspection & {
  encrypted: boolean;
  createdRoomId: string | null;
  changed: boolean;
  directContentBefore: Record<string, string[]>;
  directContentAfter: Record<string, string[]>;
};

function toCliDirectRoomCandidate(room: MatrixDirectRoomCandidate): MatrixCliDirectRoomCandidate {
  return {
    roomId: room.roomId,
    source: room.source,
    strict: room.strict,
    joinedMembers: room.joinedMembers,
  };
}

function resolveBackupStatus(status: {
  backupVersion: string | null;
  backup?: MatrixCliBackupStatus;
}): MatrixCliBackupStatus {
  return {
    serverVersion: status.backup?.serverVersion ?? status.backupVersion ?? null,
    activeVersion: status.backup?.activeVersion ?? null,
    trusted: status.backup?.trusted ?? null,
    matchesDecryptionKey: status.backup?.matchesDecryptionKey ?? null,
    decryptionKeyCached: status.backup?.decryptionKeyCached ?? null,
    keyLoadAttempted: status.backup?.keyLoadAttempted ?? false,
    keyLoadError: status.backup?.keyLoadError ?? null,
  };
}

function yesNoUnknown(value: boolean | null): string {
  if (value === true) {
    return "yes";
  }
  if (value === false) {
    return "no";
  }
  return "unknown";
}

function printBackupStatus(backup: MatrixCliBackupStatus): void {
  console.log(`Backup server version: ${backup.serverVersion ?? "none"}`);
  console.log(`Backup active on this device: ${backup.activeVersion ?? "no"}`);
  console.log(`Backup trusted by this device: ${yesNoUnknown(backup.trusted)}`);
  console.log(`Backup matches local decryption key: ${yesNoUnknown(backup.matchesDecryptionKey)}`);
  console.log(`Backup key cached locally: ${yesNoUnknown(backup.decryptionKeyCached)}`);
  console.log(`Backup key load attempted: ${yesNoUnknown(backup.keyLoadAttempted)}`);
  if (backup.keyLoadError) {
    console.log(`Backup key load error: ${backup.keyLoadError}`);
  }
}

function printVerificationIdentity(status: {
  userId: string | null;
  deviceId: string | null;
}): void {
  console.log(`User: ${status.userId ?? "unknown"}`);
  console.log(`Device: ${status.deviceId ?? "unknown"}`);
}

function printVerificationBackupSummary(status: {
  backupVersion: string | null;
  backup?: MatrixCliBackupStatus;
}): void {
  printBackupSummary(resolveBackupStatus(status));
}

function printVerificationBackupStatus(status: {
  backupVersion: string | null;
  backup?: MatrixCliBackupStatus;
}): void {
  printBackupStatus(resolveBackupStatus(status));
}

function printVerificationTrustDiagnostics(status: {
  localVerified: boolean;
  crossSigningVerified: boolean;
  signedByOwner: boolean;
}): void {
  console.log(`Locally trusted: ${status.localVerified ? "yes" : "no"}`);
  console.log(`Cross-signing verified: ${status.crossSigningVerified ? "yes" : "no"}`);
  console.log(`Signed by owner: ${status.signedByOwner ? "yes" : "no"}`);
}

function printVerificationGuidance(status: MatrixCliVerificationStatus, accountId?: string): void {
  printGuidance(buildVerificationGuidance(status, accountId));
}

function printBackupSummary(backup: MatrixCliBackupStatus): void {
  const issue = resolveMatrixRoomKeyBackupIssue(backup);
  console.log(`Backup: ${issue.summary}`);
  if (backup.serverVersion) {
    console.log(`Backup version: ${backup.serverVersion}`);
  }
}

function buildVerificationGuidance(
  status: MatrixCliVerificationStatus,
  accountId?: string,
): string[] {
  const backup = resolveBackupStatus(status);
  const backupIssue = resolveMatrixRoomKeyBackupIssue(backup);
  const nextSteps = new Set<string>();
  if (!status.verified) {
    nextSteps.add(
      `Run '${formatMatrixCliCommand("verify device <key>", accountId)}' to verify this device.`,
    );
  }
  if (backupIssue.code === "missing-server-backup") {
    nextSteps.add(
      `Run '${formatMatrixCliCommand("verify bootstrap", accountId)}' to create a room key backup.`,
    );
  } else if (
    backupIssue.code === "key-load-failed" ||
    backupIssue.code === "key-not-loaded" ||
    backupIssue.code === "inactive"
  ) {
    if (status.recoveryKeyStored) {
      nextSteps.add(
        `Backup key is not loaded on this device. Run '${formatMatrixCliCommand("verify backup restore", accountId)}' to load it and restore old room keys.`,
      );
    } else {
      nextSteps.add(
        `Store a recovery key with '${formatMatrixCliCommand("verify device <key>", accountId)}', then run '${formatMatrixCliCommand("verify backup restore", accountId)}'.`,
      );
    }
  } else if (backupIssue.code === "key-mismatch") {
    nextSteps.add(
      `Backup key mismatch on this device. Re-run '${formatMatrixCliCommand("verify device <key>", accountId)}' with the matching recovery key.`,
    );
    nextSteps.add(
      `If you want a fresh backup baseline and accept losing unrecoverable history, run '${formatMatrixCliCommand("verify backup reset --yes", accountId)}'.`,
    );
  } else if (backupIssue.code === "untrusted-signature") {
    nextSteps.add(
      `Backup trust chain is not verified on this device. Re-run '${formatMatrixCliCommand("verify device <key>", accountId)}' if you have the correct recovery key.`,
    );
    nextSteps.add(
      `If you want a fresh backup baseline and accept losing unrecoverable history, run '${formatMatrixCliCommand("verify backup reset --yes", accountId)}'.`,
    );
  } else if (backupIssue.code === "indeterminate") {
    nextSteps.add(
      `Run '${formatMatrixCliCommand("verify status --verbose", accountId)}' to inspect backup trust diagnostics.`,
    );
  }
  if (status.pendingVerifications > 0) {
    nextSteps.add(`Complete ${status.pendingVerifications} pending verification request(s).`);
  }
  return Array.from(nextSteps);
}

function printGuidance(lines: string[]): void {
  if (lines.length === 0) {
    return;
  }
  console.log("Next steps:");
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}

function printVerificationStatus(
  status: MatrixCliVerificationStatus,
  verbose = false,
  accountId?: string,
): void {
  console.log(`Verified by owner: ${status.verified ? "yes" : "no"}`);
  const backup = resolveBackupStatus(status);
  const backupIssue = resolveMatrixRoomKeyBackupIssue(backup);
  printVerificationBackupSummary(status);
  if (backupIssue.message) {
    console.log(`Backup issue: ${backupIssue.message}`);
  }
  if (verbose) {
    console.log("Diagnostics:");
    printVerificationIdentity(status);
    printVerificationTrustDiagnostics(status);
    printVerificationBackupStatus(status);
    console.log(`Recovery key stored: ${status.recoveryKeyStored ? "yes" : "no"}`);
    printTimestamp("Recovery key created at", status.recoveryKeyCreatedAt);
    console.log(`Pending verifications: ${status.pendingVerifications}`);
  } else {
    console.log(`Recovery key stored: ${status.recoveryKeyStored ? "yes" : "no"}`);
  }
  printVerificationGuidance(status, accountId);
}

export function registerMatrixCli(params: { program: Command; locale?: MatrixCliLocale }): void {
  const text = (en: string, zhCN: string) => matrixCliText(params.locale, en, zhCN);
  const root = params.program
    .command("matrix")
    .description(text("Matrix channel utilities", "Matrix 渠道工具"))
    .addHelpText(
      "after",
      () => `\n${text("Docs:", "文档：")} https://docs.crawclaw.ai/channels/matrix\n`,
    );

  const account = root
    .command("account")
    .description(text("Manage matrix channel accounts", "管理 Matrix 渠道账号"));

  account
    .command("add")
    .description(
      text(
        "Add or update a matrix account (wrapper around channel setup)",
        "添加或更新 Matrix 账号（channel setup 的封装）",
      ),
    )
    .option(
      "--account <id>",
      text(
        "Account ID (default: normalized --name, else default)",
        "账号 ID（默认使用规范化后的 --name，否则为 default）",
      ),
    )
    .option("--name <name>", text("Optional display name for this account", "此账号的可选显示名称"))
    .option(
      "--avatar-url <url>",
      text(
        "Optional Matrix avatar URL (mxc:// or http(s) URL)",
        "可选 Matrix 头像 URL（mxc:// 或 http(s) URL）",
      ),
    )
    .option("--homeserver <url>", text("Matrix homeserver URL", "Matrix homeserver URL"))
    .option(
      "--proxy <url>",
      text(
        "Optional HTTP(S) proxy URL for Matrix requests",
        "Matrix 请求使用的可选 HTTP(S) 代理 URL",
      ),
    )
    .option(
      "--allow-private-network",
      text(
        "Allow Matrix homeserver traffic to private/internal hosts for this account",
        "允许此账号访问私有/内网 Matrix homeserver",
      ),
    )
    .option("--user-id <id>", text("Matrix user ID", "Matrix 用户 ID"))
    .option("--access-token <token>", text("Matrix access token", "Matrix access token"))
    .option("--password <password>", text("Matrix password", "Matrix 密码"))
    .option("--device-name <name>", text("Matrix device display name", "Matrix 设备显示名称"))
    .option(
      "--initial-sync-limit <n>",
      text("Matrix initial sync limit", "Matrix 初始同步数量上限"),
    )
    .option(
      "--use-env",
      text(
        "Use MATRIX_* env vars (or MATRIX_<ACCOUNT_ID>_* for non-default accounts)",
        "使用 MATRIX_* 环境变量（非默认账号使用 MATRIX_<ACCOUNT_ID>_*）",
      ),
    )
    .option("--verbose", text("Show setup details", "显示设置详情"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (options: {
        account?: string;
        name?: string;
        avatarUrl?: string;
        homeserver?: string;
        proxy?: string;
        allowPrivateNetwork?: boolean;
        userId?: string;
        accessToken?: string;
        password?: string;
        deviceName?: string;
        initialSyncLimit?: string;
        useEnv?: boolean;
        verbose?: boolean;
        json?: boolean;
      }) => {
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await addMatrixAccount({
              account: options.account,
              name: options.name,
              avatarUrl: options.avatarUrl,
              homeserver: options.homeserver,
              proxy: options.proxy,
              allowPrivateNetwork: options.allowPrivateNetwork === true,
              userId: options.userId,
              accessToken: options.accessToken,
              password: options.password,
              deviceName: options.deviceName,
              initialSyncLimit: options.initialSyncLimit,
              useEnv: options.useEnv === true,
            }),
          onText: (result) => {
            console.log(
              `${text("Saved matrix account", "已保存 Matrix 账号")}: ${result.accountId}`,
            );
            console.log(`${text("Config path", "配置路径")}: ${result.configPath}`);
            console.log(
              `${text("Credentials source", "凭据来源")}: ${result.useEnv ? "MATRIX_* / MATRIX_<ACCOUNT_ID>_* env vars" : text("inline config", "内联配置")}`,
            );
            if (result.verificationBootstrap.attempted) {
              if (result.verificationBootstrap.success) {
                console.log(
                  text("Matrix verification bootstrap: complete", "Matrix 验证引导已完成"),
                );
                printTimestamp(
                  text("Recovery key created at", "Recovery key 创建时间"),
                  result.verificationBootstrap.recoveryKeyCreatedAt,
                );
                if (result.verificationBootstrap.backupVersion) {
                  console.log(
                    `${text("Backup version", "Backup 版本")}: ${result.verificationBootstrap.backupVersion}`,
                  );
                }
              } else {
                console.error(
                  `${text("Matrix verification bootstrap warning", "Matrix 验证引导警告")}: ${result.verificationBootstrap.error}`,
                );
              }
            }
            if (result.deviceHealth.error) {
              console.error(
                `${text("Matrix device health warning", "Matrix 设备健康警告")}: ${result.deviceHealth.error}`,
              );
            } else if (result.deviceHealth.staleCrawClawDeviceIds.length > 0) {
              console.log(
                `${text("Matrix device hygiene warning: stale CrawClaw devices detected", "Matrix 设备卫生警告：检测到陈旧的 CrawClaw 设备")} (${result.deviceHealth.staleCrawClawDeviceIds.join(", ")}). ${text("Run", "运行")} 'crawclaw matrix devices prune-stale --account ${result.accountId}'.`,
              );
            }
            if (result.profile.attempted) {
              if (result.profile.error) {
                console.error(
                  `${text("Profile sync warning", "Profile 同步警告")}: ${result.profile.error}`,
                );
              } else {
                console.log(
                  `${text("Profile sync", "Profile 同步")}: ${text("name", "名称")} ${result.profile.displayNameUpdated ? text("updated", "已更新") : text("unchanged", "未变化")}, ${text("avatar", "头像")} ${result.profile.avatarUpdated ? text("updated", "已更新") : text("unchanged", "未变化")}`,
                );
                if (result.profile.convertedAvatarFromHttp && result.profile.resolvedAvatarUrl) {
                  console.log(
                    `${text("Avatar converted and saved as", "头像已转换并保存为")}: ${result.profile.resolvedAvatarUrl}`,
                  );
                }
              }
            }
            const bindHint = `crawclaw agents bind --agent <id> --bind matrix:${result.accountId}`;
            console.log(
              `${text("Bind this account to an agent", "将此账号绑定到 agent")}: ${bindHint}`,
            );
          },
          errorPrefix: text("Account setup failed", "账号设置失败"),
        });
      },
    );

  const profile = root
    .command("profile")
    .description(text("Manage Matrix bot profile", "管理 Matrix bot 资料"));

  profile
    .command("set")
    .description(
      text("Update Matrix profile display name and/or avatar", "更新 Matrix 资料显示名和/或头像"),
    )
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--name <name>", text("Profile display name", "资料显示名"))
    .option(
      "--avatar-url <url>",
      text("Profile avatar URL (mxc:// or http(s) URL)", "资料头像 URL（mxc:// 或 http(s) URL）"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (options: {
        account?: string;
        name?: string;
        avatarUrl?: string;
        verbose?: boolean;
        json?: boolean;
      }) => {
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await setMatrixProfile({
              account: options.account,
              name: options.name,
              avatarUrl: options.avatarUrl,
            }),
          onText: (result) => {
            printAccountLabel(result.accountId);
            console.log(`${text("Config path", "配置路径")}: ${result.configPath}`);
            console.log(
              `${text("Profile update", "Profile 更新")}: ${text("name", "名称")} ${result.profile.displayNameUpdated ? text("updated", "已更新") : text("unchanged", "未变化")}, ${text("avatar", "头像")} ${result.profile.avatarUpdated ? text("updated", "已更新") : text("unchanged", "未变化")}`,
            );
            if (result.profile.convertedAvatarFromHttp && result.avatarUrl) {
              console.log(
                `${text("Avatar converted and saved as", "头像已转换并保存为")}: ${result.avatarUrl}`,
              );
            }
          },
          errorPrefix: text("Profile update failed", "Profile 更新失败"),
        });
      },
    );

  const direct = root
    .command("direct")
    .description(
      text("Inspect and repair Matrix direct-room state", "检查并修复 Matrix direct-room 状态"),
    );

  direct
    .command("inspect")
    .description(
      text("Inspect direct-room mappings for a Matrix user", "检查 Matrix 用户的 direct-room 映射"),
    )
    .requiredOption("--user-id <id>", text("Peer Matrix user ID", "对端 Matrix 用户 ID"))
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (options: { userId: string; account?: string; verbose?: boolean; json?: boolean }) => {
        const accountId = resolveMatrixCliAccountId(options.account);
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await inspectMatrixDirectRoom({
              accountId,
              userId: options.userId,
            }),
          onText: (result) => {
            printDirectRoomInspection(result);
          },
          errorPrefix: "Direct room inspection failed",
        });
      },
    );

  direct
    .command("repair")
    .description(
      text(
        "Repair Matrix direct-room mappings for a Matrix user",
        "修复 Matrix 用户的 direct-room 映射",
      ),
    )
    .requiredOption("--user-id <id>", text("Peer Matrix user ID", "对端 Matrix 用户 ID"))
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (options: { userId: string; account?: string; verbose?: boolean; json?: boolean }) => {
        const accountId = resolveMatrixCliAccountId(options.account);
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await repairMatrixDirectRoom({
              accountId,
              userId: options.userId,
            }),
          onText: (result, verbose) => {
            printDirectRoomInspection(result);
            console.log(`Encrypted room creation: ${result.encrypted ? "enabled" : "disabled"}`);
            console.log(`Created room: ${result.createdRoomId ?? "none"}`);
            console.log(`m.direct updated: ${result.changed ? "yes" : "no"}`);
            if (verbose) {
              console.log(
                `m.direct before: ${JSON.stringify(result.directContentBefore[result.remoteUserId] ?? [])}`,
              );
              console.log(
                `m.direct after: ${JSON.stringify(result.directContentAfter[result.remoteUserId] ?? [])}`,
              );
            }
          },
          errorPrefix: "Direct room repair failed",
        });
      },
    );

  const verify = root
    .command("verify")
    .description(text("Device verification for Matrix E2EE", "Matrix E2EE 设备验证"));

  verify
    .command("status")
    .description(text("Check Matrix device verification status", "检查 Matrix 设备验证状态"))
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option(
      "--include-recovery-key",
      text("Include stored recovery key in output", "在输出中包含已存储的 recovery key"),
    )
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (options: {
        account?: string;
        verbose?: boolean;
        includeRecoveryKey?: boolean;
        json?: boolean;
      }) => {
        const accountId = resolveMatrixCliAccountId(options.account);
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await getMatrixVerificationStatus({
              accountId,
              includeRecoveryKey: options.includeRecoveryKey === true,
            }),
          onText: (status, verbose) => {
            printAccountLabel(accountId);
            printVerificationStatus(status, verbose, accountId);
          },
          errorPrefix: "Error",
        });
      },
    );

  const backup = verify
    .command("backup")
    .description(
      text("Matrix room-key backup health and restore", "Matrix room-key 备份健康检查和恢复"),
    );

  backup
    .command("status")
    .description(
      text(
        "Show Matrix room-key backup status for this device",
        "显示此设备的 Matrix room-key 备份状态",
      ),
    )
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(async (options: { account?: string; verbose?: boolean; json?: boolean }) => {
      const accountId = resolveMatrixCliAccountId(options.account);
      await runMatrixCliCommand({
        verbose: options.verbose === true,
        json: options.json === true,
        run: async () => await getMatrixRoomKeyBackupStatus({ accountId }),
        onText: (status, verbose) => {
          printAccountLabel(accountId);
          printBackupSummary(status);
          if (verbose) {
            printBackupStatus(status);
          }
        },
        errorPrefix: "Backup status failed",
      });
    });

  backup
    .command("reset")
    .description(
      text(
        "Delete the current server backup and create a fresh room-key backup baseline",
        "删除当前服务端备份并创建新的 room-key 备份基线",
      ),
    )
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--yes", text("Confirm destructive backup reset", "确认执行破坏性的备份重置"), false)
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (options: { account?: string; yes?: boolean; verbose?: boolean; json?: boolean }) => {
        const accountId = resolveMatrixCliAccountId(options.account);
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () => {
            if (options.yes !== true) {
              throw new Error("Refusing to reset Matrix room-key backup without --yes");
            }
            return await resetMatrixRoomKeyBackup({ accountId });
          },
          onText: (result, verbose) => {
            printAccountLabel(accountId);
            console.log(`Reset success: ${result.success ? "yes" : "no"}`);
            if (result.error) {
              console.log(`Error: ${result.error}`);
            }
            console.log(`Previous backup version: ${result.previousVersion ?? "none"}`);
            console.log(`Deleted backup version: ${result.deletedVersion ?? "none"}`);
            console.log(`Current backup version: ${result.createdVersion ?? "none"}`);
            printBackupSummary(result.backup);
            if (verbose) {
              printTimestamp("Reset at", result.resetAt);
              printBackupStatus(result.backup);
            }
          },
          shouldFail: (result) => !result.success,
          errorPrefix: "Backup reset failed",
          onJsonError: (message) => ({ success: false, error: message }),
        });
      },
    );

  backup
    .command("restore")
    .description(
      text("Restore encrypted room keys from server backup", "从服务端备份恢复加密 room keys"),
    )
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option(
      "--recovery-key <key>",
      text("Optional recovery key to load before restoring", "恢复前要加载的可选 recovery key"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (options: {
        account?: string;
        recoveryKey?: string;
        verbose?: boolean;
        json?: boolean;
      }) => {
        const accountId = resolveMatrixCliAccountId(options.account);
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await restoreMatrixRoomKeyBackup({
              accountId,
              recoveryKey: options.recoveryKey,
            }),
          onText: (result, verbose) => {
            printAccountLabel(accountId);
            console.log(`Restore success: ${result.success ? "yes" : "no"}`);
            if (result.error) {
              console.log(`Error: ${result.error}`);
            }
            console.log(`Backup version: ${result.backupVersion ?? "none"}`);
            console.log(`Imported keys: ${result.imported}/${result.total}`);
            printBackupSummary(result.backup);
            if (verbose) {
              console.log(
                `Loaded key from secret storage: ${result.loadedFromSecretStorage ? "yes" : "no"}`,
              );
              printTimestamp("Restored at", result.restoredAt);
              printBackupStatus(result.backup);
            }
          },
          shouldFail: (result) => !result.success,
          errorPrefix: "Backup restore failed",
          onJsonError: (message) => ({ success: false, error: message }),
        });
      },
    );

  verify
    .command("bootstrap")
    .description(
      text(
        "Bootstrap Matrix cross-signing and device verification state",
        "初始化 Matrix cross-signing 和设备验证状态",
      ),
    )
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option(
      "--recovery-key <key>",
      text("Recovery key to apply before bootstrap", "初始化前要应用的 recovery key"),
    )
    .option(
      "--force-reset-cross-signing",
      text(
        "Force reset cross-signing identity before bootstrap",
        "初始化前强制重置 cross-signing 身份",
      ),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (options: {
        account?: string;
        recoveryKey?: string;
        forceResetCrossSigning?: boolean;
        verbose?: boolean;
        json?: boolean;
      }) => {
        const accountId = resolveMatrixCliAccountId(options.account);
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () =>
            await bootstrapMatrixVerification({
              accountId,
              recoveryKey: options.recoveryKey,
              forceResetCrossSigning: options.forceResetCrossSigning === true,
            }),
          onText: (result, verbose) => {
            printAccountLabel(accountId);
            console.log(`Bootstrap success: ${result.success ? "yes" : "no"}`);
            if (result.error) {
              console.log(`Error: ${result.error}`);
            }
            console.log(`Verified by owner: ${result.verification.verified ? "yes" : "no"}`);
            printVerificationIdentity(result.verification);
            if (verbose) {
              printVerificationTrustDiagnostics(result.verification);
              console.log(
                `Cross-signing published: ${result.crossSigning.published ? "yes" : "no"} (master=${result.crossSigning.masterKeyPublished ? "yes" : "no"}, self=${result.crossSigning.selfSigningKeyPublished ? "yes" : "no"}, user=${result.crossSigning.userSigningKeyPublished ? "yes" : "no"})`,
              );
              printVerificationBackupStatus(result.verification);
              printTimestamp("Recovery key created at", result.verification.recoveryKeyCreatedAt);
              console.log(`Pending verifications: ${result.pendingVerifications}`);
            } else {
              console.log(
                `Cross-signing published: ${result.crossSigning.published ? "yes" : "no"}`,
              );
              printVerificationBackupSummary(result.verification);
            }
            printVerificationGuidance(
              {
                ...result.verification,
                pendingVerifications: result.pendingVerifications,
              },
              accountId,
            );
          },
          shouldFail: (result) => !result.success,
          errorPrefix: "Verification bootstrap failed",
          onJsonError: (message) => ({ success: false, error: message }),
        });
      },
    );

  verify
    .command("device <key>")
    .description(
      text("Verify device using a Matrix recovery key", "使用 Matrix recovery key 验证设备"),
    )
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(
      async (key: string, options: { account?: string; verbose?: boolean; json?: boolean }) => {
        const accountId = resolveMatrixCliAccountId(options.account);
        await runMatrixCliCommand({
          verbose: options.verbose === true,
          json: options.json === true,
          run: async () => await verifyMatrixRecoveryKey(key, { accountId }),
          onText: (result, verbose) => {
            printAccountLabel(accountId);
            if (!result.success) {
              console.error(`Verification failed: ${result.error ?? "unknown error"}`);
              return;
            }
            console.log("Device verification completed successfully.");
            printVerificationIdentity(result);
            printVerificationBackupSummary(result);
            if (verbose) {
              printVerificationTrustDiagnostics(result);
              printVerificationBackupStatus(result);
              printTimestamp("Recovery key created at", result.recoveryKeyCreatedAt);
              printTimestamp("Verified at", result.verifiedAt);
            }
            printVerificationGuidance(
              {
                ...result,
                pendingVerifications: 0,
              },
              accountId,
            );
          },
          shouldFail: (result) => !result.success,
          errorPrefix: "Verification failed",
          onJsonError: (message) => ({ success: false, error: message }),
        });
      },
    );

  const devices = root
    .command("devices")
    .description(text("Inspect and clean up Matrix devices", "检查并清理 Matrix 设备"));

  devices
    .command("list")
    .description(
      text("List server-side Matrix devices for this account", "列出此账号的服务端 Matrix 设备"),
    )
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(async (options: { account?: string; verbose?: boolean; json?: boolean }) => {
      const accountId = resolveMatrixCliAccountId(options.account);
      await runMatrixCliCommand({
        verbose: options.verbose === true,
        json: options.json === true,
        run: async () => await listMatrixOwnDevices({ accountId }),
        onText: (result) => {
          printAccountLabel(accountId);
          printMatrixOwnDevices(result);
        },
        errorPrefix: "Device listing failed",
      });
    });

  devices
    .command("prune-stale")
    .description(
      text(
        "Delete stale CrawClaw-managed devices for this account",
        "删除此账号中过期的 CrawClaw 托管设备",
      ),
    )
    .option(
      "--account <id>",
      text("Account ID (for multi-account setups)", "账号 ID（多账号设置）"),
    )
    .option("--verbose", text("Show detailed diagnostics", "显示详细诊断信息"))
    .option("--json", text("Output as JSON", "输出 JSON"))
    .action(async (options: { account?: string; verbose?: boolean; json?: boolean }) => {
      const accountId = resolveMatrixCliAccountId(options.account);
      await runMatrixCliCommand({
        verbose: options.verbose === true,
        json: options.json === true,
        run: async () => await pruneMatrixStaleGatewayDevices({ accountId }),
        onText: (result, verbose) => {
          printAccountLabel(accountId);
          console.log(
            `Deleted stale CrawClaw devices: ${result.deletedDeviceIds.length ? result.deletedDeviceIds.join(", ") : "none"}`,
          );
          console.log(`Current device: ${result.currentDeviceId ?? "unknown"}`);
          console.log(`Remaining devices: ${result.remainingDevices.length}`);
          if (verbose) {
            console.log("Devices before cleanup:");
            printMatrixOwnDevices(result.before);
            console.log("Devices after cleanup:");
            printMatrixOwnDevices(result.remainingDevices);
          }
        },
        errorPrefix: "Device cleanup failed",
      });
    });
}
