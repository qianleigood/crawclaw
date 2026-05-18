import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { makeNetworkInterfacesSnapshot } from "../test-helpers/network-interfaces.js";
import { listTailnetAddresses } from "./tailnet.js";

describe("infra runtime", () => {
  describe("tailnet address detection", () => {
    it("detects tailscale IPv4 and IPv6 addresses", () => {
      vi.spyOn(os, "networkInterfaces").mockReturnValue(
        makeNetworkInterfacesSnapshot({
          lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
          utun9: [
            { address: "100.123.224.76", family: "IPv4" },
            { address: "fd7a:115c:a1e0::8801:e04c", family: "IPv6" },
          ],
        }),
      );

      const out = listTailnetAddresses();
      expect(out.ipv4).toEqual(["100.123.224.76"]);
      expect(out.ipv6).toEqual(["fd7a:115c:a1e0::8801:e04c"]);
    });
  });
});
