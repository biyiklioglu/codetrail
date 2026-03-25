import type {
  BookmarkListResponse,
  HistorySelection,
  ProjectSummary,
  SessionDetail,
  SessionSummary,
  SortDirection,
} from "../app/types";

export const REFRESH_EDGE_THRESHOLD_PX = 10;

export function getHistoryRefreshScopeKey(
  historyMode: HistorySelection["mode"],
  selectedProjectId: string,
  selectedSessionId: string,
): string {
  if (historyMode === "session") {
    return `session:${selectedSessionId}`;
  }
  if (historyMode === "project_all") {
    return `project_all:${selectedProjectId}`;
  }
  return `bookmarks:${selectedProjectId}`;
}

export function isPinnedToVisualRefreshEdge(args: {
  sortDirection: SortDirection;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  threshold?: number;
}): boolean {
  const {
    sortDirection,
    scrollTop,
    clientHeight,
    scrollHeight,
    threshold = REFRESH_EDGE_THRESHOLD_PX,
  } = args;
  if (sortDirection === "asc") {
    return scrollTop + clientHeight >= scrollHeight - threshold;
  }
  return scrollTop <= threshold;
}

export function getLiveEdgePage(args: {
  sortDirection: SortDirection;
  totalCount: number;
  pageSize: number;
}): number {
  const { sortDirection, totalCount, pageSize } = args;
  if (sortDirection === "desc") {
    return 0;
  }
  return Math.max(0, Math.ceil(totalCount / pageSize) - 1);
}

export function isLiveEdgePage(args: {
  sortDirection: SortDirection;
  page: number;
  totalCount: number;
  pageSize: number;
}): boolean {
  return (
    args.page ===
    getLiveEdgePage({
      sortDirection: args.sortDirection,
      totalCount: args.totalCount,
      pageSize: args.pageSize,
    })
  );
}

export function getRefreshBaselineTotalCount(args: {
  historyMode: HistorySelection["mode"];
  selectedProject: ProjectSummary | null;
  selectedSession: SessionSummary | null;
  sessionDetail: SessionDetail | null;
  projectCombinedDetailTotalCount: number | null | undefined;
  bookmarksResponse: BookmarkListResponse;
}): number {
  const {
    historyMode,
    selectedProject,
    selectedSession,
    sessionDetail,
    projectCombinedDetailTotalCount,
    bookmarksResponse,
  } = args;
  if (historyMode === "session") {
    return sessionDetail?.totalCount ?? selectedSession?.messageCount ?? 0;
  }
  if (historyMode === "project_all") {
    return projectCombinedDetailTotalCount ?? selectedProject?.messageCount ?? 0;
  }
  return bookmarksResponse.filteredCount;
}

export function getSessionRefreshFingerprint(session: SessionSummary | null | undefined): string {
  return [
    session?.messageCount ?? 0,
    session?.bookmarkCount ?? 0,
    session?.endedAt ?? "",
    session?.tokenInputTotal ?? 0,
    session?.tokenOutputTotal ?? 0,
  ].join("\u0000");
}

export function getProjectRefreshFingerprint(project: ProjectSummary | null | undefined): string {
  return [
    project?.messageCount ?? 0,
    project?.bookmarkCount ?? 0,
    project?.lastActivity ?? "",
  ].join("\u0000");
}
