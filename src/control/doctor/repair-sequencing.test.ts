import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { runDoctorRepairSequence } from "./repair-sequencing.js";

describe("doctor repair sequencing", () => {
  it("applies ordered repairs and sanitizes empty-allowlist warnings", async () => {
    const result = await runDoctorRepairSequence({
      state: {
        cfg: {
          channels: {
            tools: {
              exec: {
                toolsBySender: {
                  "bad\u001B[31m-key\u001B[0m\r\nnext": { enabled: true },
                },
              },
            },
          },
        } as unknown as CrawClawConfig,
        candidate: {
          channels: {
            tools: {
              exec: {
                toolsBySender: {
                  "bad\u001B[31m-key\u001B[0m\r\nnext": { enabled: true },
                },
              },
            },
          },
        } as unknown as CrawClawConfig,
        pendingChanges: false,
        fixHints: [],
      },
      doctorFixCommand: "crawclaw doctor --fix",
    });

    expect(result.state.pendingChanges).toBe(true);
    expect(result.changeNotes).toEqual([
      expect.stringContaining(
        "tools.exec.toolsBySender: migrated 1 legacy key to typed id: entries",
      ),
    ]);
    expect(result.changeNotes[0]).toContain("bad-keynext -> id:bad-keynext");
    expect(result.changeNotes[0]).not.toContain("\u001B");
    expect(result.changeNotes[0]).not.toContain("\r");
    expect(result.warningNotes).toEqual([]);
  });
});
