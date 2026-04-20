import { describe, expect, it } from "vitest";
import "./shell/control-shell.ts";

describe("control shell", () => {
  it("renders stitch shell landmarks with propagated shell props", async () => {
    const el = document.createElement("control-shell") as HTMLElement & {
      locale: "en" | "zh-CN";
      pages: Array<{ id: string; icon: string; label: string }>;
      activePage: string;
      collapsed: boolean;
      eyebrow: string;
      gatewayVersion: string;
      connected: boolean;
      pendingCount: number;
      costLabel: string;
      connectionLabel: string;
    };
    el.locale = "zh-CN";
    el.pages = [
      { id: "overview", icon: "dashboard", label: "系统概览" },
      { id: "sessions", icon: "chat", label: "会话控制台" },
    ];
    el.activePage = "sessions";
    el.collapsed = true;
    el.eyebrow = "运营控制台";
    el.gatewayVersion = "Gateway v2026.04";
    el.connected = true;
    el.pendingCount = 3;
    el.costLabel = "$42.18";
    el.connectionLabel = "本地网关";
    document.body.append(el);
    await customElements.whenDefined("control-topbar");
    await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;

    const sidebar = el.querySelector("control-sidebar") as HTMLElement & {
      updateComplete?: Promise<unknown>;
    };
    const topbar = el.querySelector("control-topbar") as HTMLElement & {
      updateComplete?: Promise<unknown>;
    };
    await sidebar?.updateComplete;
    await topbar?.updateComplete;
    expect(el.querySelector(".cp-shell")).toBeTruthy();
    expect(el.querySelector(".cp-shell.is-nav-collapsed")).toBeTruthy();
    expect(el.querySelector(".cp-sidebar")).toBeTruthy();
    expect(el.querySelector(".cp-topbar")).toBeTruthy();
    expect(topbar?.querySelector(".cp-topbar__stats")).toBeTruthy();
    expect(sidebar?.querySelector(".cp-sidebar.is-collapsed")).toBeTruthy();
    expect(sidebar?.textContent).toContain("运营控制台");
    expect(topbar?.textContent).toContain("Gateway v2026.04");
    expect(topbar?.textContent).toContain("$42.18");
    el.remove();
  });

  it("bubbles navigation, rail toggle, locale change, refresh, and reconnect events", async () => {
    const el = document.createElement("control-shell") as HTMLElement & {
      locale: "en" | "zh-CN";
      pages: Array<{ id: string; icon: string; label: string }>;
      activePage: string;
    };
    el.locale = "en";
    el.pages = [
      { id: "overview", icon: "dashboard", label: "System Overview" },
      { id: "channels", icon: "hub", label: "Channels" },
    ];
    el.activePage = "overview";
    document.body.append(el);
    await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;

    const sidebar = el.querySelector("control-sidebar") as HTMLElement & {
      updateComplete?: Promise<unknown>;
    };
    const topbar = el.querySelector("control-topbar") as HTMLElement & {
      updateComplete?: Promise<unknown>;
    };
    await sidebar?.updateComplete;
    await topbar?.updateComplete;

    const received: string[] = [];
    let navigatedPage = "";
    let nextLocale = "";
    el.addEventListener("navigate", (event) => {
      received.push(event.type);
      navigatedPage = (event as CustomEvent<{ page: string }>).detail.page;
    });
    el.addEventListener("toggle-rail", (event) => {
      received.push(event.type);
    });
    el.addEventListener("locale-change", (event) => {
      received.push(event.type);
      nextLocale = (event as CustomEvent<{ locale: string }>).detail.locale;
    });
    el.addEventListener("refresh-request", (event) => {
      received.push(event.type);
    });
    el.addEventListener("reconnect-request", (event) => {
      received.push(event.type);
    });

    (sidebar.querySelectorAll(".cp-sidebar__item")[1] as HTMLButtonElement | undefined)?.click();
    (sidebar.querySelector(".cp-sidebar__rail-toggle") as HTMLButtonElement | undefined)?.click();
    const localeSelect = topbar.querySelector(
      ".cp-topbar__locale-select",
    ) as HTMLSelectElement | null;
    if (localeSelect) {
      localeSelect.value = "zh-CN";
      localeSelect.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
    (topbar.querySelector('[aria-label="Refresh"]') as HTMLButtonElement | undefined)?.click();
    (topbar.querySelector('[aria-label="Reconnect"]') as HTMLButtonElement | undefined)?.click();

    expect(received).toEqual([
      "navigate",
      "toggle-rail",
      "locale-change",
      "refresh-request",
      "reconnect-request",
    ]);
    expect(navigatedPage).toBe("channels");
    expect(nextLocale).toBe("zh-CN");

    el.remove();
  });
});
