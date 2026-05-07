import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ESP32_HARDWARE_TARGET, type Esp32DeviceProfile } from "./types.js";

type PairingSessionRecord = {
  pairId: string;
  password: string;
  name?: string;
  hardwareTarget: typeof ESP32_HARDWARE_TARGET;
  issuedAtMs: number;
  expiresAtMs: number;
};

type PairingSessionState = Record<string, PairingSessionRecord>;

export type Esp32PairingSession = PairingSessionRecord & {
  username: string;
};

export type IssueEsp32PairingSessionParams = {
  stateDir: string;
  name?: string;
  ttlMs: number;
  nowMs?: number;
};

export type VerifyEsp32PairingCredentialsParams = {
  stateDir: string;
  username: string;
  password: string;
  nowMs?: number;
};

export const ESP32_BOX_3_PROFILE: Esp32DeviceProfile = {
  hardwareTarget: ESP32_HARDWARE_TARGET,
  audio: {
    input: "i2s",
    output: "i2s",
    codec: "opus",
  },
  display: {
    width: 320,
    height: 240,
    color: true,
  },
};

function resolvePairingPath(stateDir: string): string {
  return path.join(stateDir, "esp32", "pairing-sessions.json");
}

async function readState(stateDir: string): Promise<PairingSessionState> {
  try {
    const raw = await readFile(resolvePairingPath(stateDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PairingSessionState)
      : {};
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

async function writeState(stateDir: string, state: PairingSessionState): Promise<void> {
  const filePath = resolvePairingPath(stateDir);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export async function listEsp32PairingSessions(
  stateDir: string,
  nowMs: number = Date.now(),
): Promise<Esp32PairingSession[]> {
  const state = pruneExpired(await readState(stateDir), nowMs);
  await writeState(stateDir, state);
  return Object.values(state)
    .toSorted((left, right) => right.issuedAtMs - left.issuedAtMs)
    .map((entry) => ({
      ...entry,
      username: `pair:${entry.pairId}`,
    }));
}

export async function revokeEsp32PairingSession(
  stateDir: string,
  pairId: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const state = pruneExpired(await readState(stateDir), nowMs);
  if (!state[pairId]) {
    await writeState(stateDir, state);
    return false;
  }
  delete state[pairId];
  await writeState(stateDir, state);
  return true;
}

function pruneExpired(state: PairingSessionState, nowMs: number): PairingSessionState {
  const next: PairingSessionState = {};
  for (const [pairId, entry] of Object.entries(state)) {
    if (entry.expiresAtMs > nowMs) {
      next[pairId] = entry;
    }
  }
  return next;
}

function createToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parsePairUsername(username: string): string | null {
  const trimmed = username.trim();
  if (!trimmed.startsWith("pair:")) {
    return null;
  }
  const pairId = trimmed.slice("pair:".length).trim();
  return pairId || null;
}

export async function issueEsp32PairingSession(
  params: IssueEsp32PairingSessionParams,
): Promise<Esp32PairingSession & { profile: Esp32DeviceProfile }> {
  const nowMs = params.nowMs ?? Date.now();
  const pairId = createToken(8);
  const password = createToken(32);
  const state = pruneExpired(await readState(params.stateDir), nowMs);
  const record: PairingSessionRecord = {
    pairId,
    password,
    name: params.name?.trim() || undefined,
    hardwareTarget: ESP32_HARDWARE_TARGET,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + params.ttlMs,
  };
  state[pairId] = record;
  await writeState(params.stateDir, state);
  return {
    ...record,
    username: `pair:${pairId}`,
    profile: ESP32_BOX_3_PROFILE,
  };
}

export async function verifyEsp32PairingCredentials(
  params: VerifyEsp32PairingCredentialsParams,
): Promise<
  | { ok: true; session: Omit<PairingSessionRecord, "password"> }
  | { ok: false; reason: "invalid-username" | "invalid-credentials" | "expired" }
> {
  const pairId = parsePairUsername(params.username);
  if (!pairId) {
    return { ok: false, reason: "invalid-username" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const state = await readState(params.stateDir);
  const session = state[pairId];
  if (!session) {
    return { ok: false, reason: "invalid-credentials" };
  }
  if (session.expiresAtMs <= nowMs) {
    await writeState(params.stateDir, pruneExpired(state, nowMs));
    return { ok: false, reason: "expired" };
  }
  if (!safeEqual(params.password, session.password)) {
    return { ok: false, reason: "invalid-credentials" };
  }
  return {
    ok: true,
    session: {
      pairId: session.pairId,
      name: session.name,
      hardwareTarget: session.hardwareTarget,
      issuedAtMs: session.issuedAtMs,
      expiresAtMs: session.expiresAtMs,
    },
  };
}
