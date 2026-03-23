import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { MessageCategory, Provider, SearchMode } from "@codetrail/core/browser";

import { CATEGORIES, EMPTY_BOOKMARKS_RESPONSE } from "../app/constants";
import {
  createHistorySelection,
  setHistorySelectionProjectId,
  setHistorySelectionSessionId,
} from "../app/historySelection";
import type {
  BookmarkListResponse,
  HistorySearchNavigation,
  HistorySelection,
  PendingRevealTarget,
  ProjectCombinedDetail,
  ProjectSummary,
  SessionDetail,
  SessionSummary,
  SortDirection,
} from "../app/types";
import { shouldIgnoreAsyncEffectError } from "../lib/asyncEffectUtils";
import type { CodetrailClient } from "../lib/codetrailClient";
import { collectProjectMessageDeltas } from "../lib/projectUpdates";
import { decideSessionSelectionAfterLoad } from "../lib/sessionSelection";
import type { RefreshContext } from "./useHistoryController";

// This hook owns the async side of history state: loading projects/sessions/details and reconciling
// in-flight requests with the controller's current selection.
export function useHistoryDataEffects({
  codetrail,
  logError,
  projectProviders,
  projectQuery,
  rawSelectedProjectId,
  selectedProjectId,
  selectedSessionId,
  sortedProjects,
  sortedSessions,
  pendingSearchNavigation,
  setPendingSearchNavigation,
  setHistorySelection,
  setProjects,
  projectsRef,
  setProjectListUpdateSource,
  registerAutoProjectUpdates,
  setProjectsLoaded,
  projectsLoaded,
  setSessions,
  setSessionsLoadedProjectId,
  setBookmarksResponse,
  setBookmarksLoadedProjectId,
  historyCategories,
  effectiveBookmarkQuery,
  effectiveSessionQuery,
  searchMode,
  paneStateHydrated,
  historyMode,
  setSessionPage,
  setSessionQueryInput,
  setHistoryCategories,
  setFocusMessageId,
  setPendingRevealTarget,
  pendingRevealTarget,
  messageSortDirection,
  projectAllSortDirection,
  sessionPage,
  messagePageSize,
  setSessionDetail,
  setProjectCombinedDetail,
  bookmarksLoadedProjectId,
  bookmarksResponse,
  setSessionPaneStableProjectId,
  sessionsLoadedProjectId,
  projectsLoadTokenRef,
  sessionsLoadTokenRef,
  bookmarksLoadTokenRef,
  refreshCounter,
  refreshContextRef,
}: {
  codetrail: CodetrailClient;
  logError: (context: string, error: unknown) => void;
  projectProviders: Provider[];
  projectQuery: string;
  rawSelectedProjectId: string;
  selectedProjectId: string;
  selectedSessionId: string;
  sortedProjects: ProjectSummary[];
  sortedSessions: SessionSummary[];
  pendingSearchNavigation: HistorySearchNavigation | null;
  setPendingSearchNavigation: Dispatch<SetStateAction<HistorySearchNavigation | null>>;
  setHistorySelection: Dispatch<SetStateAction<HistorySelection>>;
  setProjects: Dispatch<SetStateAction<ProjectSummary[]>>;
  projectsRef: MutableRefObject<ProjectSummary[]>;
  setProjectListUpdateSource: Dispatch<SetStateAction<"auto" | "resort">>;
  registerAutoProjectUpdates: (deltas: Record<string, number>) => void;
  setProjectsLoaded: Dispatch<SetStateAction<boolean>>;
  projectsLoaded: boolean;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setSessionsLoadedProjectId: Dispatch<SetStateAction<string | null>>;
  setBookmarksResponse: Dispatch<SetStateAction<BookmarkListResponse>>;
  setBookmarksLoadedProjectId: Dispatch<SetStateAction<string | null>>;
  historyCategories: MessageCategory[];
  effectiveBookmarkQuery: string;
  effectiveSessionQuery: string;
  searchMode: SearchMode;
  paneStateHydrated: boolean;
  historyMode: HistorySelection["mode"];
  setSessionPage: Dispatch<SetStateAction<number>>;
  setSessionQueryInput: Dispatch<SetStateAction<string>>;
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setFocusMessageId: Dispatch<SetStateAction<string>>;
  setPendingRevealTarget: Dispatch<SetStateAction<PendingRevealTarget | null>>;
  pendingRevealTarget: PendingRevealTarget | null;
  messageSortDirection: SortDirection;
  projectAllSortDirection: SortDirection;
  sessionPage: number;
  messagePageSize: number;
  setSessionDetail: Dispatch<SetStateAction<SessionDetail | null>>;
  setProjectCombinedDetail: Dispatch<SetStateAction<ProjectCombinedDetail | null>>;
  bookmarksLoadedProjectId: string | null;
  bookmarksResponse: BookmarkListResponse;
  setSessionPaneStableProjectId: Dispatch<SetStateAction<string | null>>;
  sessionsLoadedProjectId: string | null;
  projectsLoadTokenRef: MutableRefObject<number>;
  sessionsLoadTokenRef: MutableRefObject<number>;
  bookmarksLoadTokenRef: MutableRefObject<number>;
  refreshCounter: number;
  refreshContextRef: MutableRefObject<RefreshContext | null>;
}) {
  const loadProjects = useCallback(
    async (source: "auto" | "resort" = "resort") => {
      // Monotonic request tokens prevent stale async responses from overwriting newer selections.
      const requestToken = projectsLoadTokenRef.current + 1;
      projectsLoadTokenRef.current = requestToken;
      setProjectsLoaded(false);
      const response = await codetrail.invoke("projects:list", {
        providers: projectProviders,
        query: projectQuery,
      });
      if (requestToken !== projectsLoadTokenRef.current) {
        return;
      }
      setProjectListUpdateSource(source);
      if (source === "auto") {
        registerAutoProjectUpdates(
          collectProjectMessageDeltas(projectsRef.current, response.projects),
        );
      }
      setProjects(response.projects);
      setProjectsLoaded(true);
    },
    [
      codetrail,
      projectProviders,
      projectQuery,
      projectsRef,
      projectsLoadTokenRef,
      registerAutoProjectUpdates,
      setProjectListUpdateSource,
      setProjects,
      setProjectsLoaded,
    ],
  );

  const loadSessions = useCallback(async () => {
    const requestToken = sessionsLoadTokenRef.current + 1;
    sessionsLoadTokenRef.current = requestToken;
    if (!selectedProjectId) {
      setSessions([]);
      setSessionsLoadedProjectId("");
      setHistorySelection((value) =>
        value.mode === "session" ? createHistorySelection("project_all", "", "") : value,
      );
      return;
    }

    setSessionsLoadedProjectId(null);
    const response = await codetrail.invoke("sessions:list", {
      projectId: selectedProjectId,
    });
    if (requestToken !== sessionsLoadTokenRef.current) {
      return;
    }
    setSessions(response.sessions);
    setSessionsLoadedProjectId(selectedProjectId);
  }, [
    codetrail,
    selectedProjectId,
    sessionsLoadTokenRef,
    setHistorySelection,
    setSessions,
    setSessionsLoadedProjectId,
  ]);

  const loadBookmarks = useCallback(async () => {
    const requestToken = bookmarksLoadTokenRef.current + 1;
    bookmarksLoadTokenRef.current = requestToken;
    if (!selectedProjectId) {
      setBookmarksResponse(EMPTY_BOOKMARKS_RESPONSE);
      setBookmarksLoadedProjectId("");
      return;
    }
    setBookmarksLoadedProjectId(null);
    const isAllHistoryCategoriesSelected = historyCategories.length === CATEGORIES.length;
    const response = await codetrail.invoke("bookmarks:listProject", {
      projectId: selectedProjectId,
      page: sessionPage,
      pageSize: messagePageSize,
      query: effectiveBookmarkQuery,
      searchMode,
      categories: isAllHistoryCategoriesSelected ? undefined : historyCategories,
    });
    if (requestToken !== bookmarksLoadTokenRef.current) {
      return;
    }
    setBookmarksResponse(response);
    if (typeof response.page === "number" && response.page !== sessionPage) {
      setSessionPage(response.page);
    }
    setBookmarksLoadedProjectId(selectedProjectId);
  }, [
    bookmarksLoadTokenRef,
    codetrail,
    effectiveBookmarkQuery,
    historyCategories,
    messagePageSize,
    searchMode,
    sessionPage,
    selectedProjectId,
    setBookmarksLoadedProjectId,
    setBookmarksResponse,
  ]);

  const refreshInvalidationKey = useMemo(
    () =>
      [
        effectiveBookmarkQuery,
        effectiveSessionQuery,
        historyCategories.join(","),
        messageSortDirection,
        projectAllSortDirection,
        searchMode,
      ].join("\u0000"),
    [
      effectiveBookmarkQuery,
      effectiveSessionQuery,
      historyCategories,
      messageSortDirection,
      projectAllSortDirection,
      searchMode,
    ],
  );
  const previousRefreshInvalidationKeyRef = useRef(refreshInvalidationKey);

  const sessionDetailRequest = useMemo(
    () => ({
      historyMode,
      selectedSessionId,
      sessionPage,
      historyCategories,
      effectiveSessionQuery,
      searchMode,
      messageSortDirection,
      pendingRevealTarget,
      refreshCounter,
    }),
    [
      effectiveSessionQuery,
      historyCategories,
      historyMode,
      messageSortDirection,
      pendingRevealTarget,
      refreshCounter,
      searchMode,
      selectedSessionId,
      sessionPage,
    ],
  );

  const projectCombinedDetailRequest = useMemo(
    () => ({
      historyMode,
      selectedProjectId,
      sessionPage,
      historyCategories,
      effectiveSessionQuery,
      searchMode,
      projectAllSortDirection,
      pendingRevealTarget,
      refreshCounter,
    }),
    [
      effectiveSessionQuery,
      historyCategories,
      historyMode,
      pendingRevealTarget,
      projectAllSortDirection,
      refreshCounter,
      searchMode,
      selectedProjectId,
      sessionPage,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    void loadProjects().catch((error: unknown) => {
      if (!cancelled) {
        logError("Failed loading projects", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadProjects, logError]);

  useEffect(() => {
    if (!projectsLoaded) {
      return;
    }
    if (!sortedProjects.length) {
      if (!pendingSearchNavigation) {
        setHistorySelection(createHistorySelection("project_all", "", ""));
      }
      return;
    }

    if (!pendingSearchNavigation && !rawSelectedProjectId) {
      setHistorySelection((selectionState) =>
        setHistorySelectionProjectId(selectionState, sortedProjects[0]?.id ?? ""),
      );
    }
  }, [
    pendingSearchNavigation,
    projectsLoaded,
    rawSelectedProjectId,
    setHistorySelection,
    sortedProjects,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadSessions().catch((error: unknown) => {
      if (!cancelled) {
        logError("Failed loading sessions", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSessions, logError]);

  useEffect(() => {
    let cancelled = false;
    void loadBookmarks().catch((error: unknown) => {
      if (!cancelled) {
        logError("Failed loading bookmarks", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadBookmarks, logError]);

  useEffect(() => {
    const decision = decideSessionSelectionAfterLoad({
      paneStateHydrated,
      sessionsLoadedProjectId,
      selectedProjectId,
      hasPendingSearchNavigation:
        pendingSearchNavigation !== null ||
        historyMode === "bookmarks" ||
        historyMode === "project_all",
      selectedSessionId,
      sortedSessions,
    });
    if (!decision) {
      return;
    }

    setHistorySelection((selectionState) =>
      setHistorySelectionSessionId(selectionState, decision.nextSelectedSessionId),
    );
    if (decision.resetPage) {
      setSessionPage(0);
    }
  }, [
    historyMode,
    paneStateHydrated,
    pendingSearchNavigation,
    selectedProjectId,
    selectedSessionId,
    sessionsLoadedProjectId,
    setHistorySelection,
    setSessionPage,
    sortedSessions,
  ]);

  useEffect(() => {
    if (!pendingSearchNavigation) {
      return;
    }

    // Search navigation is a two-step handshake: first move to the right project, then once that
    // project's sessions are loaded, reveal the specific session/message target.
    if (pendingSearchNavigation.projectId !== selectedProjectId) {
      setHistorySelection((selectionState) =>
        setHistorySelectionProjectId(selectionState, pendingSearchNavigation.projectId),
      );
      return;
    }

    if (!sortedSessions.some((session) => session.id === pendingSearchNavigation.sessionId)) {
      return;
    }

    setHistorySelection({
      mode: "session",
      projectId: pendingSearchNavigation.projectId,
      sessionId: pendingSearchNavigation.sessionId,
    });
    setSessionQueryInput("");
    setHistoryCategories([...pendingSearchNavigation.historyCategories]);
    setSessionPage(0);
    setFocusMessageId(pendingSearchNavigation.messageId);
    setPendingRevealTarget({
      sourceId: pendingSearchNavigation.sourceId,
      messageId: pendingSearchNavigation.messageId,
    });
    setPendingSearchNavigation(null);
  }, [
    pendingSearchNavigation,
    selectedProjectId,
    setFocusMessageId,
    setHistoryCategories,
    setHistorySelection,
    setPendingRevealTarget,
    setPendingSearchNavigation,
    setSessionPage,
    setSessionQueryInput,
    sortedSessions,
  ]);

  useEffect(() => {
    if (historyMode !== "bookmarks" || bookmarksLoadedProjectId !== selectedProjectId) {
      return;
    }
    if (bookmarksResponse.totalCount > 0) {
      return;
    }
    setHistorySelection((selectionState) =>
      createHistorySelection("project_all", selectionState.projectId),
    );
  }, [
    bookmarksLoadedProjectId,
    bookmarksResponse.totalCount,
    historyMode,
    selectedProjectId,
    setHistorySelection,
  ]);

  // Invalidate stale refresh context when user-driven state changes (sort direction, category
  // filters, search query/mode) would cause data effects to re-fire. These deps are disjoint from
  // refreshCounter, so this effect only fires for user actions, never for refresh ticks. React runs
  // effects in declaration order, so this clears the ref before the detail effects read it.
  // Note: bookmarkSortDirection is not included because it only affects in-memory sorting in
  // useHistoryDerivedState, never triggering a server fetch or consuming refreshContextRef.
  useEffect(() => {
    if (previousRefreshInvalidationKeyRef.current === refreshInvalidationKey) {
      return;
    }
    previousRefreshInvalidationKeyRef.current = refreshInvalidationKey;
    refreshContextRef.current = null;
  }, [refreshContextRef, refreshInvalidationKey]);

  useEffect(() => {
    if (sessionDetailRequest.historyMode !== "session" || !sessionDetailRequest.selectedSessionId) {
      setSessionDetail(null);
      return;
    }

    let cancelled = false;
    const isRevealing = sessionDetailRequest.pendingRevealTarget !== null;
    const isAllHistoryCategoriesSelected =
      sessionDetailRequest.historyCategories.length === CATEGORIES.length;
    const effectiveCategories = isAllHistoryCategoriesSelected
      ? undefined
      : sessionDetailRequest.historyCategories;
    // When revealing a specific message from bookmarks/search, temporarily ignore the free-text
    // query so pagination can land on the target even if it would otherwise be filtered out.
    const effectiveQuery = isRevealing ? "" : sessionDetailRequest.effectiveSessionQuery;

    // Capture refresh context at effect start for race protection.
    const refreshCtx = refreshContextRef.current;
    const isRefresh = refreshCtx !== null && !isRevealing;

    void codetrail
      .invoke("sessions:getDetail", {
        sessionId: sessionDetailRequest.selectedSessionId,
        page: sessionDetailRequest.sessionPage,
        pageSize: messagePageSize,
        categories: effectiveCategories,
        query: effectiveQuery,
        searchMode: sessionDetailRequest.searchMode,
        sortDirection: sessionDetailRequest.messageSortDirection,
        focusMessageId: sessionDetailRequest.pendingRevealTarget?.messageId || undefined,
        focusSourceId: sessionDetailRequest.pendingRevealTarget?.sourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        // Race protection: if a newer refresh started or user navigated, discard.
        if (isRefresh && refreshContextRef.current?.refreshId !== refreshCtx.refreshId) {
          return;
        }
        setSessionDetail(response);
        if (sessionDetailRequest.pendingRevealTarget !== null) {
          setPendingRevealTarget(null);
        }
        if (isRefresh && refreshCtx.autoScroll) {
          // Auto-scroll: navigate to the page with newest messages.
          // ASC → newest on last page; DESC → newest on page 0.
          const latestPage =
            sessionDetailRequest.messageSortDirection === "desc"
              ? 0
              : Math.max(0, Math.ceil(response.totalCount / messagePageSize) - 1);
          if (sessionDetailRequest.sessionPage !== latestPage) {
            setSessionPage(latestPage);
            return;
          }
        }
        if (response.page !== sessionDetailRequest.sessionPage) {
          setSessionPage(response.page);
        }
      })
      .catch((error: unknown) => {
        if (!shouldIgnoreAsyncEffectError(cancelled, error)) {
          logError("Failed loading session detail", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    codetrail,
    logError,
    messagePageSize,
    refreshContextRef,
    sessionDetailRequest,
    setPendingRevealTarget,
    setSessionDetail,
    setSessionPage,
  ]);

  useEffect(() => {
    if (
      projectCombinedDetailRequest.historyMode !== "project_all" ||
      !projectCombinedDetailRequest.selectedProjectId
    ) {
      setProjectCombinedDetail(null);
      return;
    }

    let cancelled = false;
    const isRevealing = projectCombinedDetailRequest.pendingRevealTarget !== null;
    const isAllHistoryCategoriesSelected =
      projectCombinedDetailRequest.historyCategories.length === CATEGORIES.length;
    const effectiveCategories = isAllHistoryCategoriesSelected
      ? undefined
      : projectCombinedDetailRequest.historyCategories;
    const effectiveQuery = isRevealing ? "" : projectCombinedDetailRequest.effectiveSessionQuery;

    const refreshCtx = refreshContextRef.current;
    const isRefresh = refreshCtx !== null && !isRevealing;

    void codetrail
      .invoke("projects:getCombinedDetail", {
        projectId: projectCombinedDetailRequest.selectedProjectId,
        page: projectCombinedDetailRequest.sessionPage,
        pageSize: messagePageSize,
        categories: effectiveCategories,
        query: effectiveQuery,
        searchMode: projectCombinedDetailRequest.searchMode,
        sortDirection: projectCombinedDetailRequest.projectAllSortDirection,
        focusMessageId: projectCombinedDetailRequest.pendingRevealTarget?.messageId || undefined,
        focusSourceId: projectCombinedDetailRequest.pendingRevealTarget?.sourceId || undefined,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (isRefresh && refreshContextRef.current?.refreshId !== refreshCtx.refreshId) {
          return;
        }
        setProjectCombinedDetail(response);
        if (projectCombinedDetailRequest.pendingRevealTarget !== null) {
          setPendingRevealTarget(null);
        }
        if (isRefresh && refreshCtx.autoScroll) {
          const latestPage =
            projectCombinedDetailRequest.projectAllSortDirection === "desc"
              ? 0
              : Math.max(0, Math.ceil(response.totalCount / messagePageSize) - 1);
          if (projectCombinedDetailRequest.sessionPage !== latestPage) {
            setSessionPage(latestPage);
            return;
          }
        }
        if (response.page !== projectCombinedDetailRequest.sessionPage) {
          setSessionPage(response.page);
        }
      })
      .catch((error: unknown) => {
        if (!shouldIgnoreAsyncEffectError(cancelled, error)) {
          logError("Failed loading project combined detail", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    codetrail,
    logError,
    messagePageSize,
    projectCombinedDetailRequest,
    refreshContextRef,
    setPendingRevealTarget,
    setProjectCombinedDetail,
    setSessionPage,
  ]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSessionPaneStableProjectId(null);
      return;
    }
    // The session pane should not flip to a new project until both sessions and bookmarks for that
    // project are loaded, otherwise the pane briefly renders mismatched content.
    if (
      sessionsLoadedProjectId === selectedProjectId &&
      bookmarksLoadedProjectId === selectedProjectId
    ) {
      setSessionPaneStableProjectId((value) =>
        value === selectedProjectId ? value : selectedProjectId,
      );
    }
  }, [
    bookmarksLoadedProjectId,
    selectedProjectId,
    sessionsLoadedProjectId,
    setSessionPaneStableProjectId,
  ]);

  return {
    loadProjects,
    loadSessions,
    loadBookmarks,
  };
}
