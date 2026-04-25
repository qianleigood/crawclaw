import { describe, expect, it } from "vitest";
import { ChatLog } from "./chat-log.js";

describe("ChatLog", () => {
  it("caps component growth to avoid unbounded render trees", () => {
    const chatLog = new ChatLog(20);
    for (let i = 1; i <= 40; i++) {
      chatLog.addSystem(`system-${i}`);
    }

    expect(chatLog.children.length).toBe(20);
    const rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("system-40");
    expect(rendered).not.toContain("system-1");
  });

  it("drops stale streaming references when old components are pruned", () => {
    const chatLog = new ChatLog(20);
    chatLog.startAssistant("first", "run-1");
    for (let i = 0; i < 25; i++) {
      chatLog.addSystem(`overflow-${i}`);
    }

    // Should not throw if the original streaming component was pruned.
    chatLog.updateAssistant("recreated", "run-1");

    const rendered = chatLog.render(120).join("\n");
    expect(chatLog.children.length).toBe(20);
    expect(rendered).toContain("recreated");
  });

  it("does not append duplicate assistant components when a run is started twice", () => {
    const chatLog = new ChatLog(40);
    chatLog.startAssistant("first", "run-dup");
    chatLog.startAssistant("second", "run-dup");

    const rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("second");
    expect(rendered).not.toContain("first");
    expect(chatLog.children.length).toBe(1);
  });

  it("drops stale tool references when old components are pruned", () => {
    const chatLog = new ChatLog(20);
    chatLog.startTool("tool-1", "read_file", { path: "a.txt" });
    for (let i = 0; i < 25; i++) {
      chatLog.addSystem(`overflow-${i}`);
    }

    // Should no-op safely after the tool component is pruned.
    chatLog.updateToolResult("tool-1", { content: [{ type: "text", text: "done" }] });

    expect(chatLog.children.length).toBe(20);
  });

  it("lists tool states and toggles one tool without expanding all tools", () => {
    const chatLog = new ChatLog(40);
    chatLog.startTool("tool-1", "exec", { command: "echo hi" });
    chatLog.startTool("tool-2", "read_file", { path: "a.txt" });
    chatLog.updateToolResult("tool-2", {
      content: [{ type: "text", text: "done" }],
    });

    expect(chatLog.listTools()).toEqual([
      expect.objectContaining({
        id: "tool-1",
        toolName: "exec",
        status: "running",
        expanded: false,
      }),
      expect.objectContaining({
        id: "tool-2",
        toolName: "read_file",
        status: "done",
        expanded: false,
      }),
    ]);

    expect(chatLog.toggleToolExpanded("tool-1")).toBe(true);
    expect(chatLog.listTools()[0]).toEqual(
      expect.objectContaining({
        id: "tool-1",
        expanded: true,
      }),
    );
    expect(chatLog.listTools()[1]).toEqual(
      expect.objectContaining({
        id: "tool-2",
        expanded: false,
      }),
    );

    expect(chatLog.toggleAllToolsExpanded()).toBe(true);
    expect(chatLog.listTools().map((tool) => tool.expanded)).toEqual([true, true]);
  });

  it("marks failed tools in the listed state", () => {
    const chatLog = new ChatLog(40);
    chatLog.startTool("tool-err", "exec", { command: "false" });
    chatLog.updateToolResult(
      "tool-err",
      {
        content: [{ type: "text", text: "exit 1" }],
      },
      { isError: true },
    );

    expect(chatLog.listTools()).toEqual([
      expect.objectContaining({
        id: "tool-err",
        status: "error",
      }),
    ]);
  });

  it("renders tool headers with shared readable execution summaries", () => {
    const chatLog = new ChatLog(40);
    chatLog.startTool("tool-read", "read", { path: "package.json" });

    const rendered = chatLog.render(120).join("\n");

    expect(rendered).toContain("Reading from package.json");
    expect(rendered).not.toContain("Read (running)");
  });

  it("prunes system messages atomically when a non-system entry overflows the log", () => {
    const chatLog = new ChatLog(20);
    for (let i = 1; i <= 20; i++) {
      chatLog.addSystem(`system-${i}`);
    }

    chatLog.addUser("hello");

    const rendered = chatLog.render(120).join("\n");
    expect(rendered).not.toMatch(/\bsystem-1\b/);
    expect(rendered).toMatch(/\bsystem-2\b/);
    expect(rendered).toMatch(/\bsystem-20\b/);
    expect(rendered).toContain("hello");
    expect(chatLog.children.length).toBe(20);
  });

  it("renders BTW inline and removes it when dismissed", () => {
    const chatLog = new ChatLog(40);

    chatLog.addSystem("session agent:main:main");
    chatLog.showBtw({
      question: "what is 17 * 19?",
      text: "323",
    });

    let rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("BTW: what is 17 * 19?");
    expect(rendered).toContain("323");
    expect(chatLog.hasVisibleBtw()).toBe(true);

    chatLog.dismissBtw();

    rendered = chatLog.render(120).join("\n");
    expect(rendered).not.toContain("BTW: what is 17 * 19?");
    expect(chatLog.hasVisibleBtw()).toBe(false);
  });
});
