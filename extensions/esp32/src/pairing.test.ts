import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { issueEsp32PairingSession, verifyEsp32PairingCredentials } from "./pairing.js";

describe("ESP32 pairing sessions", () => {
  it("issues one-time MQTT pairing credentials for ESP32-S3-BOX-3", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-esp32-pair-"));
    try {
      const issued = await issueEsp32PairingSession({
        stateDir,
        name: "desk",
        ttlMs: 5 * 60_000,
        nowMs: 1_000,
      });

      expect(issued.username).toMatch(/^pair:/);
      expect(issued.password.length).toBeGreaterThan(24);
      expect(issued.profile.hardwareTarget).toBe("ESP32-S3-BOX-3");
      expect(issued.expiresAtMs).toBe(301_000);

      await expect(
        verifyEsp32PairingCredentials({
          stateDir,
          username: issued.username,
          password: issued.password,
          nowMs: 2_000,
        }),
      ).resolves.toMatchObject({
        ok: true,
        session: {
          name: "desk",
          hardwareTarget: "ESP32-S3-BOX-3",
        },
      });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("rejects expired or mismatched pairing credentials", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-esp32-pair-"));
    try {
      const issued = await issueEsp32PairingSession({
        stateDir,
        name: "desk",
        ttlMs: 10,
        nowMs: 1_000,
      });

      await expect(
        verifyEsp32PairingCredentials({
          stateDir,
          username: issued.username,
          password: "wrong",
          nowMs: 1_005,
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid-credentials" });

      await expect(
        verifyEsp32PairingCredentials({
          stateDir,
          username: issued.username,
          password: issued.password,
          nowMs: 2_000,
        }),
      ).resolves.toEqual({ ok: false, reason: "expired" });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
