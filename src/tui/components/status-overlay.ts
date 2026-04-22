import { matchesKey, type Component, truncateToWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

export class StatusOverlayComponent implements Component {
  constructor(
    private readonly lines: string[],
    private readonly onClose: () => void,
  ) {}

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 4);
    return this.lines.map((line, index) => {
      const text = truncateToWidth(line, innerWidth, "…");
      if (index === 0) {
        return theme.header(text);
      }
      return theme.dim(text);
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "enter") || data === "\u0003") {
      this.onClose();
    }
  }

  invalidate(): void {}
}
