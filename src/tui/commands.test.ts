import { afterEach, describe, expect, it } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/index.js";
import { getSlashCommands, helpText, parseCommand } from "./commands.js";

afterEach(() => {
  setActiveCliLocale("en");
});

describe("parseCommand", () => {
  it("normalizes aliases and keeps command args", () => {
    expect(parseCommand("/elev full")).toEqual({ name: "elevated", args: "full" });
  });

  it("returns empty name for empty input", () => {
    expect(parseCommand("   ")).toEqual({ name: "", args: "" });
  });
});

describe("getSlashCommands", () => {
  it("provides level completions for built-in toggles", () => {
    const commands = getSlashCommands();
    const verbose = commands.find((command) => command.name === "verbose");
    const activation = commands.find((command) => command.name === "activation");
    const deliver = commands.find((command) => command.name === "deliver");
    expect(verbose?.getArgumentCompletions?.("o")).toEqual([
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ]);
    expect(activation?.getArgumentCompletions?.("a")).toEqual([
      { value: "always", label: "always" },
    ]);
    expect(deliver?.getArgumentCompletions?.("o")).toEqual([
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ]);
  });

  it("localizes command descriptions in zh-CN", () => {
    setActiveCliLocale("zh-CN");

    const commands = getSlashCommands();

    expect(commands.find((command) => command.name === "status")?.description).toBe(
      "显示网关状态摘要",
    );
  });
});

describe("helpText", () => {
  it("includes slash command help for aliases", () => {
    const output = helpText();
    expect(output).toContain("/elevated <on|off|ask|full>");
    expect(output).toContain("/elev <on|off|ask|full>");
    expect(output).toContain("/deliver <status|on|off>");
  });

  it("localizes help title in zh-CN while preserving command syntax", () => {
    setActiveCliLocale("zh-CN");

    const output = helpText();

    expect(output).toContain("斜杠命令：");
    expect(output).toContain("/deliver <status|on|off>");
  });
});
