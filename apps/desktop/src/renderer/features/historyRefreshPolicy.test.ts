import { describe, expect, it } from "vitest";

import {
  getHistoryRefreshScopeKey,
  getLiveEdgePage,
  getProjectRefreshFingerprint,
  getRefreshBaselineTotalCount,
  getSessionRefreshFingerprint,
  isLiveEdgePage,
  isPinnedToVisualRefreshEdge,
} from "./historyRefreshPolicy";

describe("historyRefreshPolicy", () => {
  it("builds selected-scope keys from history mode", () => {
    expect(getHistoryRefreshScopeKey("session", "project_1", "session_1")).toBe(
      "session:session_1",
    );
    expect(getHistoryRefreshScopeKey("project_all", "project_1", "session_1")).toBe(
      "project_all:project_1",
    );
    expect(getHistoryRefreshScopeKey("bookmarks", "project_1", "session_1")).toBe(
      "bookmarks:project_1",
    );
  });

  it("computes live-edge pages for asc and desc sorts", () => {
    expect(getLiveEdgePage({ sortDirection: "desc", totalCount: 450, pageSize: 100 })).toBe(0);
    expect(getLiveEdgePage({ sortDirection: "asc", totalCount: 450, pageSize: 100 })).toBe(4);
    expect(isLiveEdgePage({ sortDirection: "desc", page: 0, totalCount: 450, pageSize: 100 })).toBe(
      true,
    );
    expect(isLiveEdgePage({ sortDirection: "desc", page: 1, totalCount: 450, pageSize: 100 })).toBe(
      false,
    );
    expect(isLiveEdgePage({ sortDirection: "asc", page: 4, totalCount: 450, pageSize: 100 })).toBe(
      true,
    );
    expect(isLiveEdgePage({ sortDirection: "asc", page: 3, totalCount: 450, pageSize: 100 })).toBe(
      false,
    );
  });

  it("detects visual refresh edges for asc and desc sorts", () => {
    expect(
      isPinnedToVisualRefreshEdge({
        sortDirection: "asc",
        scrollTop: 190,
        clientHeight: 100,
        scrollHeight: 300,
      }),
    ).toBe(true);
    expect(
      isPinnedToVisualRefreshEdge({
        sortDirection: "asc",
        scrollTop: 189,
        clientHeight: 100,
        scrollHeight: 300,
      }),
    ).toBe(false);
    expect(
      isPinnedToVisualRefreshEdge({
        sortDirection: "desc",
        scrollTop: 10,
        clientHeight: 100,
        scrollHeight: 300,
      }),
    ).toBe(true);
    expect(
      isPinnedToVisualRefreshEdge({
        sortDirection: "desc",
        scrollTop: 11,
        clientHeight: 100,
        scrollHeight: 300,
      }),
    ).toBe(false);
  });

  it("treats fully visible lists as pinned to the visual edge", () => {
    expect(
      isPinnedToVisualRefreshEdge({
        sortDirection: "asc",
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 100,
      }),
    ).toBe(true);
    expect(
      isPinnedToVisualRefreshEdge({
        sortDirection: "desc",
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 100,
      }),
    ).toBe(true);
  });

  it("derives baseline totals from the visible scope", () => {
    expect(
      getRefreshBaselineTotalCount({
        historyMode: "session",
        selectedProject: null,
        selectedSession: { messageCount: 12 } as never,
        sessionDetail: null,
        projectCombinedDetailTotalCount: null,
        bookmarksResponse: { filteredCount: 5 } as never,
      }),
    ).toBe(12);

    expect(
      getRefreshBaselineTotalCount({
        historyMode: "project_all",
        selectedProject: { messageCount: 44 } as never,
        selectedSession: null,
        sessionDetail: null,
        projectCombinedDetailTotalCount: 55,
        bookmarksResponse: { filteredCount: 5 } as never,
      }),
    ).toBe(55);

    expect(
      getRefreshBaselineTotalCount({
        historyMode: "bookmarks",
        selectedProject: null,
        selectedSession: null,
        sessionDetail: null,
        projectCombinedDetailTotalCount: null,
        bookmarksResponse: { filteredCount: 7 } as never,
      }),
    ).toBe(7);
  });

  it("changes session and project fingerprints when summary fields change", () => {
    expect(
      getSessionRefreshFingerprint({
        messageCount: 2,
        bookmarkCount: 1,
        endedAt: "2026-03-01T10:00:05.000Z",
        tokenInputTotal: 14,
        tokenOutputTotal: 8,
      } as never),
    ).not.toBe(
      getSessionRefreshFingerprint({
        messageCount: 3,
        bookmarkCount: 1,
        endedAt: "2026-03-01T10:00:05.000Z",
        tokenInputTotal: 14,
        tokenOutputTotal: 8,
      } as never),
    );

    expect(
      getProjectRefreshFingerprint({
        messageCount: 250,
        bookmarkCount: 2,
        lastActivity: "2026-03-01T10:00:05.000Z",
      } as never),
    ).not.toBe(
      getProjectRefreshFingerprint({
        messageCount: 250,
        bookmarkCount: 2,
        lastActivity: "2026-03-01T10:00:06.000Z",
      } as never),
    );
  });
});
