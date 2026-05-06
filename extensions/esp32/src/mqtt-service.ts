import net, { type Server } from "node:net";
import type { AedesPublishPacket, Client } from "aedes";
import type { PluginLogger } from "../api.js";
import {
  ensureDeviceToken,
  getPairedDevice,
  requestDevicePairing,
  verifyDeviceToken,
} from "../api.js";
import type { AedesBroker } from "./aedes.runtime.js";
import { verifyEsp32PairingCredentials } from "./pairing.js";
import {
  deviceCommandTopic,
  deviceStatusTopic,
  normalizeDeviceHello,
  normalizePairingHello,
  normalizeTextInput,
  normalizeToolResult,
  pairingStatusTopic,
  parseJsonObject,
} from "./protocol.js";
import type { Esp32ChannelService } from "./service.js";
import {
  ESP32_DEVICE_ROLE,
  ESP32_DEVICE_SCOPES,
  ESP32_HARDWARE_TARGET,
  type Esp32DeviceCapabilities,
} from "./types.js";

export type Esp32MqttConfig = {
  bindHost: string;
  port: number;
  advertisedHost?: string;
};

type ClientIdentity = { kind: "pairing"; pairId: string } | { kind: "device"; deviceId: string };

function readPassword(password: Buffer | string | undefined | null): string {
  if (Buffer.isBuffer(password)) {
    return password.toString("utf8");
  }
  return typeof password === "string" ? password : "";
}

function readUsername(username: string | Buffer | undefined | null): string {
  if (Buffer.isBuffer(username)) {
    return username.toString("utf8");
  }
  return typeof username === "string" ? username : "";
}

function normalizeClientId(client: unknown): string {
  return client && typeof client === "object" && "id" in client && typeof client.id === "string"
    ? client.id
    : "";
}

function readCapabilities(value: unknown): Esp32DeviceCapabilities {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Esp32DeviceCapabilities)
    : {};
}

export class Esp32MqttService {
  private broker: AedesBroker | null = null;
  private server: Server | null = null;
  private readonly identities = new Map<string, ClientIdentity>();

  constructor(
    private readonly params: {
      config: Esp32MqttConfig;
      stateDir: string;
      service: Esp32ChannelService;
      logger: PluginLogger;
    },
  ) {}

  async start(): Promise<void> {
    if (this.broker) {
      return;
    }
    const { createAedesBroker } = await import("./aedes.runtime.js");
    const broker = createAedesBroker();
    this.broker = broker;
    broker.authenticate = (client: Client, username, password, callback) => {
      void this.authenticateClient(client, username, password)
        .then((identity) => {
          if (identity) {
            this.identities.set(normalizeClientId(client), identity);
            callback(null, true);
            return;
          }
          callback(null, false);
        })
        .catch(() => callback(null, false));
    };
    broker.on("publish", (packet: AedesPublishPacket, client: Client | null) => {
      if (!client) {
        return;
      }
      void this.handlePublish(packet, client).catch((err) => {
        this.params.logger.warn(`[esp32] MQTT publish handling failed: ${String(err)}`);
      });
    });

    const server = net.createServer(broker.handle);
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.params.config.port, this.params.config.bindHost);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    const broker = this.broker;
    this.server = null;
    this.broker = null;
    this.identities.clear();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (broker) {
      await new Promise<void>((resolve) => broker.close(() => resolve()));
    }
  }

  publish(deviceId: string, payload: Record<string, unknown>): void {
    this.publishRaw(deviceCommandTopic(deviceId), payload);
  }

  publishRaw(topic: string, payload: Record<string, unknown>): void {
    this.broker?.publish(
      {
        cmd: "publish",
        topic,
        payload: Buffer.from(JSON.stringify(payload)),
        qos: 0,
        dup: false,
        retain: false,
      },
      () => {},
    );
  }

  private async authenticateClient(
    client: unknown,
    username: string | Buffer | undefined | null,
    password: Buffer | string | undefined | null,
  ): Promise<ClientIdentity | null> {
    const user = readUsername(username);
    if (user.startsWith("pair:")) {
      const verified = await verifyEsp32PairingCredentials({
        stateDir: this.params.stateDir,
        username: user,
        password: readPassword(password),
      });
      return verified.ok ? { kind: "pairing", pairId: verified.session.pairId } : null;
    }
    if (user.startsWith("esp32:")) {
      const deviceId = user.slice("esp32:".length).trim();
      const verified = await verifyDeviceToken({
        deviceId,
        token: readPassword(password),
        role: ESP32_DEVICE_ROLE,
        scopes: [...ESP32_DEVICE_SCOPES],
        baseDir: this.params.stateDir,
      });
      if (!verified.ok) {
        return null;
      }
      this.params.service.registerOnlineDevice({ deviceId, capabilities: {} });
      return { kind: "device", deviceId };
    }
    this.params.logger.debug?.(`[esp32] rejected MQTT client ${normalizeClientId(client)}`);
    return null;
  }

  private async handlePublish(packet: AedesPublishPacket, client: Client): Promise<void> {
    const identity = this.identities.get(normalizeClientId(client));
    if (!identity || !packet.payload) {
      return;
    }
    const raw = parseJsonObject(
      Buffer.isBuffer(packet.payload) ? packet.payload : Buffer.from(packet.payload),
    );
    if (!raw) {
      return;
    }
    if (identity.kind === "pairing") {
      await this.handlePairingPublish(identity.pairId, packet.topic, raw);
      return;
    }
    await this.handleDevicePublish(identity.deviceId, packet.topic, raw);
  }

  private async handlePairingPublish(
    pairId: string,
    topic: string,
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (topic.endsWith("/hello")) {
      const hello = normalizePairingHello(raw);
      if (!hello) {
        this.publishRaw(pairingStatusTopic(pairId), {
          type: "pairing.error",
          error: "deviceId required",
        });
        return;
      }
      const capabilities = readCapabilities(hello.capabilities);
      await this.params.service.persistDeviceProfile({
        deviceId: hello.deviceId,
        name: hello.name,
        fingerprint: hello.fingerprint,
        capabilities: { hardwareTarget: ESP32_HARDWARE_TARGET, ...capabilities },
      });
      const request = await requestDevicePairing(
        {
          deviceId: hello.deviceId,
          publicKey: hello.fingerprint ?? hello.deviceId,
          displayName: hello.name,
          platform: "esp32",
          deviceFamily: ESP32_HARDWARE_TARGET,
          clientMode: "mqtt-udp",
          role: ESP32_DEVICE_ROLE,
          scopes: [...ESP32_DEVICE_SCOPES],
        },
        this.params.stateDir,
      );
      this.publishRaw(pairingStatusTopic(pairId), {
        type: "pairing.pending",
        requestId: request.request.requestId,
        deviceId: hello.deviceId,
        approve: `crawclaw devices approve ${request.request.requestId}`,
      });
      return;
    }

    if (topic.endsWith("/wait")) {
      const deviceId = typeof raw.deviceId === "string" ? raw.deviceId.trim() : "";
      if (!deviceId) {
        return;
      }
      await this.publishApprovalIfReady(pairId, deviceId);
    }
  }

  private async publishApprovalIfReady(pairId: string, deviceId: string): Promise<void> {
    const paired = await getPairedDevice(deviceId, this.params.stateDir);
    if (!paired) {
      this.publishRaw(pairingStatusTopic(pairId), { type: "pairing.pending", deviceId });
      return;
    }
    const token = await ensureDeviceToken({
      deviceId,
      role: ESP32_DEVICE_ROLE,
      scopes: [...ESP32_DEVICE_SCOPES],
      baseDir: this.params.stateDir,
    });
    if (!token) {
      this.publishRaw(pairingStatusTopic(pairId), {
        type: "pairing.error",
        deviceId,
        error: "approved device token unavailable",
      });
      return;
    }
    this.publishRaw(pairingStatusTopic(pairId), {
      type: "pairing.approved",
      deviceId,
      mqtt: {
        host: this.params.config.advertisedHost ?? this.params.config.bindHost,
        port: this.params.config.port,
        username: `esp32:${deviceId}`,
        password: token.token,
      },
      udp: this.params.service.ensureUdpSession(deviceId),
      paired: {
        displayName: paired.displayName,
        deviceFamily: paired.deviceFamily,
      },
    });
  }

  private async handleDevicePublish(
    deviceId: string,
    topic: string,
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (topic.endsWith("/hello")) {
      const hello = normalizeDeviceHello({ ...raw, deviceId: raw.deviceId ?? deviceId });
      if (!hello) {
        return;
      }
      const capabilities = readCapabilities(hello.capabilities);
      this.params.service.registerOnlineDevice({
        deviceId,
        capabilities: { hardwareTarget: ESP32_HARDWARE_TARGET, ...capabilities },
      });
      await this.params.service.persistDeviceProfile({
        deviceId,
        name: hello.name,
        fingerprint: hello.fingerprint,
        capabilities: { hardwareTarget: ESP32_HARDWARE_TARGET, ...capabilities },
      });
      const udpHost = hello.udp?.host;
      const udpPort = hello.udp?.port;
      if (udpHost && udpPort) {
        this.params.service.setUdpEndpoint(deviceId, { host: udpHost, port: udpPort });
      }
      this.publishRaw(deviceStatusTopic(deviceId), {
        type: "hello.ok",
        udp: this.params.service.ensureUdpSession(deviceId),
      });
      return;
    }

    if (topic.endsWith("/tools/list")) {
      this.params.service.registerOnlineDevice({
        deviceId,
        capabilities: { tools: Array.isArray(raw.tools) ? raw.tools : [] },
      });
      return;
    }

    if (topic.endsWith("/tools/result")) {
      const result = normalizeToolResult(raw);
      if (result) {
        this.params.service.resolveDeviceToolResult({ deviceId, ...result });
      }
      return;
    }

    if (topic.endsWith("/input/text")) {
      const input = normalizeTextInput(raw);
      if (input) {
        await this.params.service.handleTextInput({ deviceId, ...input });
      }
    }
  }
}
