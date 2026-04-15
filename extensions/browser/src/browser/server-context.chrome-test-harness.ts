import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/crawclaw" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchCrawClawChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveCrawClawUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopCrawClawChrome: vi.fn(async () => {}),
}));
