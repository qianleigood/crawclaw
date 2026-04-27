import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeBundledMetadataOnlyChannelCatalogContract,
  describeChannelCatalogEntryContract,
  describeOfficialFallbackChannelCatalogContract,
} from "../../../../test/helpers/channels/channel-catalog-contract.js";
import { listChannelPluginCatalogEntries } from "../catalog.js";

describeChannelCatalogEntryContract({
  channelId: "msteams",
  npmSpec: "@crawclaw/msteams",
  alias: "teams",
});

const whatsappMeta = {
  id: "whatsapp",
  label: "WhatsApp",
  selectionLabel: "WhatsApp (QR link)",
  detailLabel: "WhatsApp Web",
  docsPath: "/channels/whatsapp",
  blurb: "works with your own number; recommend a separate phone + eSIM.",
};

describeBundledMetadataOnlyChannelCatalogContract({
  pluginId: "whatsapp",
  packageName: "@crawclaw/whatsapp",
  npmSpec: "@crawclaw/whatsapp",
  meta: whatsappMeta,
  defaultChoice: "npm",
});

describeOfficialFallbackChannelCatalogContract({
  channelId: "whatsapp",
  npmSpec: "@crawclaw/whatsapp",
  meta: whatsappMeta,
  packageName: "@crawclaw/whatsapp",
  pluginId: "whatsapp",
  externalNpmSpec: "@vendor/whatsapp-fork",
  externalLabel: "WhatsApp Fork",
});

describe("channel catalog profile metadata", () => {
  it("preserves channel profile from package metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-profile-catalog-"));
    const catalogPath = path.join(dir, "channel-catalog.json");
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({
        entries: [
          {
            name: "@crawclaw/feishu",
            crawclaw: {
              channel: {
                id: "feishu",
                label: "Feishu",
                selectionLabel: "Feishu",
                docsPath: "/channels/feishu",
                blurb: "Feishu messaging",
                profile: "primary-cn",
              },
              install: { npmSpec: "@crawclaw/feishu" },
            },
          },
        ],
      }),
      "utf8",
    );

    const entry = listChannelPluginCatalogEntries({
      officialCatalogPaths: [catalogPath],
      env: {
        ...process.env,
        CRAWCLAW_BUNDLED_PLUGINS_DIR: "/nonexistent/bundled/plugins",
      },
    }).find((item) => item.id === "feishu");

    expect(entry?.meta.profile).toBe("primary-cn");
  });

  it("marks bundled Weixin as a primary China quickstart channel", () => {
    const entry = listChannelPluginCatalogEntries().find((item) => item.id === "weixin");
    expect(entry?.meta.profile).toBe("primary-cn");
  });
});
