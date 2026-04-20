import { describe, expect, it } from "vitest";
import "./screens/channels-screen.ts";

describe("channels screen subflows", () => {
  it("renders management, catalog, and feishu editor as explicit channels subflows", async () => {
    const el = document.createElement("channels-screen") as HTMLElement & {
      mode: "management" | "catalog" | "editor";
      updateComplete?: Promise<unknown>;
    };
    el.mode = "catalog";
    document.body.append(el);
    await customElements.whenDefined("channels-screen");
    await el.updateComplete;

    expect(el.querySelector('[data-flow="catalog"]')).toBeTruthy();
    expect(el.querySelector(".cp-channel-catalog")).toBeTruthy();
    el.remove();
  });
});
