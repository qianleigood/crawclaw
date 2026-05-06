import { createCipheriv, createDecipheriv } from "node:crypto";

export type Esp32UdpDecodedFrame = {
  sequence: number;
  nonce: Buffer;
  payload: Buffer;
};

function validateAesCtrInput(key: Buffer, nonce: Buffer): void {
  if (![16, 24, 32].includes(key.length)) {
    throw new Error("AES-CTR key must be 16, 24, or 32 bytes");
  }
  if (nonce.length !== 16) {
    throw new Error("AES-CTR nonce must be 16 bytes");
  }
}

function aesCtrCrypt(params: { key: Buffer; nonce: Buffer; payload: Buffer }): Buffer {
  validateAesCtrInput(params.key, params.nonce);
  const algorithm = `aes-${params.key.length * 8}-ctr`;
  const cipher = createCipheriv(algorithm, params.key, params.nonce);
  return Buffer.concat([cipher.update(params.payload), cipher.final()]);
}

function aesCtrDecrypt(params: { key: Buffer; nonce: Buffer; payload: Buffer }): Buffer {
  validateAesCtrInput(params.key, params.nonce);
  const algorithm = `aes-${params.key.length * 8}-ctr`;
  const decipher = createDecipheriv(algorithm, params.key, params.nonce);
  return Buffer.concat([decipher.update(params.payload), decipher.final()]);
}

export function encodeUdpFrame(params: {
  key: Buffer;
  nonce: Buffer;
  sequence: number;
  payload: Buffer;
}): Buffer {
  if (!Number.isInteger(params.sequence) || params.sequence < 0 || params.sequence > 0xffffffff) {
    throw new Error("UDP frame sequence must be a uint32");
  }
  const header = Buffer.alloc(20);
  header.writeUInt32BE(params.sequence, 0);
  params.nonce.copy(header, 4);
  return Buffer.concat([
    header,
    aesCtrCrypt({
      key: params.key,
      nonce: params.nonce,
      payload: params.payload,
    }),
  ]);
}

export function decodeUdpFrame(params: { key: Buffer; frame: Buffer }): Esp32UdpDecodedFrame {
  if (params.frame.length < 21) {
    throw new Error("UDP frame too short");
  }
  const sequence = params.frame.readUInt32BE(0);
  const nonce = params.frame.subarray(4, 20);
  const encrypted = params.frame.subarray(20);
  return {
    sequence,
    nonce,
    payload: aesCtrDecrypt({
      key: params.key,
      nonce,
      payload: encrypted,
    }),
  };
}
