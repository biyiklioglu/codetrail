// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, setTestStrategyIntervalOverrides } from "./App";
import type { PaneStateSnapshot } from "./app/types";
import { SEARCH_PLACEHOLDERS } from "./lib/searchLabels";
import { createAppClient } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

const FAST_OVERRIDES = {
  "scan-5s": 100,
  "scan-10s": 200,
  "scan-30s": 300,
  "scan-1min": 400,
  "scan-5min": 500,
} as const;

function countChannelCalls(client: ReturnType<typeof createAppClient>, channel: string): number {
  return client.invoke.mock.calls.filter(([name]) => name === channel).length;
}

function getChannelCalls(
  client: ReturnType<typeof createAppClient>,
  channel: string,
): Array<[string, Record<string, unknown>]> {
  return client.invoke.mock.calls.filter(([name]) => name === channel) as Array<
    [string, Record<string, unknown>]
  >;
}

function makeProjectSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "project_1",
    provider: "claude",
    name: "Project One",
    path: "/workspace/project-one",
    sessionCount: 1,
    messageCount: 2,
    bookmarkCount: 0,
    lastActivity: "2026-03-01T10:00:05.000Z",
    ...overrides,
  };
}

function makeSessionSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "session_1",
    projectId: "project_1",
    provider: "claude",
    filePath: "/workspace/project-one/session-1.jsonl",
    title: "Investigate markdown rendering",
    modelNames: "claude-opus-4-1",
    startedAt: "2026-03-01T10:00:00.000Z",
    endedAt: "2026-03-01T10:00:05.000Z",
    durationMs: 5000,
    gitBranch: "main",
    cwd: "/workspace/project-one",
    messageCount: 2,
    bookmarkCount: 0,
    tokenInputTotal: 14,
    tokenOutputTotal: 8,
    ...overrides,
  };
}

describe("App periodic refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setTestStrategyIntervalOverrides(FAST_OVERRIDES);
  });

  afterEach(() => {
    setTestStrategyIntervalOverrides(null);
    vi.useRealTimers();
  });

  it("fires incremental refresh repeatedly on each interval tick", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    const refreshCallsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    // Select 5s scan (mapped to 100ms via override)
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsBefore);
    });

    const refreshCallsAfterFirst = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsAfterFirst);
    });
  });

  it("stops periodic refresh when set back to Manual", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    const refreshCallsBeforeOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "Manual" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const refreshCallsAfterOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;
    expect(refreshCallsAfterOff).toBe(refreshCallsBeforeOff);
  });

  it("auto-refresh reloads project summaries and only the selected project sessions when history is visible", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          makeProjectSummary(),
          {
            ...makeProjectSummary({
              id: "project_2",
              provider: "codex",
              name: "Project Two",
              path: "/workspace/project-two",
              lastActivity: "2026-03-01T10:01:05.000Z",
            }),
          },
        ],
      }),
      "sessions:list": (request) => ({
        sessions: [
          request.projectId === "project_2"
            ? makeSessionSummary({
                id: "session_2",
                projectId: "project_2",
                provider: "codex",
                filePath: "/workspace/project-two/session-2.jsonl",
                title: "Investigate tree refresh failure",
                cwd: "/workspace/project-two",
              })
            : makeSessionSummary(),
        ],
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            projectViewMode: "list",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Investigate markdown rendering/i }),
      ).toBeInTheDocument();
    });

    const projectsBefore = countChannelCalls(client, "projects:list");
    const sessionsBefore = countChannelCalls(client, "sessions:list");
    const sessionDetailBefore = countChannelCalls(client, "sessions:getDetail");
    const searchBefore = countChannelCalls(client, "search:query");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "projects:list")).toBeGreaterThan(projectsBefore);
      expect(countChannelCalls(client, "sessions:list")).toBeGreaterThan(sessionsBefore);
    });

    const newSessionCalls = getChannelCalls(client, "sessions:list").slice(sessionsBefore);
    expect(newSessionCalls.length).toBeGreaterThan(0);
    expect(
      newSessionCalls.every(([, payload]) => String(payload.projectId ?? "") === "project_1"),
    ).toBe(true);
    expect(countChannelCalls(client, "sessions:getDetail")).toBe(sessionDetailBefore);
    expect(countChannelCalls(client, "search:query")).toBe(searchBefore);
  });

  it("auto-refresh re-fetches session detail when the selected session fingerprint changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionMessageCount = 2;
    const client = createAppClient({
      "sessions:list": () => ({
        sessions: [makeSessionSummary({ messageCount: sessionMessageCount })],
      }),
      "sessions:getDetail": () => ({
        session: {
          ...makeSessionSummary({ messageCount: sessionMessageCount }),
        },
        totalCount: sessionMessageCount,
        categoryCounts: {
          user: sessionMessageCount,
          assistant: 0,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page: 0,
        pageSize: 100,
        focusIndex: null,
        messages: [],
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(countChannelCalls(client, "sessions:list")).toBeGreaterThan(0);
      expect(countChannelCalls(client, "sessions:getDetail")).toBeGreaterThan(0);
    });

    const sessionDetailBefore = countChannelCalls(client, "sessions:getDetail");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));
    sessionMessageCount = 3;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "sessions:getDetail")).toBeGreaterThan(sessionDetailBefore);
    });
  });

  it("auto-refresh skips project_all detail reload when the selected project fingerprint is unchanged", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "projects:list": () => ({
        projects: [makeProjectSummary({ messageCount: 250 })],
      }),
      "projects:getCombinedDetail": () => ({
        projectId: "project_1",
        totalCount: 250,
        categoryCounts: {
          user: 125,
          assistant: 125,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page: 0,
        pageSize: 100,
        focusIndex: null,
        messages: [],
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
      expect(countChannelCalls(client, "projects:getCombinedDetail")).toBeGreaterThan(0);
    });

    const detailBefore = countChannelCalls(client, "projects:getCombinedDetail");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "projects:list")).toBeGreaterThan(1);
    });

    expect(countChannelCalls(client, "projects:getCombinedDetail")).toBe(detailBefore);
  });

  it("auto-refresh re-fetches project_all detail when the selected project fingerprint changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let projectMessageCount = 250;
    let lastActivity = "2026-03-01T10:00:05.000Z";
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          makeProjectSummary({
            messageCount: projectMessageCount,
            lastActivity,
          }),
        ],
      }),
      "projects:getCombinedDetail": () => ({
        projectId: "project_1",
        totalCount: projectMessageCount,
        categoryCounts: {
          user: projectMessageCount,
          assistant: 0,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page: 0,
        pageSize: 100,
        focusIndex: null,
        messages: [],
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
      expect(countChannelCalls(client, "projects:getCombinedDetail")).toBeGreaterThan(0);
    });

    const detailBefore = countChannelCalls(client, "projects:getCombinedDetail");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));
    projectMessageCount = 300;
    lastActivity = "2026-03-01T10:00:06.000Z";

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "projects:getCombinedDetail")).toBeGreaterThan(detailBefore);
    });
  });

  it("auto-refresh reloads search only when Search is visible with an active query", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "search:query")).toBeGreaterThan(0);
    });

    const searchBefore = countChannelCalls(client, "search:query");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "search:query")).toBeGreaterThan(searchBefore);
    });
  });

  it("refreshes expanded tree sessions during auto-refresh only when tree rows are loaded", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          makeProjectSummary(),
          {
            ...makeProjectSummary({
              id: "project_2",
              provider: "codex",
              name: "Project Two",
              path: "/workspace/project-two",
              lastActivity: "2026-03-01T10:01:05.000Z",
            }),
          },
        ],
      }),
      "sessions:list": (request) => ({
        sessions: [
          request.projectId === "project_2"
            ? makeSessionSummary({
                id: "session_2",
                projectId: "project_2",
                provider: "codex",
                filePath: "/workspace/project-two/session-2.jsonl",
                title: "Investigate tree refresh failure",
                cwd: "/workspace/project-two",
              })
            : makeSessionSummary(),
        ],
      }),
      "sessions:listMany": () => ({
        sessionsByProjectId: {
          project_2: [
            makeSessionSummary({
              id: "session_2",
              projectId: "project_2",
              provider: "codex",
              filePath: "/workspace/project-two/session-2.jsonl",
              title: "Investigate tree refresh failure",
              cwd: "/workspace/project-two",
            }),
          ],
        },
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project Two/i })).toBeInTheDocument();
    });

    const projectTwoCallsBeforeExpand = getChannelCalls(client, "sessions:list").filter(
      ([, payload]) => String(payload.projectId ?? "") === "project_2",
    ).length;
    expect(projectTwoCallsBeforeExpand).toBe(0);

    const expandProjectTwoButton = document.querySelector<HTMLButtonElement>(
      '[data-project-expand-toggle-for="project_2"]',
    );
    expect(expandProjectTwoButton).not.toBeNull();
    if (!expandProjectTwoButton) {
      throw new Error("Expected project-two expand toggle");
    }

    await user.click(expandProjectTwoButton);

    await waitFor(() => {
      expect(
        document.querySelector('.project-tree-session-row[data-session-id="session_2"]'),
      ).not.toBeNull();
    });

    const treeRefreshCallsBeforeTick = countChannelCalls(client, "sessions:listMany");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "sessions:listMany")).toBeGreaterThan(
        treeRefreshCallsBeforeTick,
      );
    });
  });

  it("manual refresh keeps the broad reload path", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "search:query")).toBeGreaterThan(0);
    });

    const indexerBefore = countChannelCalls(client, "indexer:refresh");
    const projectsBefore = countChannelCalls(client, "projects:list");
    const sessionsBefore = countChannelCalls(client, "sessions:list");
    const sessionDetailBefore = countChannelCalls(client, "sessions:getDetail");
    const searchBefore = countChannelCalls(client, "search:query");

    await user.click(screen.getByRole("button", { name: "Incremental refresh" }));

    await waitFor(() => {
      expect(countChannelCalls(client, "indexer:refresh")).toBeGreaterThan(indexerBefore);
      expect(countChannelCalls(client, "projects:list")).toBeGreaterThan(projectsBefore);
      expect(countChannelCalls(client, "sessions:list")).toBeGreaterThan(sessionsBefore);
      expect(countChannelCalls(client, "sessions:getDetail")).toBeGreaterThan(sessionDetailBefore);
      expect(countChannelCalls(client, "search:query")).toBeGreaterThan(searchBefore);
    });
  });

  it("keeps auto-refresh running when tree session refresh fails for one project", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let failTreeSessionRefresh = false;
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
          {
            id: "project_2",
            provider: "codex",
            name: "Project Two",
            path: "/workspace/project-two",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T10:01:05.000Z",
          },
        ],
      }),
      "sessions:list": (request) => {
        if (request.projectId === "project_2" && failTreeSessionRefresh) {
          throw new Error("tree refresh failed");
        }
        return {
          sessions: [
            {
              id: request.projectId === "project_2" ? "session_2" : "session_1",
              projectId: String(request.projectId ?? "project_1"),
              provider: request.projectId === "project_2" ? "codex" : "claude",
              filePath:
                request.projectId === "project_2"
                  ? "/workspace/project-two/session-2.jsonl"
                  : "/workspace/project-one/session-1.jsonl",
              title:
                request.projectId === "project_2"
                  ? "Investigate tree refresh failure"
                  : "Investigate markdown rendering",
              modelNames: "claude-opus-4-1",
              startedAt: "2026-03-01T10:00:00.000Z",
              endedAt: "2026-03-01T10:00:05.000Z",
              durationMs: 5000,
              gitBranch: "main",
              cwd: "/workspace/project-one",
              messageCount: 2,
              bookmarkCount: 0,
              tokenInputTotal: 14,
              tokenOutputTotal: 8,
            },
          ],
        };
      },
      "sessions:listMany": () => {
        if (failTreeSessionRefresh) {
          throw new Error("tree refresh failed");
        }
        return {
          sessionsByProjectId: {
            project_2: [
              {
                ...makeSessionSummary({
                  id: "session_2",
                  projectId: "project_2",
                  provider: "codex",
                  filePath: "/workspace/project-two/session-2.jsonl",
                  title: "Investigate tree refresh failure",
                  cwd: "/workspace/project-two",
                }),
              },
            ],
          },
        };
      },
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project Two/i })).toBeInTheDocument();
    });

    const expandProjectTwoButton = document.querySelector<HTMLButtonElement>(
      '[data-project-expand-toggle-for="project_2"]',
    );
    expect(expandProjectTwoButton).not.toBeNull();
    if (!expandProjectTwoButton) {
      throw new Error("Expected project-two expand toggle");
    }

    await user.click(expandProjectTwoButton);

    await waitFor(() => {
      expect(
        document.querySelector('.project-tree-session-row[data-session-id="session_2"]'),
      ).not.toBeNull();
    });

    failTreeSessionRefresh = true;

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    const refreshCallsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsBefore);
    });

    const refreshCallsAfterFirst = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsAfterFirst);
    });
  });
});
