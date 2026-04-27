import { spawn } from "node:child_process";
import type { Component, SelectItem } from "@mariozechner/pi-tui";
import { translateTuiText } from "../cli/i18n/tui.js";
import { createSearchableSelectList } from "./components/selectors.js";

type LocalShellDeps = {
  chatLog: {
    addSystem: (line: string) => void;
  };
  tui: {
    requestRender: () => void;
  };
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  createSelector?: (
    items: SelectItem[],
    maxVisible: number,
  ) => Component & {
    onSelect?: (item: SelectItem) => void;
    onCancel?: () => void;
  };
  spawnCommand?: typeof spawn;
  getCwd?: () => string;
  env?: NodeJS.ProcessEnv;
  maxOutputChars?: number;
};

export function createLocalShellRunner(deps: LocalShellDeps) {
  let localExecAsked = false;
  let localExecAllowed = false;
  const createSelector = deps.createSelector ?? createSearchableSelectList;
  const spawnCommand = deps.spawnCommand ?? spawn;
  const getCwd = deps.getCwd ?? (() => process.cwd());
  const env = deps.env ?? process.env;
  const maxChars = deps.maxOutputChars ?? 40_000;
  const t = (key: string, params?: Record<string, string | number>) =>
    translateTuiText(key, params);

  const ensureLocalExecAllowed = async (): Promise<boolean> => {
    if (localExecAllowed) {
      return true;
    }
    if (localExecAsked) {
      return false;
    }
    localExecAsked = true;

    return await new Promise<boolean>((resolve) => {
      deps.chatLog.addSystem(translateTuiText("tui.local.allowQuestion"));
      deps.chatLog.addSystem(translateTuiText("tui.local.danger"));
      deps.chatLog.addSystem(translateTuiText("tui.local.select"));
      const selector = createSelector(
        [
          { value: "no", label: translateTuiText("tui.local.no") },
          { value: "yes", label: translateTuiText("tui.local.yes") },
        ],
        2,
      );
      selector.onSelect = (item) => {
        deps.closeOverlay();
        if (item.value === "yes") {
          localExecAllowed = true;
          deps.chatLog.addSystem(translateTuiText("tui.local.enabled"));
          resolve(true);
        } else {
          deps.chatLog.addSystem(translateTuiText("tui.local.notEnabled"));
          resolve(false);
        }
        deps.tui.requestRender();
      };
      selector.onCancel = () => {
        deps.closeOverlay();
        deps.chatLog.addSystem(translateTuiText("tui.local.cancelled"));
        deps.tui.requestRender();
        resolve(false);
      };
      deps.openOverlay(selector);
      deps.tui.requestRender();
    });
  };

  const runLocalShellLine = async (line: string) => {
    const cmd = line.slice(1);
    // NOTE: A lone '!' is handled by the submit handler as a normal message.
    // Keep this guard anyway in case this is called directly.
    if (cmd === "") {
      return;
    }

    if (localExecAsked && !localExecAllowed) {
      deps.chatLog.addSystem(translateTuiText("tui.local.notEnabledSession"));
      deps.tui.requestRender();
      return;
    }

    const allowed = await ensureLocalExecAllowed();
    if (!allowed) {
      return;
    }

    deps.chatLog.addSystem(t("tui.local.command", { cmd }));
    deps.tui.requestRender();

    const appendWithCap = (text: string, chunk: string) => {
      const combined = text + chunk;
      return combined.length > maxChars ? combined.slice(-maxChars) : combined;
    };

    await new Promise<void>((resolve) => {
      const child = spawnCommand(cmd, {
        // Intentionally a shell: this is an operator-only local TUI feature (prefixed with `!`)
        // and is gated behind an explicit in-session approval prompt.
        shell: true,
        cwd: getCwd(),
        env: { ...env, CRAWCLAW_SHELL: "tui-local" },
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (buf) => {
        stdout = appendWithCap(stdout, buf.toString("utf8"));
      });
      child.stderr.on("data", (buf) => {
        stderr = appendWithCap(stderr, buf.toString("utf8"));
      });

      child.on("close", (code, signal) => {
        const combined = (stdout + (stderr ? (stdout ? "\n" : "") + stderr : ""))
          .slice(0, maxChars)
          .trimEnd();

        if (combined) {
          for (const line of combined.split("\n")) {
            deps.chatLog.addSystem(t("tui.local.output", { line }));
          }
        }
        deps.chatLog.addSystem(
          t("tui.local.exit", {
            code: code ?? "?",
            signal: signal ? ` (${t("tui.local.signal", { signal })})` : "",
          }),
        );
        deps.tui.requestRender();
        resolve();
      });

      child.on("error", (err) => {
        deps.chatLog.addSystem(t("tui.local.error", { error: String(err) }));
        deps.tui.requestRender();
        resolve();
      });
    });
  };

  return { runLocalShellLine };
}
