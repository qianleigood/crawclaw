/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderUsage } from "./usage.ts";
import type { UsageProps } from "./usageTypes.ts";

function createProps(overrides: Partial<UsageProps> = {}): UsageProps {
  return {
    data: {
      loading: false,
      error: null,
      sessions: [
        {
          key: "session-alpha",
          label: "Alpha session",
          updatedAt: Date.now(),
          usage: {
            input: 10,
            output: 20,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 30,
            totalCost: 1.25,
            inputCost: 0.5,
            outputCost: 0.75,
            cacheReadCost: 0,
            cacheWriteCost: 0,
            missingCostEntries: 0,
            activityDates: ["2026-04-18"],
          },
        } as never,
      ],
      sessionsLimitReached: false,
      totals: {
        input: 10,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
        totalCost: 1.25,
        inputCost: 0.5,
        outputCost: 0.75,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        missingCostEntries: 0,
      },
      aggregates: null,
      costDaily: [],
    },
    filters: {
      startDate: "2026-04-18",
      endDate: "2026-04-18",
      selectedSessions: ["session-alpha"],
      selectedDays: [],
      selectedHours: [],
      query: "agent:alpha",
      queryDraft: "agent:alpha",
      timeZone: "local",
    },
    display: {
      chartMode: "tokens",
      dailyChartMode: "total",
      sessionSort: "tokens",
      sessionSortDir: "desc",
      recentSessions: [],
      sessionsTab: "all",
      visibleColumns: ["agent"],
      contextExpanded: false,
      headerPinned: true,
    },
    detail: {
      timeSeriesMode: "cumulative",
      timeSeriesBreakdownMode: "total",
      timeSeries: null,
      timeSeriesLoading: false,
      timeSeriesCursorStart: null,
      timeSeriesCursorEnd: null,
      sessionLogs: null,
      sessionLogsLoading: false,
      sessionLogsExpanded: false,
      logFilters: {
        roles: [],
        tools: [],
        hasTools: false,
        query: "",
      },
    },
    callbacks: {
      filters: {
        onStartDateChange: () => {},
        onEndDateChange: () => {},
        onRefresh: () => {},
        onTimeZoneChange: () => {},
        onToggleHeaderPinned: () => {},
        onSelectDay: () => {},
        onSelectHour: () => {},
        onClearDays: () => {},
        onClearHours: () => {},
        onClearSessions: () => {},
        onClearFilters: () => {},
        onQueryDraftChange: () => {},
        onApplyQuery: () => {},
        onClearQuery: () => {},
      },
      display: {
        onChartModeChange: () => {},
        onDailyChartModeChange: () => {},
        onSessionSortChange: () => {},
        onSessionSortDirChange: () => {},
        onSessionsTabChange: () => {},
        onToggleColumn: () => {},
      },
      details: {
        onToggleContextExpanded: () => {},
        onToggleSessionLogsExpanded: () => {},
        onLogFilterRolesChange: () => {},
        onLogFilterToolsChange: () => {},
        onLogFilterHasToolsChange: () => {},
        onLogFilterQueryChange: () => {},
        onLogFilterClear: () => {},
        onSelectSession: () => {},
        onTimeSeriesModeChange: () => {},
        onTimeSeriesBreakdownChange: () => {},
        onTimeSeriesCursorRangeChange: () => {},
      },
    },
    ...overrides,
  };
}

describe("renderUsage", () => {
  it("renders usage control context strip", async () => {
    const container = document.createElement("div");
    render(renderUsage(createProps()), container);
    await Promise.resolve();

    expect(container.textContent).toContain("Primary session");
    expect(container.textContent).toContain("session-alpha");
    expect(container.textContent).toContain("Chart mode");
    expect(container.textContent).toContain("Tokens");
    expect(container.textContent).toContain("Header state");
    expect(container.textContent).toContain("Pinned");
    expect(container.textContent).toContain("Query state");
    expect(container.textContent).toContain("Applied");
  });
});
