import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Esp32DeviceCapabilities } from "./types.js";

export type StoredEsp32Device = {
  deviceId: string;
  name?: string;
  fingerprint?: string;
  capabilities: Esp32DeviceCapabilities;
  lastSeenAtMs?: number;
};

type Esp32DeviceStoreFile = {
  devices: Record<string, StoredEsp32Device>;
};

function storePath(stateDir: string): string {
  return path.join(stateDir, "esp32", "devices.json");
}

async function readStore(stateDir: string): Promise<Esp32DeviceStoreFile> {
  try {
    const raw = await readFile(storePath(stateDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { devices: {} };
    }
    const devices =
      "devices" in parsed && parsed.devices && typeof parsed.devices === "object"
        ? (parsed.devices as Record<string, StoredEsp32Device>)
        : {};
    return { devices };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return { devices: {} };
    }
    throw err;
  }
}

async function writeStore(stateDir: string, state: Esp32DeviceStoreFile): Promise<void> {
  const filePath = storePath(stateDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export class Esp32DeviceStore {
  constructor(private readonly stateDir: string) {}

  async upsert(device: StoredEsp32Device): Promise<void> {
    const state = await readStore(this.stateDir);
    state.devices[device.deviceId] = {
      ...state.devices[device.deviceId],
      ...device,
      capabilities: device.capabilities,
    };
    await writeStore(this.stateDir, state);
  }

  async get(deviceId: string): Promise<StoredEsp32Device | null> {
    const state = await readStore(this.stateDir);
    return state.devices[deviceId] ?? null;
  }

  async list(): Promise<StoredEsp32Device[]> {
    const state = await readStore(this.stateDir);
    return Object.values(state.devices).toSorted((left, right) =>
      left.deviceId.localeCompare(right.deviceId),
    );
  }
}
