import { randomBytes } from "node:crypto";
import dgram, { type RemoteInfo, type Socket } from "node:dgram";
import { encodeUdpFrame } from "./udp-frame.js";

export type Esp32UdpConfig = {
  bindHost: string;
  port: number;
  advertisedHost?: string;
};

export type Esp32UdpSessionPublicParams = {
  host: string;
  port: number;
  key: string;
  nonce: string;
};

type UdpSession = {
  deviceId: string;
  key: Buffer;
  baseNonce: Buffer;
  sequence: number;
  endpoint?: {
    host: string;
    port: number;
  };
};

function deriveFrameNonce(baseNonce: Buffer, sequence: number): Buffer {
  const nonce = Buffer.from(baseNonce);
  nonce.writeUInt32BE(sequence >>> 0, 12);
  return nonce;
}

export class Esp32UdpService {
  private socket: Socket | null = null;
  private readonly sessions = new Map<string, UdpSession>();

  constructor(private readonly config: Esp32UdpConfig) {}

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }
    const socket = dgram.createSocket("udp4");
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        socket.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        socket.off("error", onError);
        resolve();
      };
      socket.once("error", onError);
      socket.once("listening", onListening);
      socket.bind(this.config.port, this.config.bindHost);
    });
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      return;
    }
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }

  ensureSession(deviceId: string): Esp32UdpSessionPublicParams {
    const existing = this.sessions.get(deviceId);
    const session = existing ?? {
      deviceId,
      key: randomBytes(32),
      baseNonce: randomBytes(16),
      sequence: 0,
    };
    this.sessions.set(deviceId, session);
    return {
      host: this.config.advertisedHost ?? this.config.bindHost,
      port: this.config.port,
      key: session.key.toString("hex"),
      nonce: session.baseNonce.toString("hex"),
    };
  }

  setEndpoint(deviceId: string, endpoint: { host: string; port: number }): void {
    const session = this.sessions.get(deviceId);
    if (!session) {
      this.ensureSession(deviceId);
    }
    const next = this.sessions.get(deviceId);
    if (next) {
      next.endpoint = endpoint;
    }
  }

  noteRemoteEndpoint(deviceId: string, remote: RemoteInfo): void {
    this.setEndpoint(deviceId, { host: remote.address, port: remote.port });
  }

  sendAudio(deviceId: string, audioBuffer: Buffer): number {
    const socket = this.socket;
    const session = this.sessions.get(deviceId);
    if (!socket || !session?.endpoint) {
      return 0;
    }
    let frames = 0;
    for (let offset = 0; offset < audioBuffer.length; offset += 960) {
      const sequence = session.sequence++;
      const payload = audioBuffer.subarray(offset, offset + 960);
      const frame = encodeUdpFrame({
        key: session.key,
        nonce: deriveFrameNonce(session.baseNonce, sequence),
        sequence,
        payload,
      });
      socket.send(frame, session.endpoint.port, session.endpoint.host);
      frames += 1;
    }
    return frames;
  }
}
