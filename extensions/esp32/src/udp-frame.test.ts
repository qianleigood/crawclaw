import { describe, expect, it } from "vitest";
import { decodeUdpFrame, encodeUdpFrame } from "./udp-frame.js";

describe("ESP32 UDP frames", () => {
  it("round-trips AES-CTR encrypted Opus payload frames", () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const nonce = Buffer.from("0102030405060708090a0b0c0d0e0f10", "hex");
    const payload = Buffer.from("opus-frame");

    const frame = encodeUdpFrame({ key, nonce, sequence: 7, payload });
    expect(frame.subarray(20).equals(payload)).toBe(false);

    expect(decodeUdpFrame({ key, frame })).toEqual({
      sequence: 7,
      nonce,
      payload,
    });
  });

  it("rejects malformed frames before decrypting", () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    expect(() => decodeUdpFrame({ key, frame: Buffer.alloc(8) })).toThrow("UDP frame too short");
  });
});
