import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageCliHelpers } from "./helpers.js";
import { registerMessageThreadCommands } from "./register.thread.js";

function createHelpers(runMessageAction: MessageCliHelpers["runMessageAction"]): MessageCliHelpers {
  return {
    t: (key) => key,
    withMessageBase: (command) => command.option("--channel <channel>", "Channel"),
    withMessageTarget: (command) => command.option("-t, --target <dest>", "Target"),
    withRequiredMessageTarget: (command) => command.requiredOption("-t, --target <dest>", "Target"),
    runMessageAction,
  };
}

describe("registerMessageThreadCommands", () => {
  const runMessageAction = vi.fn(
    async (_action: string, _opts: Record<string, unknown>) => undefined,
  );

  beforeEach(() => {
    runMessageAction.mockClear();
  });

  it("routes retained channel thread create through thread-create params", async () => {
    const message = new Command().exitOverride();
    registerMessageThreadCommands(message, createHelpers(runMessageAction));

    await message.parseAsync(
      [
        "thread",
        "create",
        "--channel",
        " feishu ",
        "-t",
        "chat:oc_123",
        "--thread-name",
        "Build Updates",
        "-m",
        "hello",
      ],
      { from: "user" },
    );

    expect(runMessageAction).toHaveBeenCalledWith(
      "thread-create",
      expect.objectContaining({
        channel: " feishu ",
        target: "chat:oc_123",
        threadName: "Build Updates",
        message: "hello",
      }),
    );
    const feishuCall = runMessageAction.mock.calls.at(0);
    expect(feishuCall?.[1]).not.toHaveProperty("name");
  });

  it("keeps generic retained thread create on thread-create params", async () => {
    const message = new Command().exitOverride();
    registerMessageThreadCommands(message, createHelpers(runMessageAction));

    await message.parseAsync(
      [
        "thread",
        "create",
        "--channel",
        "ddingtalk",
        "-t",
        "chat:123",
        "--thread-name",
        "Build Updates",
        "-m",
        "hello",
      ],
      { from: "user" },
    );

    expect(runMessageAction).toHaveBeenCalledWith(
        "thread-create",
      expect.objectContaining({
        channel: "ddingtalk",
        target: "chat:123",
        threadName: "Build Updates",
        message: "hello",
      }),
    );
    const dingTalkCall = runMessageAction.mock.calls.at(0);
    expect(dingTalkCall?.[1]).not.toHaveProperty("name");
  });
});
