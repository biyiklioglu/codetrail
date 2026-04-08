import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type {
  IpcRequestInput,
  MessageCategory,
  Provider,
  SearchMode,
  SystemMessageRegexRules,
} from "@codetrail/core/browser";

import type { HistoryExportPhase, HistoryExportProgressPayload } from "../../shared/historyExport";
import {
  DEFAULT_PREFERRED_REFRESH_STRATEGY,
  type NonOffRefreshStrategy,
  isWatchRefreshStrategy,
} from "../app/autoRefresh";
import {
  CATEGORIES,
  DEFAULT_MESSAGE_CATEGORIES,
  DEFAULT_TURN_VIEW_EXPANDED_CATEGORIES,
  DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES,
  EMPTY_BOOKMARKS_RESPONSE,
  EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
  MESSAGE_ID_BATCH_SIZE,
} from "../app/constants";
import {
  createHistorySelection,
  setHistorySelectionProjectId,
  setHistorySelectionSessionId,
} from "../app/historySelection";
import type {
  BookmarkListResponse,
  HistoryExportScope,
  HistoryMessage,
  HistorySearchNavigation,
  HistorySelection,
  HistorySelectionCommitMode,
  HistoryVisualization,
  PaneStateSnapshot,
  PendingMessagePageNavigation,
  PendingRevealTarget,
  ProjectCombinedDetail,
  ProjectSortField,
  ProjectSummary,
  ProjectViewMode,
  SessionDetail,
  SessionSummary,
  SessionTurnDetail,
  SortDirection,
  TreeAutoRevealSessionRequest,
} from "../app/types";
import { useProjectPaneTreeState } from "../components/history/useProjectPaneTreeState";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePaneStateSync } from "../hooks/usePaneStateSync";
import { useReconcileProviderSelection } from "../hooks/useReconcileProviderSelection";
import { useResizablePanes } from "../hooks/useResizablePanes";
import { shouldIgnoreAsyncEffectError } from "../lib/asyncEffectUtils";
import { useCodetrailClient } from "../lib/codetrailClient";
import type { HistoryPaneId } from "../lib/paneFocusController";
import {
  type StableListUpdateSource,
  mergeStableOrder,
  reorderItemsByStableOrder,
  resolveStableRefreshSource,
} from "../lib/projectUpdates";
import { clamp, compareRecent, sessionActivityOf } from "../lib/viewUtils";
import { type AppearanceState, getMessageListFingerprint } from "./historyControllerShared";
import {
  getHistoryRefreshScopeKey,
  getProjectRefreshFingerprint,
  getRefreshBaselineTotalCount,
  getSessionRefreshFingerprint,
  isLiveEdgePage,
  isPinnedToVisualRefreshEdge,
} from "./historyRefreshPolicy";
import {
  type VisibleExpansionAction,
  deriveVisibleExpansionAction,
  getNextVisibleExpansionAction,
} from "./historyVisibleExpansion";
import {
  deriveHistoryVisualization,
  getHistoryDetailModeForVisualization,
  getTurnVisualizationSelection,
} from "./historyVisualization";
import { buildTurnCategoryCounts, buildTurnVisibleMessages } from "./turnViewModel";
import { useHistoryDataEffects } from "./useHistoryDataEffects";
import { useHistoryDerivedState } from "./useHistoryDerivedState";
import { useHistoryInteractions } from "./useHistoryInteractions";
import {
  type HistorySelectionDebounceOverrides,
  useHistorySelectionState,
} from "./useHistorySelectionState";
import { useHistoryViewportEffects } from "./useHistoryViewportEffects";

const TURN_PRIMARY_HISTORY_CATEGORIES: readonly MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
];

export type { HistorySelectionDebounceOverrides } from "./useHistorySelectionState";

export type RefreshContext = {
  refreshId: number;
  originPage: number;
  scopeKey: string;
  baselineTotalCount: number;
  followEligible: boolean;
  scrollPreservation: {
    scrollTop: number;
    referenceMessageId: string;
    referenceOffsetTop: number;
  } | null;
  prevMessageIds: string;
};

export type HistoryExportState = {
  open: boolean;
  exportId: string | null;
  scope: HistoryExportScope;
  percent: number;
  phase: HistoryExportPhase;
  message: string;
};

function clearAutoRevealSessionRequest(
  setAutoRevealSessionRequest: Dispatch<SetStateAction<TreeAutoRevealSessionRequest | null>>,
) {
  setAutoRevealSessionRequest(null);
}

type ProjectUpdateState = {
  messageDelta: number;
  updatedAt: number;
};

const MESSAGE_PAGE_SCROLL_OVERLAP_PX = 20;
const PROJECT_UPDATE_HIGHLIGHT_MS = 8_000;
const PROJECT_NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function getProjectSortLabel(project: ProjectSummary): string {
  return project.name.trim() || project.path.trim() || project.id;
}

function compareProjectName(left: ProjectSummary, right: ProjectSummary): number {
  return PROJECT_NAME_COLLATOR.compare(getProjectSortLabel(left), getProjectSortLabel(right));
}

function compareProjectsByField(
  left: ProjectSummary,
  right: ProjectSummary,
  sortField: ProjectSortField,
): number {
  if (sortField === "name") {
    return (
      compareProjectName(left, right) ||
      compareRecent(left.lastActivity, right.lastActivity) ||
      left.id.localeCompare(right.id)
    );
  }

  return (
    compareRecent(left.lastActivity, right.lastActivity) ||
    compareProjectName(left, right) ||
    left.id.localeCompare(right.id)
  );
}

function areHistorySelectionsEqual(left: HistorySelection, right: HistorySelection): boolean {
  if (left.mode !== right.mode || left.projectId !== right.projectId) {
    return false;
  }
  if (left.mode === "session") {
    return right.mode === "session" && left.sessionId === right.sessionId;
  }
  if (left.mode === "bookmarks") {
    return right.mode === "bookmarks" && (left.sessionId ?? "") === (right.sessionId ?? "");
  }
  return true;
}

function getTurnScopeKey(selection: HistorySelection): string {
  return `${selection.mode}:${selection.projectId}:${"sessionId" in selection ? (selection.sessionId ?? "") : ""}`;
}

function sortSessionSummaries(
  sessions: SessionSummary[],
  sortDirection: SortDirection,
): SessionSummary[] {
  const next = [...sessions];
  next.sort((left, right) => {
    const byRecent =
      compareRecent(sessionActivityOf(left), sessionActivityOf(right)) ||
      left.messageCount - right.messageCount ||
      left.id.localeCompare(right.id);
    return sortDirection === "asc" ? byRecent : -byRecent;
  });
  return next;
}

function areStableOrderMapsEqual(
  current: Record<string, string[]>,
  next: Record<string, string[]>,
): boolean {
  const currentProjectIds = Object.keys(current);
  const nextProjectIds = Object.keys(next);
  if (currentProjectIds.length !== nextProjectIds.length) {
    return false;
  }

  return nextProjectIds.every((projectId) => {
    const currentIds = current[projectId];
    const nextIds = next[projectId] ?? [];
    return (
      currentIds !== undefined &&
      currentIds.length === nextIds.length &&
      currentIds.every((id, index) => id === nextIds[index])
    );
  });
}

function getVisibleMessageAnchor(container: HTMLElement): {
  referenceMessageId: string;
  referenceOffsetTop: number;
} | null {
  const rect = container.getBoundingClientRect();
  const probeX = rect.left + Math.min(24, Math.max(1, rect.width / 2));
  const probeY = rect.top + Math.min(24, Math.max(1, rect.height / 4));
  const elementAtPoint =
    typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(probeX, probeY)
      : null;
  const anchor =
    elementAtPoint instanceof HTMLElement
      ? elementAtPoint.closest<HTMLElement>("[data-history-message-id]")
      : null;
  if (anchor && container.contains(anchor)) {
    return {
      referenceMessageId: anchor.getAttribute("data-history-message-id") ?? "",
      referenceOffsetTop: anchor.offsetTop,
    };
  }

  const firstMessage = container.querySelector<HTMLElement>("[data-history-message-id]");
  if (!firstMessage) {
    return null;
  }
  return {
    referenceMessageId: firstMessage.getAttribute("data-history-message-id") ?? "",
    referenceOffsetTop: firstMessage.offsetTop,
  };
}

// ── Periodic-refresh scroll policy ──────────────────────────────────────────
//
// There is no manual auto-scroll toggle. Instead, auto-follow is detected
// automatically based on scroll position and pagination state at refresh time:
//
//   Visual edge:
//     ASC sort → bottom (within threshold)
//     DESC sort → top (within threshold)
//
//   Live-edge page:
//     ASC sort → last page
//     DESC sort → page 0
//
// Auto-follow is only eligible when the selected scope is both visually pinned
// and already on its live-edge page. Visual top/bottom alone is not enough.
// Unrelated project updates may refresh badges and ordering, but they must not
// move the current page.
//
// Follow-eligible refresh with growth in the selected scope:
//   Navigate to the page containing the newest messages (last page for ASC,
//   page 0 for DESC) and scroll to the corresponding edge. If message IDs
//   haven't changed since the previous tick, skip the scroll entirely.
//
// Any other refresh:
//   Re-fetch the *same* sessionPage number. Drift compensation keeps the
//   viewport pixel-stable via an anchor element. If the page goes out of
//   range the server clamps to the last valid page.
//
// Race protection:
//   refreshContextRef carries a monotonic refreshId. If a newer refresh
//   starts, or the user navigates (clearing the ref), stale responses are
//   discarded. A separate clearing-effect invalidates the ref when user-
//   driven deps (sort, filter, query) change.
// ────────────────────────────────────────────────────────────────────────────

// useHistoryController is the stateful coordinator for the history UI. It owns selection, pane
// layout, persisted UI state, data loading hooks, and keyboard/navigation wiring.
export function useHistoryController({
  initialPaneState,
  isHistoryLayout,
  searchMode,
  enabledProviders,
  setEnabledProviders,
  searchProviders,
  setSearchProviders,
  appearance,
  logError,
  testHistorySelectionDebounceOverrides = null,
  focusHistoryPane,
}: {
  initialPaneState?: PaneStateSnapshot | null;
  isHistoryLayout: boolean;
  searchMode: SearchMode;
  enabledProviders: Provider[];
  setEnabledProviders: Dispatch<SetStateAction<Provider[]>>;
  searchProviders: Provider[];
  setSearchProviders: Dispatch<SetStateAction<Provider[]>>;
  appearance: AppearanceState;
  logError: (context: string, error: unknown) => void;
  testHistorySelectionDebounceOverrides?: HistorySelectionDebounceOverrides | null;
  focusHistoryPane: (pane: HistoryPaneId, options?: { preventScroll?: boolean }) => void;
}) {
  const codetrail = useCodetrailClient();
  const initialProjectPaneWidth = clamp(initialPaneState?.projectPaneWidth ?? 300, 230, 520);
  const initialSessionPaneWidth = clamp(initialPaneState?.sessionPaneWidth ?? 320, 250, 620);
  const initialSessionScrollTop = initialPaneState?.sessionScrollTop ?? 0;

  const [projectQueryInput, setProjectQueryInput] = useState("");
  const [
    removeMissingSessionsDuringIncrementalIndexing,
    setRemoveMissingSessionsDuringIncrementalIndexing,
  ] = useState(initialPaneState?.removeMissingSessionsDuringIncrementalIndexing ?? false);
  const [projectProviders, setProjectProviders] = useState<Provider[]>(
    (initialPaneState?.projectProviders ?? enabledProviders).filter((provider) =>
      enabledProviders.includes(provider),
    ),
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectListUpdateSource, setProjectListUpdateSource] =
    useState<StableListUpdateSource>("resort");
  const [projectOrderIds, setProjectOrderIds] = useState<string[]>([]);
  const [projectUpdates, setProjectUpdates] = useState<Record<string, ProjectUpdateState>>({});
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionListUpdateSource, setSessionListUpdateSource] =
    useState<StableListUpdateSource>("resort");
  const [sessionOrderIds, setSessionOrderIds] = useState<string[]>([]);
  const [treeProjectSessionsByProjectId, setTreeProjectSessionsByProjectId] = useState<
    Record<string, SessionSummary[]>
  >({});
  const [
    treeProjectSessionsUpdateSourceByProjectId,
    setTreeProjectSessionsUpdateSourceByProjectId,
  ] = useState<Record<string, StableListUpdateSource>>({});
  const [treeProjectSessionOrderIdsByProjectId, setTreeProjectSessionOrderIdsByProjectId] =
    useState<Record<string, string[]>>({});
  const [treeProjectSessionsLoadingByProjectId, setTreeProjectSessionsLoadingByProjectId] =
    useState<Record<string, boolean>>({});
  const [sessionsLoadedProjectId, setSessionsLoadedProjectId] = useState<string | null>(null);
  const [bookmarksLoadedProjectId, setBookmarksLoadedProjectId] = useState<string | null>(null);
  const [sessionPaneStableProjectId, setSessionPaneStableProjectId] = useState<string | null>(
    initialPaneState?.selectedProjectId ?? null,
  );
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [projectCombinedDetail, setProjectCombinedDetail] = useState<ProjectCombinedDetail | null>(
    null,
  );
  const [bookmarksResponse, setBookmarksResponse] =
    useState<BookmarkListResponse>(EMPTY_BOOKMARKS_RESPONSE);
  const [visibleBookmarkedMessageIds, setVisibleBookmarkedMessageIds] = useState<string[]>([]);
  const [bookmarkStatesRefreshNonce, setBookmarkStatesRefreshNonce] = useState(0);
  const [sessionPage, setSessionPage] = useState(initialPaneState?.sessionPage ?? 0);
  const [sessionScrollTop, setSessionScrollTop] = useState(initialSessionScrollTop);
  const [systemMessageRegexRules, setSystemMessageRegexRules] = useState<SystemMessageRegexRules>(
    initialPaneState?.systemMessageRegexRules
      ? { ...EMPTY_SYSTEM_MESSAGE_REGEX_RULES, ...initialPaneState.systemMessageRegexRules }
      : EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
  );
  const [projectViewMode, setProjectViewMode] = useState<ProjectViewMode>(
    initialPaneState?.projectViewMode ?? "tree",
  );
  const [projectSortField, setProjectSortField] = useState<ProjectSortField>(
    initialPaneState?.projectSortField ?? "last_active",
  );
  const [projectSortDirection, setProjectSortDirection] = useState<SortDirection>(
    initialPaneState?.projectSortDirection ?? "desc",
  );
  const [sessionSortDirection, setSessionSortDirection] = useState<SortDirection>(
    initialPaneState?.sessionSortDirection ?? "desc",
  );
  const [messageSortDirection, setMessageSortDirection] = useState<SortDirection>(
    initialPaneState?.messageSortDirection ?? "desc",
  );
  const [bookmarkSortDirection, setBookmarkSortDirection] = useState<SortDirection>(
    initialPaneState?.bookmarkSortDirection ?? "desc",
  );
  const [projectAllSortDirection, setProjectAllSortDirection] = useState<SortDirection>(
    initialPaneState?.projectAllSortDirection ?? "desc",
  );
  const [turnViewSortDirection, setTurnViewSortDirection] = useState<SortDirection>(
    initialPaneState?.turnViewSortDirection ?? initialPaneState?.messageSortDirection ?? "desc",
  );
  const [sessionQueryInput, setSessionQueryInput] = useState("");
  const [bookmarkQueryInput, setBookmarkQueryInput] = useState("");
  const [turnQueryInput, setTurnQueryInput] = useState("");
  const [preferredAutoRefreshStrategy, setPreferredAutoRefreshStrategy] =
    useState<NonOffRefreshStrategy>(
      initialPaneState?.preferredAutoRefreshStrategy ?? DEFAULT_PREFERRED_REFRESH_STRATEGY,
    );
  const [historyCategories, setHistoryCategories] = useState<MessageCategory[]>(
    initialPaneState?.historyCategories ?? [...DEFAULT_MESSAGE_CATEGORIES],
  );
  const historyCategoriesRef = useRef<MessageCategory[]>(historyCategories);
  const historyCategorySoloRestoreRef = useRef<{
    mode: `solo:${MessageCategory}` | "preset:primary" | "preset:all";
    categories: MessageCategory[];
  } | null>(null);
  const [expandedByDefaultCategories, setExpandedByDefaultCategories] = useState<MessageCategory[]>(
    initialPaneState?.expandedByDefaultCategories ?? [...DEFAULT_MESSAGE_CATEGORIES],
  );
  const [turnViewCategories, setTurnViewCategories] = useState<MessageCategory[]>(
    initialPaneState?.turnViewCategories ?? [...DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES],
  );
  const [turnViewExpandedByDefaultCategories, setTurnViewExpandedByDefaultCategories] = useState<
    MessageCategory[]
  >(
    initialPaneState?.turnViewExpandedByDefaultCategories ?? [
      ...DEFAULT_TURN_VIEW_EXPANDED_CATEGORIES,
    ],
  );
  const [turnViewCombinedChangesExpanded, setTurnViewCombinedChangesExpanded] = useState(
    initialPaneState?.turnViewCombinedChangesExpanded ?? false,
  );
  const [turnViewCombinedChangesExpandedOverride, setTurnViewCombinedChangesExpandedOverride] =
    useState<boolean | null>(null);
  const [visibleExpansionActionState, setVisibleExpansionActionState] =
    useState<VisibleExpansionAction>("expand");
  const visibleExpansionScopeKeyRef = useRef("");
  const visibleExpansionItemCountRef = useRef(0);
  const turnViewCategoriesRef = useRef<MessageCategory[]>(turnViewCategories);
  const turnViewCategorySoloRestoreRef = useRef<{
    mode: `solo:${MessageCategory}` | "preset:primary" | "preset:all";
    categories: MessageCategory[];
  } | null>(null);
  const [historyVisualization, setHistoryVisualization] = useState<HistoryVisualization>(
    deriveHistoryVisualization(
      initialPaneState?.historyMode ?? "project_all",
      initialPaneState?.historyDetailMode ?? "flat",
    ),
  );
  const [turnAnchorMessageId, setTurnAnchorMessageId] = useState("");
  const [turnSourceSessionId, setTurnSourceSessionId] = useState("");
  const [sessionTurnDetail, setSessionTurnDetail] = useState<SessionTurnDetail | null>(null);
  const turnScopeKeyRef = useRef("");
  const [liveWatchEnabled, setLiveWatchEnabled] = useState(
    initialPaneState?.liveWatchEnabled ?? true,
  );
  const [liveWatchRowHasBackground, setLiveWatchRowHasBackground] = useState(
    initialPaneState?.liveWatchRowHasBackground ?? true,
  );
  const [claudeHooksPrompted, setClaudeHooksPrompted] = useState(
    initialPaneState?.claudeHooksPrompted ?? false,
  );
  const [projectPaneCollapsed, setProjectPaneCollapsed] = useState(
    initialPaneState?.projectPaneCollapsed ?? false,
  );
  const [sessionPaneCollapsed, setSessionPaneCollapsed] = useState(
    initialPaneState?.sessionPaneCollapsed ?? true,
  );
  const [singleClickFoldersExpand, setSingleClickFoldersExpand] = useState(
    initialPaneState?.singleClickFoldersExpand ?? true,
  );
  const [singleClickProjectsExpand, setSingleClickProjectsExpand] = useState(
    initialPaneState?.singleClickProjectsExpand ?? false,
  );
  const [hideSessionsPaneInTreeView, setHideSessionsPaneInTreeView] = useState(
    initialPaneState?.hideSessionsPaneInTreeView ?? false,
  );
  const [bookmarkReturnSelection, setBookmarkReturnSelection] = useState<HistorySelection | null>(
    null,
  );
  const [messageExpansionOverrides, setMessageExpansionOverrides] = useState<
    Record<string, boolean>
  >({});
  const [focusMessageId, setFocusMessageId] = useState("");
  const [pendingRevealTarget, setPendingRevealTarget] = useState<PendingRevealTarget | null>(null);
  const [autoRevealSessionRequest, setAutoRevealSessionRequest] =
    useState<TreeAutoRevealSessionRequest | null>(null);
  const [pendingMessageAreaFocus, setPendingMessageAreaFocus] = useState(false);
  const [pendingMessagePageNavigation, setPendingMessagePageNavigation] =
    useState<PendingMessagePageNavigation | null>(null);
  const [pendingSearchNavigation, setPendingSearchNavigation] =
    useState<HistorySearchNavigation | null>(null);
  const [sessionDetailRefreshNonce, setSessionDetailRefreshNonce] = useState(0);
  const [projectCombinedDetailRefreshNonce, setProjectCombinedDetailRefreshNonce] = useState(0);
  const [turnDetailRefreshNonce, setTurnDetailRefreshNonce] = useState(0);
  const [historyExportState, setHistoryExportState] = useState<HistoryExportState>({
    open: false,
    exportId: null,
    scope: "current_page",
    percent: 0,
    phase: "preparing",
    message: "",
  });

  const projectQuery = useDebouncedValue(projectQueryInput, 180);
  const sessionQuery = useDebouncedValue(sessionQueryInput, 400);
  const bookmarkQuery = useDebouncedValue(bookmarkQueryInput, 400);
  const turnQuery = useDebouncedValue(turnQueryInput, 400);
  const effectiveSessionQuery = sessionQueryInput.trim().length === 0 ? "" : sessionQuery;
  const effectiveBookmarkQuery = bookmarkQueryInput.trim().length === 0 ? "" : bookmarkQuery;
  const effectiveTurnQuery = turnQueryInput.trim().length === 0 ? "" : turnQuery;

  const focusedMessageRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const projectListRef = useRef<HTMLDivElement | null>(null);
  const sessionSearchInputRef = useRef<HTMLInputElement | null>(null);
  // Persisted scroll restoration only applies to the same session/page snapshot that was saved.
  const pendingRestoredSessionScrollRef = useRef<{
    sessionId: string;
    sessionPage: number;
    scrollTop: number;
  } | null>(
    initialPaneState?.selectedSessionId &&
      typeof initialPaneState?.sessionPage === "number" &&
      typeof initialPaneState?.sessionScrollTop === "number" &&
      initialPaneState.sessionScrollTop > 0
      ? {
          sessionId: initialPaneState.selectedSessionId,
          sessionPage: initialPaneState.sessionPage,
          scrollTop: initialPaneState.sessionScrollTop,
        }
      : null,
  );
  const scrollPreservationRef = useRef<{
    scrollTop: number;
    referenceMessageId: string;
    referenceOffsetTop: number;
  } | null>(null);
  const pendingAutoScrollRef = useRef(false);
  const prevMessageIdsRef = useRef("");
  const refreshContextRef = useRef<RefreshContext | null>(null);
  const selectedProjectRefreshFingerprintRef = useRef("");
  const selectedSessionRefreshFingerprintRef = useRef("");
  const refreshIdCounterRef = useRef(0);
  const treeProjectSessionsLoadTokenRef = useRef<Record<string, number>>({});
  const treeProjectSessionsByProjectIdRef = useRef<Record<string, SessionSummary[]>>({});
  const treeProjectSessionsLoadingByProjectIdRef = useRef<Record<string, boolean>>({});
  const projectsRef = useRef<ProjectSummary[]>([]);
  const projectUpdateTimeoutsRef = useRef<Map<string, number>>(new Map());
  const projectOrderControlKeyRef = useRef("");
  const sessionOrderControlKeyRef = useRef("");
  const treeSessionOrderControlKeyRef = useRef("");
  const startupWatchResortPendingRef = useRef(
    isWatchRefreshStrategy(initialPaneState?.currentAutoRefreshStrategy ?? "off"),
  );

  const projectsLoadTokenRef = useRef(0);
  const sessionsLoadTokenRef = useRef(0);
  const bookmarksLoadTokenRef = useRef(0);
  const sessionScrollTopRef = useRef(initialSessionScrollTop);
  const sessionScrollSyncTimerRef = useRef<number | null>(null);
  const activeHistoryMessageIdsRef = useRef<string[]>([]);
  const bookmarkStateRequestKeyRef = useRef("");
  const {
    selection,
    committedSelection,
    pendingProjectPaneFocusCommitModeRef,
    pendingProjectPaneFocusWaitForKeyboardIdleRef,
    clearSelectionCommitTimer,
    queueSelectionNoopCommit,
    setHistorySelectionImmediate,
    setHistorySelectionWithCommitMode,
    consumeProjectPaneFocusSelectionBehavior,
  } = useHistorySelectionState(initialPaneState, testHistorySelectionDebounceOverrides);

  const {
    projectPaneWidth,
    setProjectPaneWidth,
    sessionPaneWidth,
    setSessionPaneWidth,
    beginResize,
  } = useResizablePanes({
    isHistoryLayout,
    projectMin: 230,
    projectMax: 520,
    sessionMin: 250,
    sessionMax: 620,
    initialProjectPaneWidth,
    initialSessionPaneWidth,
  });

  const rawUiSelectedProjectId = selection.projectId;
  const rawUiSelectedSessionId = "sessionId" in selection ? (selection.sessionId ?? "") : "";
  const uiHistoryMode = selection.mode;
  const historyDetailMode = getHistoryDetailModeForVisualization(historyVisualization);

  const naturallySortedProjects = useMemo(() => {
    const next = projects.filter((project) => enabledProviders.includes(project.provider));
    next.sort((left, right) => {
      const naturalOrder = compareProjectsByField(left, right, projectSortField);
      return projectSortDirection === "asc" ? naturalOrder : -naturalOrder;
    });
    return next;
  }, [enabledProviders, projectSortDirection, projectSortField, projects]);

  const projectOrderControlKey = useMemo(
    () =>
      [
        projectSortDirection,
        projectSortField,
        enabledProviders.join(","),
        projectProviders.join(","),
        projectQuery,
      ].join("\u0000"),
    [enabledProviders, projectProviders, projectQuery, projectSortDirection, projectSortField],
  );

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const nextIds = naturallySortedProjects.map((project) => project.id);
    const didProjectControlsChange = projectOrderControlKeyRef.current !== projectOrderControlKey;
    projectOrderControlKeyRef.current = projectOrderControlKey;

    setProjectOrderIds((current) => {
      if (didProjectControlsChange || projectListUpdateSource !== "auto" || current.length === 0) {
        return nextIds;
      }
      return mergeStableOrder(current, nextIds);
    });
  }, [naturallySortedProjects, projectListUpdateSource, projectOrderControlKey]);

  const sortedProjects = useMemo(
    () => reorderItemsByStableOrder(naturallySortedProjects, projectOrderIds),
    [naturallySortedProjects, projectOrderIds],
  );
  const rawSelectedProjectId = committedSelection.projectId;
  const rawSelectedSessionId =
    "sessionId" in committedSelection ? (committedSelection.sessionId ?? "") : "";
  const historyMode = committedSelection.mode;
  const selectedProjectId = rawSelectedProjectId || sortedProjects[0]?.id || "";
  const selectedSessionId = rawSelectedSessionId;
  const uiSelectedProjectId = rawUiSelectedProjectId || sortedProjects[0]?.id || "";
  const uiSelectedSessionId = rawUiSelectedSessionId;
  const currentHistorySelection = useMemo(
    () => createHistorySelection(historyMode, selectedProjectId, selectedSessionId),
    [historyMode, selectedProjectId, selectedSessionId],
  );
  const currentUiHistorySelection = useMemo(
    () => createHistorySelection(uiHistoryMode, uiSelectedProjectId, uiSelectedSessionId),
    [uiHistoryMode, uiSelectedProjectId, uiSelectedSessionId],
  );

  const naturallySortedSessions = useMemo(
    () => sortSessionSummaries(sessions, sessionSortDirection),
    [sessionSortDirection, sessions],
  );
  const sessionOrderControlKey = useMemo(
    () => [selectedProjectId, sessionSortDirection].join("\u0000"),
    [selectedProjectId, sessionSortDirection],
  );

  useEffect(() => {
    const nextIds = naturallySortedSessions.map((session) => session.id);
    const didSessionControlsChange = sessionOrderControlKeyRef.current !== sessionOrderControlKey;
    sessionOrderControlKeyRef.current = sessionOrderControlKey;

    setSessionOrderIds((current) => {
      if (didSessionControlsChange || sessionListUpdateSource !== "auto" || current.length === 0) {
        return nextIds;
      }
      return mergeStableOrder(current, nextIds);
    });
  }, [naturallySortedSessions, sessionListUpdateSource, sessionOrderControlKey]);

  const sortedSessions = useMemo(
    () => reorderItemsByStableOrder(naturallySortedSessions, sessionOrderIds),
    [naturallySortedSessions, sessionOrderIds],
  );
  const naturallySortedTreeProjectSessionsByProjectId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(treeProjectSessionsByProjectId).map(([projectId, projectSessions]) => [
          projectId,
          sortSessionSummaries(projectSessions, sessionSortDirection),
        ]),
      ) as Record<string, SessionSummary[]>,
    [sessionSortDirection, treeProjectSessionsByProjectId],
  );
  const treeSessionOrderControlKey = sessionSortDirection;

  useEffect(() => {
    const didTreeSessionControlsChange =
      treeSessionOrderControlKeyRef.current !== treeSessionOrderControlKey;
    treeSessionOrderControlKeyRef.current = treeSessionOrderControlKey;

    setTreeProjectSessionOrderIdsByProjectId((current) => {
      const next = Object.fromEntries(
        Object.entries(naturallySortedTreeProjectSessionsByProjectId).map(
          ([projectId, projectSessions]) => {
            const nextIds = projectSessions.map((session) => session.id);
            const currentIds = current[projectId] ?? [];
            const updateSource = treeProjectSessionsUpdateSourceByProjectId[projectId] ?? "resort";
            if (
              didTreeSessionControlsChange ||
              updateSource !== "auto" ||
              currentIds.length === 0
            ) {
              return [projectId, nextIds];
            }
            return [projectId, mergeStableOrder(currentIds, nextIds)];
          },
        ),
      ) as Record<string, string[]>;
      return areStableOrderMapsEqual(current, next) ? current : next;
    });
  }, [
    naturallySortedTreeProjectSessionsByProjectId,
    treeProjectSessionsUpdateSourceByProjectId,
    treeSessionOrderControlKey,
  ]);

  const sortedTreeProjectSessionsByProjectId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(naturallySortedTreeProjectSessionsByProjectId).map(
          ([projectId, projectSessions]) => [
            projectId,
            reorderItemsByStableOrder(
              projectSessions,
              treeProjectSessionOrderIdsByProjectId[projectId] ?? [],
            ),
          ],
        ),
      ) as Record<string, SessionSummary[]>,
    [naturallySortedTreeProjectSessionsByProjectId, treeProjectSessionOrderIdsByProjectId],
  );
  const turnSourceSession = useMemo(() => {
    if (!turnSourceSessionId) {
      return null;
    }
    const listedSession = sortedSessions.find((session) => session.id === turnSourceSessionId);
    if (listedSession) {
      return listedSession;
    }
    for (const projectSessions of Object.values(sortedTreeProjectSessionsByProjectId)) {
      const matchedSession = projectSessions.find((session) => session.id === turnSourceSessionId);
      if (matchedSession) {
        return matchedSession;
      }
    }
    return null;
  }, [sortedSessions, sortedTreeProjectSessionsByProjectId, turnSourceSessionId]);

  useEffect(() => {
    treeProjectSessionsByProjectIdRef.current = treeProjectSessionsByProjectId;
  }, [treeProjectSessionsByProjectId]);

  useEffect(() => {
    treeProjectSessionsLoadingByProjectIdRef.current = treeProjectSessionsLoadingByProjectId;
  }, [treeProjectSessionsLoadingByProjectId]);
  const queueProjectTreeNoopCommit = useCallback(
    ({
      commitMode = "immediate",
      waitForKeyboardIdle = false,
    }: {
      commitMode?: HistorySelectionCommitMode;
      waitForKeyboardIdle?: boolean;
    } = {}) => {
      pendingProjectPaneFocusCommitModeRef.current = "immediate";
      pendingProjectPaneFocusWaitForKeyboardIdleRef.current = false;
      queueSelectionNoopCommit(commitMode, waitForKeyboardIdle);
    },
    [
      pendingProjectPaneFocusCommitModeRef,
      pendingProjectPaneFocusWaitForKeyboardIdleRef,
      queueSelectionNoopCommit,
    ],
  );

  useEffect(() => {
    const visibleProjectIds = new Set(sortedProjects.map((project) => project.id));
    setTreeProjectSessionsByProjectId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
      ),
    );
    setTreeProjectSessionsLoadingByProjectId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
      ),
    );
    setTreeProjectSessionsUpdateSourceByProjectId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
      ),
    );
    setTreeProjectSessionOrderIdsByProjectId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
      ),
    );
  }, [sortedProjects]);

  const ensureTreeProjectSessionsLoaded = useCallback(
    async (projectId: string, source: StableListUpdateSource = "resort") => {
      if (
        !projectId ||
        treeProjectSessionsLoadingByProjectIdRef.current[projectId] ||
        treeProjectSessionsByProjectIdRef.current[projectId]
      ) {
        return;
      }

      const requestToken = (treeProjectSessionsLoadTokenRef.current[projectId] ?? 0) + 1;
      treeProjectSessionsLoadTokenRef.current[projectId] = requestToken;
      setTreeProjectSessionsLoadingByProjectId((current) => ({
        ...current,
        [projectId]: true,
      }));
      try {
        const response = await codetrail.invoke("sessions:list", { projectId });
        if (treeProjectSessionsLoadTokenRef.current[projectId] !== requestToken) {
          return;
        }
        setTreeProjectSessionsByProjectId((current) => ({
          ...current,
          [projectId]: response.sessions,
        }));
        setTreeProjectSessionsUpdateSourceByProjectId((current) => ({
          ...current,
          [projectId]: source,
        }));
      } catch (error) {
        logError("Failed loading tree sessions", error);
      } finally {
        if (treeProjectSessionsLoadTokenRef.current[projectId] === requestToken) {
          setTreeProjectSessionsLoadingByProjectId((current) => {
            const next = { ...current };
            delete next[projectId];
            return next;
          });
        }
      }
    },
    [codetrail, logError],
  );

  const refreshTreeProjectSessions = useCallback(
    async (source: StableListUpdateSource = "resort") => {
      const projectIds = Object.keys(treeProjectSessionsByProjectIdRef.current);
      if (projectIds.length === 0) {
        return;
      }
      try {
        const response = await codetrail.invoke("sessions:listMany", { projectIds });
        setTreeProjectSessionsByProjectId((current) => ({
          ...current,
          ...response.sessionsByProjectId,
        }));
        setTreeProjectSessionsUpdateSourceByProjectId((current) => ({
          ...current,
          ...Object.fromEntries(projectIds.map((projectId) => [projectId, source] as const)),
        }));
      } catch (error) {
        logError("Failed refreshing tree sessions", error);
      }
    },
    [codetrail, logError],
  );

  const projectProviderKey = useMemo(() => projectProviders.join(","), [projectProviders]);
  const {
    folderGroups,
    expandedFolderIdSet,
    expandedProjectIds,
    allVisibleFoldersExpanded,
    treeFocusedRow,
    setTreeFocusedRow,
    handleToggleFolder,
    handleToggleAllFolders,
    handleToggleProjectExpansion: toggleTreeProjectExpansion,
  } = useProjectPaneTreeState({
    sortedProjects,
    selectedProjectId: uiSelectedProjectId,
    selectedSessionId: uiSelectedSessionId,
    sortField: projectSortField,
    sortDirection: projectSortDirection,
    viewMode: projectViewMode,
    updateSource: projectListUpdateSource,
    historyMode: uiHistoryMode,
    projectProvidersKey: projectProviderKey,
    projectQueryInput,
    onEnsureTreeProjectSessionsLoaded: ensureTreeProjectSessionsLoaded,
    autoRevealSessionRequest,
    onConsumeAutoRevealSessionRequest: () =>
      clearAutoRevealSessionRequest(setAutoRevealSessionRequest),
  });

  const paneAppearanceState = useMemo(
    () => ({
      theme: appearance.theme,
      darkShikiTheme: appearance.darkShikiTheme,
      lightShikiTheme: appearance.lightShikiTheme,
      monoFontFamily: appearance.monoFontFamily,
      regularFontFamily: appearance.regularFontFamily,
      monoFontSize: appearance.monoFontSize,
      regularFontSize: appearance.regularFontSize,
      messagePageSize: appearance.messagePageSize,
      useMonospaceForAllMessages: appearance.useMonospaceForAllMessages,
      autoHideMessageActions: appearance.autoHideMessageActions,
      autoHideViewerHeaderActions: appearance.autoHideViewerHeaderActions,
      defaultViewerWrapMode: appearance.defaultViewerWrapMode,
      defaultDiffViewMode: appearance.defaultDiffViewMode,
      collapseMultiFileToolDiffs: appearance.collapseMultiFileToolDiffs,
      preferredExternalEditor: appearance.preferredExternalEditor,
      preferredExternalDiffTool: appearance.preferredExternalDiffTool,
      terminalAppCommand: appearance.terminalAppCommand,
      externalTools: appearance.externalTools,
    }),
    [
      appearance.darkShikiTheme,
      appearance.externalTools,
      appearance.lightShikiTheme,
      appearance.monoFontFamily,
      appearance.monoFontSize,
      appearance.messagePageSize,
      appearance.preferredExternalDiffTool,
      appearance.preferredExternalEditor,
      appearance.terminalAppCommand,
      appearance.regularFontFamily,
      appearance.regularFontSize,
      appearance.theme,
      appearance.useMonospaceForAllMessages,
      appearance.autoHideMessageActions,
      appearance.autoHideViewerHeaderActions,
      appearance.defaultViewerWrapMode,
      appearance.defaultDiffViewMode,
      appearance.collapseMultiFileToolDiffs,
    ],
  );

  const paneLayoutState = useMemo(
    () => ({
      projectPaneWidth,
      sessionPaneWidth,
      projectPaneCollapsed,
      sessionPaneCollapsed,
      singleClickFoldersExpand,
      singleClickProjectsExpand,
      hideSessionsPaneInTreeView,
      sessionScrollTop,
      projectViewMode,
    }),
    [
      projectPaneCollapsed,
      projectPaneWidth,
      projectViewMode,
      sessionPaneCollapsed,
      sessionPaneWidth,
      sessionScrollTop,
      singleClickFoldersExpand,
      singleClickProjectsExpand,
      hideSessionsPaneInTreeView,
    ],
  );

  const paneFilterState = useMemo(
    () => ({
      enabledProviders,
      removeMissingSessionsDuringIncrementalIndexing,
      projectProviders,
      historyCategories,
      expandedByDefaultCategories,
      turnViewCategories,
      turnViewExpandedByDefaultCategories,
      turnViewCombinedChangesExpanded,
      searchProviders,
      liveWatchEnabled,
      liveWatchRowHasBackground,
      claudeHooksPrompted,
      preferredAutoRefreshStrategy,
      systemMessageRegexRules,
    }),
    [
      enabledProviders,
      expandedByDefaultCategories,
      historyCategories,
      liveWatchEnabled,
      liveWatchRowHasBackground,
      claudeHooksPrompted,
      preferredAutoRefreshStrategy,
      projectProviders,
      removeMissingSessionsDuringIncrementalIndexing,
      searchProviders,
      systemMessageRegexRules,
      turnViewCategories,
      turnViewExpandedByDefaultCategories,
      turnViewCombinedChangesExpanded,
    ],
  );

  const paneSelectionState = useMemo(
    () => ({
      selectedProjectId,
      selectedSessionId,
      historyMode,
      historyVisualization,
      historyDetailMode,
      sessionPage,
    }),
    [
      historyDetailMode,
      historyMode,
      historyVisualization,
      selectedProjectId,
      selectedSessionId,
      sessionPage,
    ],
  );

  const paneSortState = useMemo(
    () => ({
      projectSortField,
      projectSortDirection,
      sessionSortDirection,
      messageSortDirection,
      bookmarkSortDirection,
      projectAllSortDirection,
      turnViewSortDirection,
    }),
    [
      bookmarkSortDirection,
      messageSortDirection,
      projectAllSortDirection,
      projectSortField,
      projectSortDirection,
      sessionSortDirection,
      turnViewSortDirection,
    ],
  );

  const paneStateForSync = useMemo(
    () => ({
      // Keep the persisted snapshot derived from the controller's canonical selection state so
      // restoration does not drift from what the UI is actually rendering.
      ...paneFilterState,
      ...paneLayoutState,
      ...paneAppearanceState,
      ...paneSelectionState,
      ...paneSortState,
    }),
    [paneAppearanceState, paneFilterState, paneLayoutState, paneSelectionState, paneSortState],
  );

  const setSelectedProjectIdForPaneStateSync = useCallback(
    (value: SetStateAction<string>) => {
      setHistorySelectionImmediate((selectionState) =>
        typeof value === "function"
          ? setHistorySelectionProjectId(selectionState, value(selectionState.projectId))
          : setHistorySelectionProjectId(selectionState, value),
      );
    },
    [setHistorySelectionImmediate],
  );

  const setSelectedSessionIdForPaneStateSync = useCallback(
    (value: SetStateAction<string>) => {
      setHistorySelectionImmediate((selectionState) =>
        typeof value === "function"
          ? setHistorySelectionSessionId(
              selectionState,
              value("sessionId" in selectionState ? (selectionState.sessionId ?? "") : ""),
            )
          : setHistorySelectionSessionId(selectionState, value),
      );
    },
    [setHistorySelectionImmediate],
  );

  const setHistoryModeForPaneStateSync = useCallback(
    (value: SetStateAction<HistorySelection["mode"]>) => {
      setHistorySelectionImmediate((selectionState) =>
        createHistorySelection(
          typeof value === "function" ? value(selectionState.mode) : value,
          selectionState.projectId,
          "sessionId" in selectionState ? (selectionState.sessionId ?? "") : "",
        ),
      );
    },
    [setHistorySelectionImmediate],
  );

  const { paneStateHydrated } = usePaneStateSync({
    initialPaneStateHydrated: initialPaneState !== null,
    logError,
    paneState: paneStateForSync,
    setEnabledProviders,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectPaneCollapsed,
    setSessionPaneCollapsed,
    setSingleClickFoldersExpand,
    setSingleClickProjectsExpand,
    setHideSessionsPaneInTreeView,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setTurnViewCategories,
    setTurnViewExpandedByDefaultCategories,
    setTurnViewCombinedChangesExpanded,
    setSearchProviders,
    setLiveWatchEnabled,
    setLiveWatchRowHasBackground,
    setClaudeHooksPrompted,
    setPreferredAutoRefreshStrategy,
    setRemoveMissingSessionsDuringIncrementalIndexing,
    setTheme: appearance.setTheme,
    setDarkShikiTheme: appearance.setDarkShikiTheme,
    setLightShikiTheme: appearance.setLightShikiTheme,
    setMonoFontFamily: appearance.setMonoFontFamily,
    setRegularFontFamily: appearance.setRegularFontFamily,
    setMonoFontSize: appearance.setMonoFontSize,
    setRegularFontSize: appearance.setRegularFontSize,
    setMessagePageSize: appearance.setMessagePageSize,
    setUseMonospaceForAllMessages: appearance.setUseMonospaceForAllMessages,
    setAutoHideMessageActions: appearance.setAutoHideMessageActions,
    setAutoHideViewerHeaderActions: appearance.setAutoHideViewerHeaderActions,
    setDefaultViewerWrapMode: appearance.setDefaultViewerWrapMode,
    setDefaultDiffViewMode: appearance.setDefaultDiffViewMode,
    setCollapseMultiFileToolDiffs: appearance.setCollapseMultiFileToolDiffs,
    setPreferredExternalEditor: appearance.setPreferredExternalEditor,
    setPreferredExternalDiffTool: appearance.setPreferredExternalDiffTool,
    setTerminalAppCommand: appearance.setTerminalAppCommand,
    setExternalTools: appearance.setExternalTools,
    setHistorySelection: setHistorySelectionImmediate,
    setSelectedProjectId: setSelectedProjectIdForPaneStateSync,
    setSelectedSessionId: setSelectedSessionIdForPaneStateSync,
    setHistoryMode: setHistoryModeForPaneStateSync,
    setHistoryVisualization,
    setProjectViewMode,
    setProjectSortField,
    setProjectSortDirection,
    setSessionSortDirection,
    setMessageSortDirection,
    setBookmarkSortDirection,
    setProjectAllSortDirection,
    setTurnViewSortDirection,
    setSessionPage,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  });

  useReconcileProviderSelection(enabledProviders, setProjectProviders);

  const hideSessionsPaneForTreeView = hideSessionsPaneInTreeView && projectViewMode === "tree";

  const registerAutoProjectUpdates = useCallback((deltas: Record<string, number>) => {
    const entries = Object.entries(deltas).filter(([, delta]) => delta > 0);
    if (entries.length === 0) {
      return;
    }

    const now = Date.now();
    setProjectUpdates((current) => {
      const next = { ...current };
      for (const [projectId, delta] of entries) {
        const previousDelta = next[projectId]?.messageDelta ?? 0;
        next[projectId] = {
          messageDelta: previousDelta + delta,
          updatedAt: now,
        };
      }
      return next;
    });

    for (const [projectId] of entries) {
      const existingTimeoutId = projectUpdateTimeoutsRef.current.get(projectId);
      if (existingTimeoutId !== undefined) {
        window.clearTimeout(existingTimeoutId);
      }
      const timeoutId = window.setTimeout(() => {
        setProjectUpdates((current) => {
          if (!(projectId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[projectId];
          return next;
        });
        projectUpdateTimeoutsRef.current.delete(projectId);
      }, PROJECT_UPDATE_HIGHLIGHT_MS);
      projectUpdateTimeoutsRef.current.set(projectId, timeoutId);
    }
  }, []);

  const { loadProjects, loadSessions, loadBookmarks } = useHistoryDataEffects({
    codetrail,
    logError,
    projectProviders,
    projectQuery,
    rawSelectedProjectId: rawUiSelectedProjectId,
    selectedProjectId,
    selectedSessionId,
    sortedProjects,
    sortedSessions,
    pendingSearchNavigation,
    setPendingSearchNavigation,
    setHistorySelection: setHistorySelectionImmediate,
    setProjects,
    projectsRef,
    setProjectListUpdateSource,
    registerAutoProjectUpdates,
    setProjectsLoaded,
    projectsLoaded,
    setSessions,
    setSessionListUpdateSource,
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
    bookmarkSortDirection,
    messageSortDirection,
    projectAllSortDirection,
    sessionPage,
    messagePageSize: appearance.messagePageSize,
    setSessionDetail,
    setProjectCombinedDetail,
    bookmarksLoadedProjectId,
    bookmarksResponse,
    setSessionPaneStableProjectId,
    sessionsLoadedProjectId,
    projectsLoadTokenRef,
    sessionsLoadTokenRef,
    bookmarksLoadTokenRef,
    sessionDetailRefreshNonce,
    projectCombinedDetailRefreshNonce,
    refreshContextRef,
  });

  useEffect(() => {
    return () => {
      if (sessionScrollSyncTimerRef.current !== null) {
        window.clearTimeout(sessionScrollSyncTimerRef.current);
      }
      clearSelectionCommitTimer();
      for (const timeoutId of projectUpdateTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      projectUpdateTimeoutsRef.current.clear();
    };
  }, [clearSelectionCommitTimer]);

  const {
    activeMessageSortDirection,
    messageSortTooltip,
    bookmarkOrphanedByMessageId,
    bookmarkedMessageIds,
    activeHistoryMessages,
    visibleFocusedMessageId: visibleFocusedMessageIdFlat,
    focusedMessagePosition: focusedMessagePositionFlat,
    loadedHistoryPage,
    selectedProject,
    selectedSession,
    allSessionsCount,
    visibleSessionPaneSessions,
    visibleSessionPaneBookmarksCount,
    visibleSessionPaneAllSessionsCount,
    currentViewBookmarkCount,
    sessionPaneNavigationItems,
    messagePathRoots,
    projectProviderCounts,
    totalPages,
    canNavigatePages,
    canGoToPreviousHistoryPage,
    canGoToNextHistoryPage,
    historyCategoryCounts,
    historyQueryError,
    historyHighlightPatterns,
    isExpandedByDefault,
    areAllMessagesExpanded: areAllMessagesExpandedFlat,
    globalExpandCollapseLabel: globalExpandCollapseLabelFlat,
    workspaceStyle,
    selectedSummaryMessageCount,
    historyCategoryExpandShortcutMap,
    historyCategoriesShortcutMap,
    historyCategorySoloShortcutMap,
    prettyCategory,
    prettyProvider: formatPrettyProvider,
    formatDate,
  } = useHistoryDerivedState({
    historyMode,
    sortedProjects,
    sortedSessions,
    selectedProjectId,
    selectedSessionId,
    sessionPaneStableProjectId,
    bookmarksResponse,
    visibleBookmarkedMessageIds,
    bookmarkSortDirection,
    projectCombinedDetail,
    sessionDetail,
    projectAllSortDirection,
    messageSortDirection,
    focusMessageId,
    sessionPage,
    messagePageSize: appearance.messagePageSize,
    historyCategories,
    expandedByDefaultCategories,
    isHistoryLayout,
    projectPaneCollapsed,
    projectPaneWidth,
    sessionPaneCollapsed,
    sessionPaneWidth,
  });
  const activeHistoryMessageIds = useMemo(
    () => activeHistoryMessages.map((message) => message.id),
    [activeHistoryMessages],
  );
  const turnAnchorMessage = useMemo(() => {
    if (!sessionTurnDetail) {
      return null;
    }
    return (
      sessionTurnDetail.anchorMessage ??
      sessionTurnDetail.messages.find(
        (message) => message.id === sessionTurnDetail.anchorMessageId,
      ) ??
      null
    );
  }, [sessionTurnDetail]);
  const turnVisibleMessages = useMemo(
    () =>
      buildTurnVisibleMessages(
        sessionTurnDetail?.messages ?? [],
        turnAnchorMessage,
        turnViewCategories,
        sessionTurnDetail?.matchedMessageIds,
      ),
    [
      sessionTurnDetail?.matchedMessageIds,
      sessionTurnDetail?.messages,
      turnAnchorMessage,
      turnViewCategories,
    ],
  );
  const detailMessages = historyDetailMode === "turn" ? turnVisibleMessages : activeHistoryMessages;
  const detailMessageIds = useMemo(
    () => detailMessages.map((message) => message.id),
    [detailMessages],
  );
  const turnCategoryCounts = useMemo(
    () =>
      sessionTurnDetail?.categoryCounts ??
      buildTurnCategoryCounts(sessionTurnDetail?.messages ?? [], turnAnchorMessage),
    [sessionTurnDetail?.categoryCounts, sessionTurnDetail?.messages, turnAnchorMessage],
  );
  const turnTotalCount = sessionTurnDetail?.totalTurns ?? 0;
  const turnTotalPages = Math.max(1, turnTotalCount || 1);
  const turnDisplayPage = useMemo(() => {
    if (turnTotalCount === 0) {
      return 0;
    }
    const canonicalTurnNumber = Math.min(
      turnTotalPages,
      Math.max(1, sessionTurnDetail?.turnNumber ?? 1),
    );
    if (turnViewSortDirection === "desc") {
      return Math.max(0, turnTotalPages - canonicalTurnNumber);
    }
    return Math.max(0, canonicalTurnNumber - 1);
  }, [sessionTurnDetail?.turnNumber, turnTotalCount, turnTotalPages, turnViewSortDirection]);
  const turnVisualizationSelection = useMemo(
    () =>
      getTurnVisualizationSelection({
        selection: currentUiHistorySelection,
        selectedProjectId,
      }),
    [currentUiHistorySelection, selectedProjectId],
  );
  const canToggleTurnView =
    historyDetailMode === "turn"
      ? true
      : turnVisualizationSelection.mode === "session"
        ? Boolean(
            ("sessionId" in turnVisualizationSelection && turnVisualizationSelection.sessionId) ||
              selectedSessionId,
          ) &&
          ((sessionDetail?.categoryCounts.user ?? 0) > 0 ||
            (selectedSession?.messageCount ?? 0) > 0)
        : Boolean(turnVisualizationSelection.projectId) &&
          (historyCategoryCounts.user > 0 || (selectedProject?.messageCount ?? 0) > 0);
  const currentTurnScopeKey = useMemo(
    () => getTurnScopeKey(turnVisualizationSelection),
    [turnVisualizationSelection],
  );
  const visibleFocusedMessageId = useMemo(() => {
    if (!focusMessageId) {
      return "";
    }
    return detailMessages.some((message) => message.id === focusMessageId) ? focusMessageId : "";
  }, [detailMessages, focusMessageId]);
  const focusedMessagePosition = useMemo(() => {
    if (!focusMessageId) {
      return -1;
    }
    return detailMessages.findIndex((message) => message.id === focusMessageId);
  }, [detailMessages, focusMessageId]);
  const stableActiveHistoryMessageIds = useMemo(() => {
    const previousIds = activeHistoryMessageIdsRef.current;
    if (
      previousIds.length === detailMessageIds.length &&
      previousIds.every((messageId, index) => messageId === detailMessageIds[index])
    ) {
      return previousIds;
    }
    return detailMessageIds;
  }, [detailMessageIds]);
  const stableActiveHistoryMessageIdsSignature = useMemo(
    () => stableActiveHistoryMessageIds.join("\u0000"),
    [stableActiveHistoryMessageIds],
  );
  const bookmarkStateRequestKey = useMemo(
    () =>
      `${selectedProjectId ?? ""}\u0001${historyMode}\u0001${bookmarkStatesRefreshNonce}\u0001${stableActiveHistoryMessageIdsSignature}`,
    [
      bookmarkStatesRefreshNonce,
      historyMode,
      selectedProjectId,
      stableActiveHistoryMessageIdsSignature,
    ],
  );

  useEffect(() => {
    historyCategoriesRef.current = historyCategories;
  }, [historyCategories]);

  useEffect(() => {
    turnViewCategoriesRef.current = turnViewCategories;
  }, [turnViewCategories]);

  useEffect(() => {
    if (historyVisualization === "turns") {
      return;
    }
    if (historyVisualization === "bookmarks") {
      if (historyMode === "bookmarks" || !selectedProjectId) {
        return;
      }
      setHistorySelectionImmediate(
        createHistorySelection(
          "bookmarks",
          selectedProjectId,
          historyMode === "session" ? selectedSessionId : "",
        ),
      );
      return;
    }
    if (historyMode === "bookmarks") {
      setHistorySelectionImmediate(
        createHistorySelection(
          selectedSessionId ? "session" : "project_all",
          selectedProjectId,
          selectedSessionId,
        ),
      );
    }
  }, [
    historyMode,
    historyVisualization,
    selectedProjectId,
    selectedSessionId,
    setHistorySelectionImmediate,
  ]);

  useEffect(() => {
    selectedProjectRefreshFingerprintRef.current = getProjectRefreshFingerprint(selectedProject);
  }, [selectedProject]);

  useEffect(() => {
    selectedSessionRefreshFingerprintRef.current = getSessionRefreshFingerprint(selectedSession);
  }, [selectedSession]);

  useEffect(() => {
    activeHistoryMessageIdsRef.current = stableActiveHistoryMessageIds;
  }, [stableActiveHistoryMessageIds]);

  useEffect(() => {
    bookmarkStateRequestKeyRef.current = bookmarkStateRequestKey;
  }, [bookmarkStateRequestKey]);

  useEffect(() => {
    const visibleMessageIds = new Set(detailMessages.map((message) => message.id));
    setMessageExpansionOverrides((current) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [messageId, expanded] of Object.entries(current)) {
        if (!visibleMessageIds.has(messageId)) {
          changed = true;
          continue;
        }
        next[messageId] = expanded;
      }
      return changed ? next : current;
    });
  }, [detailMessages]);

  useEffect(() => {
    if (!selectedProjectId) {
      setVisibleBookmarkedMessageIds([]);
      return;
    }
    if (historyMode === "bookmarks" && historyDetailMode !== "turn") {
      setVisibleBookmarkedMessageIds(
        bookmarksResponse.projectId === selectedProjectId
          ? bookmarksResponse.results.map((entry) => entry.message.id)
          : [],
      );
      return;
    }

    if (stableActiveHistoryMessageIds.length === 0) {
      setVisibleBookmarkedMessageIds([]);
      return;
    }

    let cancelled = false;
    const requestKey = bookmarkStateRequestKey;
    const loadBookmarkStates = async () => {
      const collected = new Set<string>();
      for (
        let index = 0;
        index < stableActiveHistoryMessageIds.length;
        index += MESSAGE_ID_BATCH_SIZE
      ) {
        const batch = stableActiveHistoryMessageIds.slice(index, index + MESSAGE_ID_BATCH_SIZE);
        const response = await codetrail.invoke("bookmarks:getStates", {
          projectId: selectedProjectId,
          messageIds: batch,
        });
        for (const messageId of response.bookmarkedMessageIds) {
          collected.add(messageId);
        }
      }
      return Array.from(collected);
    };

    void loadBookmarkStates()
      .then((bookmarkedMessageIds) => {
        if (!cancelled && bookmarkStateRequestKeyRef.current === requestKey) {
          setVisibleBookmarkedMessageIds(bookmarkedMessageIds);
        }
      })
      .catch(() => {
        if (!cancelled && bookmarkStateRequestKeyRef.current === requestKey) {
          setVisibleBookmarkedMessageIds([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bookmarkStateRequestKey,
    bookmarksResponse.projectId,
    bookmarksResponse.results,
    codetrail,
    historyDetailMode,
    historyMode,
    selectedProjectId,
    stableActiveHistoryMessageIds,
  ]);

  const refreshVisibleBookmarkStates = useCallback(() => {
    setBookmarkStatesRefreshNonce((value) => value + 1);
  }, []);

  useHistoryViewportEffects({
    messageListRef,
    historyMode,
    selectedProjectId,
    selectedSessionId,
    sessionPage,
    setSessionScrollTop,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
    refreshContextRef,
    pendingAutoScrollRef,
    prevMessageIdsRef,
    activeHistoryMessages: detailMessages,
    activeMessageSortDirection,
    focusMessageId,
    visibleFocusedMessageId,
    focusedMessagePosition,
    focusedMessageRef,
    pendingMessageAreaFocus,
    setPendingMessageAreaFocus,
    pendingMessagePageNavigation,
    loadedHistoryPage,
    setPendingMessagePageNavigation,
    setFocusMessageId,
    scrollPreservationRef,
  });

  const {
    handleToggleHistoryCategoryShortcut: handleToggleHistoryCategoryShortcutFlat,
    handleSoloHistoryCategoryShortcut: handleSoloHistoryCategoryShortcutFlat,
    handleTogglePrimaryHistoryCategoriesShortcut: handleTogglePrimaryHistoryCategoriesShortcutFlat,
    handleToggleAllHistoryCategoriesShortcut: handleToggleAllHistoryCategoriesShortcutFlat,
    handleFocusPrimaryHistoryCategoriesShortcut: handleFocusPrimaryHistoryCategoriesShortcutFlat,
    handleFocusAllHistoryCategoriesShortcut: handleFocusAllHistoryCategoriesShortcutFlat,
    handleToggleVisibleCategoryMessagesExpanded,
    handleToggleCategoryDefaultExpansion: handleToggleCategoryDefaultExpansionFlat,
    handleToggleMessageExpanded,
    handleRevealInSession,
    handleRevealInProject,
    handleRevealInBookmarks,
    handleToggleBookmark,
    handleMessageListScroll,
    handleHistorySearchKeyDown,
    selectProjectAllMessages,
    selectBookmarksView,
    openProjectBookmarksView,
    closeBookmarksView,
    selectSessionView,
    selectAdjacentSession,
    selectAdjacentProject,
    handleProjectTreeArrow,
    handleProjectTreeEnter,
    goToHistoryPage,
    goToFirstHistoryPage,
    goToLastHistoryPage,
    goToPreviousHistoryPage,
    goToNextHistoryPage,
    focusAdjacentHistoryMessage,
    handleCopySessionDetails,
    handleCopyProjectDetails,
    focusSessionSearch,
    handleRefresh,
    navigateFromSearchResult,
  } = useHistoryInteractions({
    codetrail,
    logError,
    setMessageExpanded: setMessageExpansionOverrides,
    setHistoryCategories,
    historyCategoriesRef,
    historyCategorySoloRestoreRef,
    setExpandedByDefaultCategories,
    setSessionPage,
    isExpandedByDefault,
    historyMode: uiHistoryMode,
    historyVisualization,
    selection,
    bookmarkReturnSelection,
    bookmarksResponse,
    activeHistoryMessages: detailMessages,
    selectedProjectId: uiSelectedProjectId,
    historyCategories,
    setPendingSearchNavigation,
    setSessionQueryInput,
    setBookmarkQueryInput,
    setFocusMessageId,
    setPendingRevealTarget,
    loadBookmarks,
    sessionScrollTopRef,
    sessionScrollSyncTimerRef,
    setSessionScrollTop,
    messageListRef,
    setPendingMessageAreaFocus,
    setPendingMessagePageNavigation,
    setHistorySelection: (value, options) =>
      setHistorySelectionWithCommitMode(
        value,
        options?.commitMode ?? "immediate",
        options?.waitForKeyboardIdle ?? false,
      ),
    setHistoryVisualization,
    setBookmarkReturnSelection,
    sessionListRef,
    selectedSessionId: uiSelectedSessionId,
    sessionPaneNavigationItems,
    projectListRef,
    sortedProjects,
    projectViewMode,
    canNavigatePages,
    totalPages,
    canGoToNextHistoryPage,
    canGoToPreviousHistoryPage,
    visibleFocusedMessageId,
    sessionPage,
    messagePageSize: appearance.messagePageSize,
    selectedSession,
    selectedProject,
    sessionDetailTotalCount: sessionDetail?.totalCount,
    allSessionsCount,
    sessionSearchInputRef,
    projectPaneCollapsed,
    setProjectPaneCollapsed,
    sessionPaneCollapsed,
    hideSessionsPaneForTreeView,
    setProjectViewMode,
    setAutoRevealSessionRequest,
    loadProjects,
    loadSessions,
    refreshVisibleBookmarkStates,
    setProjectProviders,
    setProjectQueryInput,
    refreshContextRef,
    refreshTreeProjectSessions,
    pendingProjectPaneFocusCommitModeRef,
    pendingProjectPaneFocusWaitForKeyboardIdleRef,
    queueProjectTreeNoopCommit,
    treeFocusedRow,
    setTreeFocusedRow,
    focusSessionPane: () => focusHistoryPane("session"),
  });

  const clearTurnViewState = useCallback(() => {
    setTurnAnchorMessageId("");
    setTurnSourceSessionId("");
    setSessionTurnDetail(null);
    setTurnViewCombinedChangesExpandedOverride(null);
    turnScopeKeyRef.current = "";
  }, []);

  const handleRevealInSessionWithTurnExit = useCallback(
    (messageId: string, sourceId: string) => {
      setHistoryVisualization("messages");
      clearTurnViewState();
      handleRevealInSession(messageId, sourceId);
    },
    [clearTurnViewState, handleRevealInSession],
  );

  const handleRevealInProjectWithTurnExit = useCallback(
    (messageId: string, sourceId: string, sessionId: string) => {
      setHistoryVisualization("messages");
      clearTurnViewState();
      handleRevealInProject(messageId, sourceId, sessionId);
    },
    [clearTurnViewState, handleRevealInProject],
  );

  const handleRevealInBookmarksWithTurnExit = useCallback(
    (messageId: string, sourceId: string) => {
      clearTurnViewState();
      handleRevealInBookmarks(messageId, sourceId);
    },
    [clearTurnViewState, handleRevealInBookmarks],
  );

  const handleToggleProjectExpansion = useCallback(
    (projectId: string) => {
      const collapsingSelectedSessionProject =
        expandedProjectIds.includes(projectId) &&
        uiHistoryMode === "session" &&
        uiSelectedProjectId === projectId &&
        uiSelectedSessionId.length > 0;

      if (collapsingSelectedSessionProject) {
        selectProjectAllMessages(projectId, { commitMode: "immediate" });
      }

      toggleTreeProjectExpansion(projectId);
    },
    [
      expandedProjectIds,
      selectProjectAllMessages,
      toggleTreeProjectExpansion,
      uiHistoryMode,
      uiSelectedProjectId,
      uiSelectedSessionId,
    ],
  );

  const buildTurnScopeRequestBase = useCallback(
    (selectionState: HistorySelection) => ({
      scopeMode: selectionState.mode,
      ...(selectionState.projectId ? { projectId: selectionState.projectId } : {}),
      ...(selectionState.mode === "session" ? { sessionId: selectionState.sessionId } : {}),
    }),
    [],
  );

  const loadTurnDetail = useCallback(
    async (
      request: Pick<
        IpcRequestInput<"sessions:getTurn">,
        "sessionId" | "anchorMessageId" | "turnNumber" | "latest"
      >,
      options: {
        queryOverride?: string;
        scopeSelection?: HistorySelection;
      } = {},
    ) => {
      const scopeSelection = options.scopeSelection ?? turnVisualizationSelection;
      const response = await codetrail.invoke("sessions:getTurn", {
        ...buildTurnScopeRequestBase(scopeSelection),
        ...request,
        query: options.queryOverride ?? effectiveTurnQuery,
        searchMode,
        sortDirection: turnViewSortDirection,
      });
      return response;
    },
    [
      buildTurnScopeRequestBase,
      codetrail,
      effectiveTurnQuery,
      searchMode,
      turnViewSortDirection,
      turnVisualizationSelection,
    ],
  );

  const loadResolvedTurnDetail = useCallback(
    async (
      request: Pick<
        IpcRequestInput<"sessions:getTurn">,
        "sessionId" | "anchorMessageId" | "turnNumber" | "latest"
      >,
      options: {
        queryOverride?: string;
        scopeSelection?: HistorySelection;
      } = {},
    ) => {
      const response = await loadTurnDetail(request, options);
      if (response.totalTurns === 0 || response.turnNumber > 0) {
        return response;
      }

      const fallbackRequest =
        turnViewSortDirection === "desc" ? { latest: true } : { turnNumber: 1 as const };
      const requestedTurnNumber =
        typeof request.turnNumber === "number" ? request.turnNumber : null;
      if (
        (fallbackRequest.latest === true && request.latest === true) ||
        (requestedTurnNumber !== null && requestedTurnNumber === fallbackRequest.turnNumber)
      ) {
        return response;
      }
      return loadTurnDetail(fallbackRequest, options);
    },
    [loadTurnDetail, turnViewSortDirection],
  );

  const handleRevealInTurn = useCallback(
    (message: HistoryMessage) => {
      if (!selectedProjectId) {
        return;
      }
      const nextSelection = createHistorySelection("session", selectedProjectId, message.sessionId);
      if (!areHistorySelectionsEqual(currentUiHistorySelection, nextSelection)) {
        setHistorySelectionImmediate(nextSelection);
      }
      setHistoryVisualization("turns");
      setTurnAnchorMessageId(message.id);
      setTurnSourceSessionId(message.sessionId);
      setTurnQueryInput("");
      setSessionTurnDetail(null);
      setFocusMessageId(message.id);
    },
    [currentUiHistorySelection, selectedProjectId, setHistorySelectionImmediate],
  );

  const handleSelectMessagesView = useCallback(() => {
    setHistoryVisualization("messages");
  }, []);

  const handleSelectTurnsView = useCallback(async () => {
    if (historyDetailMode === "turn") {
      return;
    }
    if (!canToggleTurnView) {
      return;
    }
    if (!areHistorySelectionsEqual(currentUiHistorySelection, turnVisualizationSelection)) {
      setHistorySelectionImmediate(turnVisualizationSelection);
    }
    setHistoryVisualization("turns");
    setFocusMessageId("");
  }, [
    canToggleTurnView,
    currentUiHistorySelection,
    historyDetailMode,
    setHistorySelectionImmediate,
    turnVisualizationSelection,
  ]);

  const handleToggleTurnView = useCallback(async () => {
    if (historyDetailMode === "turn") {
      handleSelectMessagesView();
      return;
    }
    await handleSelectTurnsView();
  }, [handleSelectMessagesView, handleSelectTurnsView, historyDetailMode]);

  const handleSelectBookmarksVisualization = useCallback(() => {
    if (!currentUiHistorySelection.projectId) {
      return;
    }
    setHistoryVisualization("bookmarks");
    setHistorySelectionImmediate(
      createHistorySelection("bookmarks", currentUiHistorySelection.projectId, uiSelectedSessionId),
    );
  }, [currentUiHistorySelection.projectId, setHistorySelectionImmediate, uiSelectedSessionId]);

  const handleToggleBookmarksView = useCallback(() => {
    if (historyMode === "bookmarks" && historyDetailMode !== "turn") {
      handleSelectMessagesView();
      return;
    }
    handleSelectBookmarksVisualization();
  }, [
    handleSelectBookmarksVisualization,
    handleSelectMessagesView,
    historyDetailMode,
    historyMode,
  ]);

  const handleCycleHistoryVisualization = useCallback(async () => {
    if (historyVisualization === "messages") {
      if (canToggleTurnView) {
        await handleSelectTurnsView();
        return;
      }
      handleSelectBookmarksVisualization();
      return;
    }
    if (historyVisualization === "turns") {
      handleSelectBookmarksVisualization();
      return;
    }
    handleSelectMessagesView();
  }, [
    canToggleTurnView,
    handleSelectBookmarksVisualization,
    handleSelectMessagesView,
    handleSelectTurnsView,
    historyVisualization,
  ]);

  useEffect(() => {
    if (turnScopeKeyRef.current === "" && historyDetailMode === "turn") {
      turnScopeKeyRef.current = currentTurnScopeKey;
      return;
    }
    if (turnScopeKeyRef.current === "") {
      return;
    }
    if (turnScopeKeyRef.current === currentTurnScopeKey) {
      return;
    }
    clearTurnViewState();
    setFocusMessageId("");
  }, [clearTurnViewState, currentTurnScopeKey, historyDetailMode]);

  useEffect(() => {
    if (historyDetailMode !== "turn") {
      setSessionTurnDetail(null);
      return;
    }
    if (!canToggleTurnView) {
      setSessionTurnDetail(null);
      return;
    }

    void turnDetailRefreshNonce;
    let cancelled = false;
    const request =
      turnAnchorMessageId.length > 0
        ? { anchorMessageId: turnAnchorMessageId }
        : turnViewSortDirection === "desc"
          ? { latest: true }
          : { turnNumber: 1 };
    void loadResolvedTurnDetail(request)
      .then((response) => {
        if (!cancelled) {
          setSessionTurnDetail(response);
          setTurnAnchorMessageId(response.anchorMessageId ?? "");
          setTurnSourceSessionId(response.session?.id ?? "");
        }
      })
      .catch((error: unknown) => {
        if (!shouldIgnoreAsyncEffectError(cancelled, error)) {
          logError("Failed loading session turn", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    canToggleTurnView,
    historyDetailMode,
    loadResolvedTurnDetail,
    logError,
    turnAnchorMessageId,
    turnDetailRefreshNonce,
    turnViewSortDirection,
  ]);

  const navigateToTurn = useCallback(
    async (
      request: Pick<
        IpcRequestInput<"sessions:getTurn">,
        "anchorMessageId" | "turnNumber" | "latest"
      >,
      options: { queryOverride?: string } = {},
    ) => {
      try {
        const response = await loadResolvedTurnDetail(request, options);
        setSessionTurnDetail(response);
        setTurnAnchorMessageId(response.anchorMessageId ?? "");
        setTurnSourceSessionId(response.session?.id ?? "");
        return response;
      } catch (error) {
        logError("Failed loading session turn", error);
        return null;
      }
    },
    [loadResolvedTurnDetail, logError],
  );

  const goToPreviousTurn = useCallback(async () => {
    const targetAnchorMessageId =
      turnViewSortDirection === "desc"
        ? sessionTurnDetail?.nextTurnAnchorMessageId
        : sessionTurnDetail?.previousTurnAnchorMessageId;
    if (!targetAnchorMessageId) {
      return;
    }
    await navigateToTurn({
      anchorMessageId: targetAnchorMessageId,
    });
  }, [
    navigateToTurn,
    sessionTurnDetail?.nextTurnAnchorMessageId,
    sessionTurnDetail?.previousTurnAnchorMessageId,
    turnViewSortDirection,
  ]);

  const goToNextTurn = useCallback(async () => {
    const targetAnchorMessageId =
      turnViewSortDirection === "desc"
        ? sessionTurnDetail?.previousTurnAnchorMessageId
        : sessionTurnDetail?.nextTurnAnchorMessageId;
    if (!targetAnchorMessageId) {
      return;
    }
    await navigateToTurn({
      anchorMessageId: targetAnchorMessageId,
    });
  }, [
    navigateToTurn,
    sessionTurnDetail?.nextTurnAnchorMessageId,
    sessionTurnDetail?.previousTurnAnchorMessageId,
    turnViewSortDirection,
  ]);

  const goToFirstTurn = useCallback(async () => {
    const targetAnchorMessageId =
      turnViewSortDirection === "desc"
        ? sessionTurnDetail?.latestTurnAnchorMessageId
        : sessionTurnDetail?.firstTurnAnchorMessageId;
    if (!targetAnchorMessageId) {
      return;
    }
    await navigateToTurn({
      anchorMessageId: targetAnchorMessageId,
    });
  }, [
    navigateToTurn,
    sessionTurnDetail?.firstTurnAnchorMessageId,
    sessionTurnDetail?.latestTurnAnchorMessageId,
    turnViewSortDirection,
  ]);

  const goToLatestTurn = useCallback(async () => {
    const targetAnchorMessageId =
      turnViewSortDirection === "desc"
        ? sessionTurnDetail?.firstTurnAnchorMessageId
        : sessionTurnDetail?.latestTurnAnchorMessageId;
    if (!targetAnchorMessageId) {
      return;
    }
    await navigateToTurn({
      anchorMessageId: targetAnchorMessageId,
    });
  }, [
    navigateToTurn,
    sessionTurnDetail?.firstTurnAnchorMessageId,
    sessionTurnDetail?.latestTurnAnchorMessageId,
    turnViewSortDirection,
  ]);

  const goToTurnNumber = useCallback(
    async (page: number) => {
      if (historyDetailMode !== "turn") {
        goToHistoryPage(page);
        return;
      }
      const displayPageNumber = Math.max(1, Math.min(turnTotalPages, Math.trunc(page) + 1));
      const targetTurnNumber =
        turnViewSortDirection === "desc"
          ? turnTotalPages - displayPageNumber + 1
          : displayPageNumber;
      await navigateToTurn({ turnNumber: targetTurnNumber });
    },
    [goToHistoryPage, historyDetailMode, navigateToTurn, turnTotalPages, turnViewSortDirection],
  );

  const resetVisibleHistoryFilters = useCallback(() => {
    if (historyDetailMode === "turn") {
      setTurnQueryInput("");
      return;
    }
    if (historyMode === "bookmarks") {
      setBookmarkQueryInput("");
      return;
    }
    setSessionQueryInput("");
    setSessionPage(0);
  }, [historyDetailMode, historyMode]);

  const handleSecondaryMessagePaneEscape = useCallback(() => {
    const activeQuery =
      historyDetailMode === "turn"
        ? turnQueryInput.trim()
        : historyMode === "bookmarks"
          ? bookmarkQueryInput.trim()
          : sessionQueryInput.trim();
    if (activeQuery.length > 0) {
      resetVisibleHistoryFilters();
      return true;
    }
    return false;
  }, [
    bookmarkQueryInput,
    historyDetailMode,
    historyMode,
    resetVisibleHistoryFilters,
    sessionQueryInput,
    turnQueryInput,
  ]);

  const handleToggleHistoryCategoryShortcut = useCallback(
    (category: MessageCategory) => {
      if (historyDetailMode !== "turn") {
        handleToggleHistoryCategoryShortcutFlat(category);
        return;
      }
      turnViewCategorySoloRestoreRef.current = null;
      setTurnViewCategories((current) => {
        const exists = current.includes(category);
        const next = exists ? current.filter((item) => item !== category) : [...current, category];
        turnViewCategoriesRef.current = next;
        return next;
      });
    },
    [handleToggleHistoryCategoryShortcutFlat, historyDetailMode],
  );

  const handleSoloHistoryCategoryShortcut = useCallback(
    (category: MessageCategory) => {
      if (historyDetailMode !== "turn") {
        handleSoloHistoryCategoryShortcutFlat(category);
        return;
      }

      const currentCategories = turnViewCategoriesRef.current;
      const restoreState = turnViewCategorySoloRestoreRef.current;
      const isCurrentSoloState =
        currentCategories.length === 1 && currentCategories[0] === category;
      const restoreCategories =
        restoreState?.mode === `solo:${category}` ? restoreState.categories : null;
      const hasUsefulRestore =
        Array.isArray(restoreCategories) &&
        (restoreCategories.length !== currentCategories.length ||
          restoreCategories.some((item, index) => item !== currentCategories[index]));

      const nextCategories = isCurrentSoloState
        ? hasUsefulRestore
          ? [...restoreCategories]
          : [...DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES]
        : [category];

      turnViewCategorySoloRestoreRef.current = isCurrentSoloState
        ? null
        : {
            mode: `solo:${category}`,
            categories: [...currentCategories],
          };
      turnViewCategoriesRef.current = nextCategories;
      setTurnViewCategories(nextCategories);
    },
    [handleSoloHistoryCategoryShortcutFlat, historyDetailMode],
  );

  const handleTogglePrimaryHistoryCategoriesShortcut = useCallback(() => {
    if (historyDetailMode !== "turn") {
      handleTogglePrimaryHistoryCategoriesShortcutFlat();
      return;
    }

    const currentCategories = turnViewCategoriesRef.current;
    const targetCategories = new Set(TURN_PRIMARY_HISTORY_CATEGORIES);
    const hasAllPrimary = TURN_PRIMARY_HISTORY_CATEGORIES.every((category) =>
      currentCategories.includes(category),
    );
    const nextCategories = hasAllPrimary
      ? currentCategories.filter((category) => !targetCategories.has(category))
      : [
          ...currentCategories.filter((category) => !targetCategories.has(category)),
          ...TURN_PRIMARY_HISTORY_CATEGORIES,
        ];
    turnViewCategorySoloRestoreRef.current = null;
    turnViewCategoriesRef.current = nextCategories;
    setTurnViewCategories(nextCategories);
  }, [handleTogglePrimaryHistoryCategoriesShortcutFlat, historyDetailMode]);

  const handleToggleAllHistoryCategoriesShortcut = useCallback(() => {
    if (historyDetailMode !== "turn") {
      handleToggleAllHistoryCategoriesShortcutFlat();
      return;
    }

    const currentCategories = turnViewCategoriesRef.current;
    const nextCategories =
      currentCategories.length === CATEGORIES.length &&
      currentCategories.every((category, index) => category === CATEGORIES[index])
        ? []
        : [...CATEGORIES];
    turnViewCategorySoloRestoreRef.current = null;
    turnViewCategoriesRef.current = nextCategories;
    setTurnViewCategories(nextCategories);
  }, [handleToggleAllHistoryCategoriesShortcutFlat, historyDetailMode]);

  const handleFocusPrimaryHistoryCategoriesShortcut = useCallback(() => {
    if (historyDetailMode !== "turn") {
      handleFocusPrimaryHistoryCategoriesShortcutFlat();
      return;
    }

    const currentCategories = turnViewCategoriesRef.current;
    const restoreState = turnViewCategorySoloRestoreRef.current;
    const primaryCategories = [...TURN_PRIMARY_HISTORY_CATEGORIES];
    const isCurrentPreset =
      currentCategories.length === primaryCategories.length &&
      currentCategories.every((category, index) => category === primaryCategories[index]);
    const restoreCategories =
      restoreState?.mode === "preset:primary" ? restoreState.categories : null;
    const hasUsefulRestore =
      Array.isArray(restoreCategories) &&
      (restoreCategories.length !== currentCategories.length ||
        restoreCategories.some((item, index) => item !== currentCategories[index]));
    const nextCategories = isCurrentPreset
      ? hasUsefulRestore
        ? [...restoreCategories]
        : [...DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES]
      : primaryCategories;
    turnViewCategorySoloRestoreRef.current = isCurrentPreset
      ? null
      : {
          mode: "preset:primary",
          categories: [...currentCategories],
        };
    turnViewCategoriesRef.current = nextCategories;
    setTurnViewCategories(nextCategories);
  }, [handleFocusPrimaryHistoryCategoriesShortcutFlat, historyDetailMode]);

  const handleFocusAllHistoryCategoriesShortcut = useCallback(() => {
    if (historyDetailMode !== "turn") {
      handleFocusAllHistoryCategoriesShortcutFlat();
      return;
    }

    const currentCategories = turnViewCategoriesRef.current;
    const restoreState = turnViewCategorySoloRestoreRef.current;
    const isCurrentPreset =
      currentCategories.length === CATEGORIES.length &&
      currentCategories.every((category, index) => category === CATEGORIES[index]);
    const restoreCategories = restoreState?.mode === "preset:all" ? restoreState.categories : null;
    const hasUsefulRestore =
      Array.isArray(restoreCategories) &&
      (restoreCategories.length !== currentCategories.length ||
        restoreCategories.some((item, index) => item !== currentCategories[index]));
    const nextCategories = isCurrentPreset
      ? hasUsefulRestore
        ? [...restoreCategories]
        : [...DEFAULT_TURN_VIEW_MESSAGE_CATEGORIES]
      : [...CATEGORIES];
    turnViewCategorySoloRestoreRef.current = isCurrentPreset
      ? null
      : {
          mode: "preset:all",
          categories: [...currentCategories],
        };
    turnViewCategoriesRef.current = nextCategories;
    setTurnViewCategories(nextCategories);
  }, [handleFocusAllHistoryCategoriesShortcutFlat, historyDetailMode]);

  const handleToggleCategoryDefaultExpansion = useCallback(
    (category: MessageCategory) => {
      if (historyDetailMode !== "turn") {
        handleToggleCategoryDefaultExpansionFlat(category);
        return;
      }

      setTurnViewExpandedByDefaultCategories((current) =>
        current.includes(category)
          ? current.filter((item) => item !== category)
          : [...current, category],
      );
      setMessageExpansionOverrides((current) => {
        const next = { ...current };
        for (const message of turnVisibleMessages) {
          if (message.category !== category || !(message.id in next)) {
            continue;
          }
          delete next[message.id];
        }
        return next;
      });
    },
    [handleToggleCategoryDefaultExpansionFlat, historyDetailMode, turnVisibleMessages],
  );
  const isTurnExpandedByDefault = useCallback(
    (category: MessageCategory) => turnViewExpandedByDefaultCategories.includes(category),
    [turnViewExpandedByDefaultCategories],
  );

  const effectiveTurnCombinedChangesExpanded =
    turnViewCombinedChangesExpandedOverride ?? turnViewCombinedChangesExpanded;

  const handleToggleVisibleCategoryMessagesExpandedInTurn = useCallback(
    (category: MessageCategory) => {
      const categoryMessages = turnVisibleMessages.filter(
        (message) => message.category === category,
      );
      if (categoryMessages.length === 0) {
        return;
      }
      setMessageExpansionOverrides((current) => {
        const expanded = !categoryMessages.every(
          (message) => current[message.id] ?? isTurnExpandedByDefault(message.category),
        );
        const next = { ...current };
        for (const message of categoryMessages) {
          if (expanded === isTurnExpandedByDefault(message.category)) {
            delete next[message.id];
          } else {
            next[message.id] = expanded;
          }
        }
        return next;
      });
    },
    [isTurnExpandedByDefault, turnVisibleMessages],
  );

  const handleToggleMessageExpandedInTurn = useCallback(
    (messageId: string, category: MessageCategory) => {
      setMessageExpansionOverrides((current) => {
        const nextExpanded = !(current[messageId] ?? isTurnExpandedByDefault(category));
        const next = { ...current };
        if (nextExpanded === isTurnExpandedByDefault(category)) {
          delete next[messageId];
        } else {
          next[messageId] = nextExpanded;
        }
        return next;
      });
    },
    [isTurnExpandedByDefault],
  );

  const visibleExpansionItems = useMemo(
    () => [
      ...detailMessages.map((message) => {
        const defaultExpanded =
          historyDetailMode === "turn"
            ? turnViewExpandedByDefaultCategories.includes(message.category)
            : isExpandedByDefault(message.category);
        const currentExpanded = messageExpansionOverrides[message.id] ?? defaultExpanded;
        const atDefault = !(message.id in messageExpansionOverrides);
        return {
          id: message.id,
          currentExpanded,
          defaultExpanded,
          atDefault,
        };
      }),
      ...(historyDetailMode === "turn"
        ? [
            {
              id: "__combined_changes__",
              currentExpanded: effectiveTurnCombinedChangesExpanded,
              defaultExpanded: turnViewCombinedChangesExpanded,
              atDefault: turnViewCombinedChangesExpandedOverride === null,
            },
          ]
        : []),
    ],
    [
      detailMessages,
      effectiveTurnCombinedChangesExpanded,
      historyDetailMode,
      isExpandedByDefault,
      messageExpansionOverrides,
      turnViewCombinedChangesExpanded,
      turnViewCombinedChangesExpandedOverride,
      turnViewExpandedByDefaultCategories,
    ],
  );
  const visibleExpansionScopeKey = useMemo(
    () =>
      historyDetailMode === "turn"
        ? [
            "turn",
            historyVisualization,
            currentTurnScopeKey,
            sessionTurnDetail?.anchorMessageId ?? "",
            turnViewSortDirection,
            effectiveTurnQuery,
            turnViewCategories.join(","),
            turnViewExpandedByDefaultCategories.join(","),
            turnViewCombinedChangesExpanded ? "1" : "0",
          ].join("\u0000")
        : [
            "flat",
            historyVisualization,
            historyMode,
            selectedProjectId,
            selectedSessionId,
            loadedHistoryPage,
            activeMessageSortDirection,
            historyCategories.join(","),
            expandedByDefaultCategories.join(","),
            historyMode === "bookmarks" ? effectiveBookmarkQuery : effectiveSessionQuery,
          ].join("\u0000"),
    [
      activeMessageSortDirection,
      currentTurnScopeKey,
      effectiveBookmarkQuery,
      effectiveSessionQuery,
      effectiveTurnQuery,
      expandedByDefaultCategories,
      historyDetailMode,
      historyMode,
      historyVisualization,
      historyCategories,
      loadedHistoryPage,
      selectedProjectId,
      selectedSessionId,
      sessionTurnDetail?.anchorMessageId,
      turnViewCategories,
      turnViewCombinedChangesExpanded,
      turnViewExpandedByDefaultCategories,
      turnViewSortDirection,
    ],
  );

  useEffect(() => {
    const scopeChanged = visibleExpansionScopeKeyRef.current !== visibleExpansionScopeKey;
    const becamePopulated =
      visibleExpansionItemCountRef.current === 0 && visibleExpansionItems.length > 0;
    visibleExpansionItemCountRef.current = visibleExpansionItems.length;
    if (!scopeChanged && !becamePopulated) {
      return;
    }
    visibleExpansionScopeKeyRef.current = visibleExpansionScopeKey;
    setVisibleExpansionActionState(deriveVisibleExpansionAction(visibleExpansionItems));
  }, [visibleExpansionItems, visibleExpansionScopeKey]);

  const handleToggleAllCategoryDefaultExpansion = useCallback(() => {
    if (visibleExpansionItems.length === 0) {
      return;
    }
    const action = visibleExpansionActionState;
    if (action === "restore") {
      setMessageExpansionOverrides((current) => {
        const next = { ...current };
        let changed = false;
        for (const item of visibleExpansionItems) {
          if (item.id === "__combined_changes__") {
            continue;
          }
          if (!(item.id in next)) {
            continue;
          }
          delete next[item.id];
          changed = true;
        }
        return changed ? next : current;
      });
      if (historyDetailMode === "turn") {
        setTurnViewCombinedChangesExpandedOverride(null);
      }
      setVisibleExpansionActionState(getNextVisibleExpansionAction(action));
      return;
    }

    const expanded = action === "expand";
    setMessageExpansionOverrides((current) => {
      const next = { ...current };
      let changed = false;
      for (const item of visibleExpansionItems) {
        if (item.id === "__combined_changes__") {
          continue;
        }
        if (expanded === item.defaultExpanded) {
          if (item.id in next) {
            delete next[item.id];
            changed = true;
          }
          continue;
        }
        if (next[item.id] !== expanded) {
          next[item.id] = expanded;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    if (historyDetailMode === "turn") {
      setTurnViewCombinedChangesExpandedOverride(
        expanded === turnViewCombinedChangesExpanded ? null : expanded,
      );
    }
    setVisibleExpansionActionState(getNextVisibleExpansionAction(action));
  }, [
    historyDetailMode,
    turnViewCombinedChangesExpanded,
    visibleExpansionActionState,
    visibleExpansionItems,
  ]);

  const areAllMessagesExpanded =
    visibleExpansionItems.length > 0 && visibleExpansionItems.every((item) => item.currentExpanded);
  const globalExpandCollapseLabel =
    visibleExpansionActionState === "collapse"
      ? "Collapse"
      : visibleExpansionActionState === "restore"
        ? "Restore"
        : "Expand";
  const globalExpandCollapseIconName: "collapseAll" | "zoomReset" | "expandAll" =
    visibleExpansionActionState === "collapse"
      ? "collapseAll"
      : visibleExpansionActionState === "restore"
        ? "zoomReset"
        : "expandAll";
  const effectiveHistoryPage = historyDetailMode === "turn" ? turnDisplayPage : sessionPage;
  const effectiveTotalPages = historyDetailMode === "turn" ? turnTotalPages : totalPages;
  const effectiveCanNavigatePages =
    historyDetailMode === "turn" ? turnTotalPages > 1 : canNavigatePages;
  const effectiveCanGoToPreviousHistoryPage =
    historyDetailMode === "turn"
      ? turnViewSortDirection === "desc"
        ? Boolean(sessionTurnDetail?.nextTurnAnchorMessageId)
        : Boolean(sessionTurnDetail?.previousTurnAnchorMessageId)
      : canGoToPreviousHistoryPage;
  const effectiveCanGoToNextHistoryPage =
    historyDetailMode === "turn"
      ? turnViewSortDirection === "desc"
        ? Boolean(sessionTurnDetail?.previousTurnAnchorMessageId)
        : Boolean(sessionTurnDetail?.nextTurnAnchorMessageId)
      : canGoToNextHistoryPage;

  const goToPreviousHistoryPageEffective = useCallback(() => {
    if (historyDetailMode === "turn") {
      void goToPreviousTurn();
      return;
    }
    goToPreviousHistoryPage();
  }, [goToPreviousHistoryPage, goToPreviousTurn, historyDetailMode]);

  const goToNextHistoryPageEffective = useCallback(() => {
    if (historyDetailMode === "turn") {
      void goToNextTurn();
      return;
    }
    goToNextHistoryPage();
  }, [goToNextHistoryPage, goToNextTurn, historyDetailMode]);

  const goToFirstHistoryPageEffective = useCallback(() => {
    if (historyDetailMode === "turn") {
      void goToFirstTurn();
      return;
    }
    goToFirstHistoryPage();
  }, [goToFirstHistoryPage, goToFirstTurn, historyDetailMode]);

  const goToLastHistoryPageEffective = useCallback(() => {
    if (historyDetailMode === "turn") {
      void goToLatestTurn();
      return;
    }
    goToLastHistoryPage();
  }, [goToLastHistoryPage, goToLatestTurn, historyDetailMode]);

  const pageHistoryMessages = useCallback(
    (direction: "up" | "down", { preserveFocus = false }: { preserveFocus?: boolean } = {}) => {
      const container = messageListRef.current;
      if (!container) {
        return;
      }

      const styles = window.getComputedStyle(container);
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const visibleContentHeight = container.clientHeight - paddingTop - paddingBottom;
      const pageSize = Math.max(0, visibleContentHeight - MESSAGE_PAGE_SCROLL_OVERLAP_PX);
      if (pageSize <= 0) {
        return;
      }

      const delta = direction === "down" ? pageSize : -pageSize;
      const nextScrollTop = Math.max(0, container.scrollTop + delta);
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: nextScrollTop });
      } else {
        container.scrollTop = nextScrollTop;
      }
      if (!preserveFocus) {
        container.focus({ preventScroll: true });
      }
    },
    [],
  );

  useEffect(() => {
    return codetrail.onHistoryExportProgress((progress: HistoryExportProgressPayload) => {
      setHistoryExportState((current) =>
        current.exportId !== progress.exportId
          ? current
          : {
              ...current,
              percent: progress.percent,
              phase: progress.phase,
              message: progress.message,
            },
      );
    });
  }, [codetrail]);

  const handleExportMessages = useCallback(
    async ({ scope }: { scope: HistoryExportScope }) => {
      if (historyDetailMode === "turn") {
        return {
          canceled: true,
          path: null,
        };
      }
      if (!selectedProjectId) {
        return {
          canceled: true,
          path: null,
        };
      }

      const exportId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      setHistoryExportState({
        open: true,
        exportId,
        scope,
        percent: 1,
        phase: "preparing",
        message: "Preparing export…",
      });

      try {
        const response = await codetrail.invoke("history:exportMessages", {
          exportId,
          mode: historyMode,
          projectId: selectedProjectId,
          ...(selectedSessionId ? { sessionId: selectedSessionId } : {}),
          page: loadedHistoryPage,
          pageSize: appearance.messagePageSize,
          categories: historyCategories,
          query: historyMode === "bookmarks" ? effectiveBookmarkQuery : effectiveSessionQuery,
          searchMode,
          sortDirection: activeMessageSortDirection,
          scope,
        });
        setHistoryExportState((current) =>
          current.exportId === exportId
            ? { ...current, open: false, exportId: null, percent: 100, message: "" }
            : current,
        );
        return response;
      } catch (error) {
        setHistoryExportState((current) =>
          current.exportId === exportId
            ? { ...current, open: false, exportId: null, message: "" }
            : current,
        );
        logError("History messages export failed", error);
        throw error;
      }
    },
    [
      activeMessageSortDirection,
      appearance.messagePageSize,
      codetrail,
      effectiveBookmarkQuery,
      effectiveSessionQuery,
      historyDetailMode,
      historyCategories,
      historyMode,
      loadedHistoryPage,
      logError,
      searchMode,
      selectedProjectId,
      selectedSessionId,
    ],
  );

  return {
    refs: {
      focusedMessageRef,
      messageListRef,
      sessionListRef,
      projectListRef,
      sessionSearchInputRef,
    },
    selection,
    historyMode,
    historyDetailMode,
    historyVisualization,
    selectedProjectId,
    selectedSessionId,
    uiHistoryMode,
    uiSelectedProjectId,
    uiSelectedSessionId,
    consumeProjectPaneFocusSelectionBehavior,
    paneStateHydrated,
    sortedProjects,
    projectUpdates,
    folderGroups,
    expandedFolderIdSet,
    expandedProjectIds,
    allVisibleFoldersExpanded,
    treeFocusedRow,
    setTreeFocusedRow,
    handleToggleFolder,
    handleToggleAllFolders,
    handleToggleProjectExpansion,
    sortedSessions,
    treeProjectSessionsByProjectId: sortedTreeProjectSessionsByProjectId,
    treeProjectSessionsLoadingByProjectId,
    selectedProject,
    selectedSession,
    enabledProviders,
    removeMissingSessionsDuringIncrementalIndexing,
    setRemoveMissingSessionsDuringIncrementalIndexing,
    projectProviders,
    setProjectProviders,
    projectQueryInput,
    setProjectQueryInput,
    projectProviderCounts,
    projectViewMode,
    setProjectViewMode,
    projectSortField,
    setProjectSortField,
    projectSortDirection,
    setProjectSortDirection,
    projectListUpdateSource,
    sessionSortDirection,
    setSessionSortDirection,
    messageSortDirection,
    setMessageSortDirection,
    bookmarkSortDirection,
    setBookmarkSortDirection,
    projectAllSortDirection,
    setProjectAllSortDirection,
    turnViewSortDirection,
    setTurnViewSortDirection,
    historyCategories,
    setHistoryCategories,
    expandedByDefaultCategories,
    setExpandedByDefaultCategories,
    turnViewCategories,
    setTurnViewCategories,
    turnViewExpandedByDefaultCategories,
    setTurnViewExpandedByDefaultCategories,
    turnViewCombinedChangesExpanded,
    setTurnViewCombinedChangesExpanded,
    setTurnViewCombinedChangesExpandedOverride,
    effectiveTurnCombinedChangesExpanded,
    liveWatchEnabled,
    setLiveWatchEnabled,
    liveWatchRowHasBackground,
    setLiveWatchRowHasBackground,
    claudeHooksPrompted,
    setClaudeHooksPrompted,
    systemMessageRegexRules,
    setSystemMessageRegexRules,
    preferredAutoRefreshStrategy,
    setPreferredAutoRefreshStrategy,
    projectPaneCollapsed,
    setProjectPaneCollapsed,
    sessionPaneCollapsed,
    setSessionPaneCollapsed,
    singleClickFoldersExpand,
    setSingleClickFoldersExpand,
    singleClickProjectsExpand,
    setSingleClickProjectsExpand,
    hideSessionsPaneInTreeView,
    setHideSessionsPaneInTreeView,
    hideSessionsPaneForTreeView,
    beginResize,
    workspaceStyle,
    sessionPaneNavigationItems,
    visibleSessionPaneSessions,
    visibleSessionPaneBookmarksCount,
    visibleSessionPaneAllSessionsCount,
    currentViewBookmarkCount,
    allSessionsCount,
    sessionDetail,
    sessionTurnDetail,
    turnAnchorMessage,
    turnVisibleMessages,
    turnCategoryCounts,
    projectCombinedDetail,
    bookmarksResponse,
    activeHistoryMessages,
    historyCategoryCounts,
    historyQueryError,
    historyHighlightPatterns,
    bookmarkedMessageIds,
    bookmarkOrphanedByMessageId,
    focusMessageId,
    setFocusMessageId,
    visibleFocusedMessageId,
    sessionPage: effectiveHistoryPage,
    messagePageSize: appearance.messagePageSize,
    setMessagePageSize: appearance.setMessagePageSize,
    loadedHistoryPage,
    setSessionPage,
    sessionQueryInput,
    setSessionQueryInput,
    bookmarkQueryInput,
    setBookmarkQueryInput,
    turnQueryInput,
    setTurnQueryInput,
    effectiveSessionQuery,
    effectiveBookmarkQuery,
    effectiveTurnQuery,
    totalPages: effectiveTotalPages,
    canNavigatePages: effectiveCanNavigatePages,
    canGoToPreviousHistoryPage: effectiveCanGoToPreviousHistoryPage,
    canGoToNextHistoryPage: effectiveCanGoToNextHistoryPage,
    activeMessageSortDirection,
    messageSortTooltip,
    areAllMessagesExpanded,
    globalExpandCollapseLabel,
    globalExpandCollapseIconName,
    messageExpansionOverrides,
    messagePathRoots,
    isExpandedByDefault,
    handleToggleHistoryCategoryShortcut,
    handleSoloHistoryCategoryShortcut,
    handleTogglePrimaryHistoryCategoriesShortcut,
    handleToggleAllHistoryCategoriesShortcut,
    handleFocusPrimaryHistoryCategoriesShortcut,
    handleFocusAllHistoryCategoriesShortcut,
    handleToggleVisibleCategoryMessagesExpanded,
    handleToggleVisibleCategoryMessagesExpandedInTurn,
    handleToggleCategoryDefaultExpansion,
    handleToggleAllCategoryDefaultExpansion,
    handleToggleMessageExpanded,
    handleToggleMessageExpandedInTurn,
    handleToggleBookmark,
    handleRevealInSession,
    handleRevealInProject,
    handleRevealInBookmarks,
    handleRevealInSessionWithTurnExit,
    handleRevealInProjectWithTurnExit,
    handleRevealInBookmarksWithTurnExit,
    handleRevealInTurn,
    handleSelectMessagesView,
    handleSelectTurnsView,
    handleSelectBookmarksVisualization,
    handleCycleHistoryVisualization,
    handleToggleBookmarksView,
    handleToggleTurnView,
    handleSecondaryMessagePaneEscape,
    canToggleTurnView,
    handleMessageListScroll,
    handleHistorySearchKeyDown,
    handleCopySessionDetails,
    handleCopyProjectDetails,
    focusSessionSearch,
    focusAdjacentHistoryMessage,
    pageHistoryMessagesUp: (options?: { preserveFocus?: boolean }) =>
      pageHistoryMessages("up", options),
    pageHistoryMessagesDown: (options?: { preserveFocus?: boolean }) =>
      pageHistoryMessages("down", options),
    handleExportMessages,
    historyExportState,
    selectProjectAllMessages,
    selectBookmarksView,
    openProjectBookmarksView,
    closeBookmarksView,
    selectSessionView,
    queueProjectTreeNoopCommit,
    ensureTreeProjectSessionsLoaded,
    selectAdjacentSession,
    selectAdjacentProject,
    handleProjectTreeArrow,
    handleProjectTreeEnter,
    goToHistoryPage: goToTurnNumber,
    goToFirstHistoryPage: goToFirstHistoryPageEffective,
    goToLastHistoryPage: goToLastHistoryPageEffective,
    goToPreviousHistoryPage: goToPreviousHistoryPageEffective,
    goToNextHistoryPage: goToNextHistoryPageEffective,
    handleRefresh,
    navigateFromSearchResult,
    setPendingSearchNavigation,
    pendingSearchNavigation,
    selectedSummaryMessageCount,
    historyCategoryExpandShortcutMap,
    historyCategoriesShortcutMap,
    historyCategorySoloShortcutMap,
    prettyCategory,
    prettyProvider: formatPrettyProvider,
    formatDate,
    handleRefreshAllData: useCallback(
      async (
        source: "manual" | "auto" = "manual",
        options: { historyViewActive?: boolean } = {},
      ) => {
        const container = messageListRef.current;
        const id = ++refreshIdCounterRef.current;
        const historyViewActive = options.historyViewActive ?? true;

        const sortDir =
          historyDetailMode === "turn"
            ? turnViewSortDirection
            : historyMode === "project_all"
              ? projectAllSortDirection
              : historyMode === "bookmarks"
                ? bookmarkSortDirection
                : messageSortDirection;
        const scopeKey =
          historyDetailMode === "turn"
            ? `turn:${turnSourceSessionId}:${turnAnchorMessageId}`
            : getHistoryRefreshScopeKey(historyMode, selectedProjectId, selectedSessionId);
        const baselineTotalCount =
          historyDetailMode === "turn"
            ? (sessionTurnDetail?.totalCount ?? detailMessages.length)
            : getRefreshBaselineTotalCount({
                historyMode,
                selectedProject,
                selectedSession,
                sessionDetail,
                projectCombinedDetailTotalCount: projectCombinedDetail?.totalCount,
                bookmarksResponse,
              });
        const isAtVisualEdge = container
          ? isPinnedToVisualRefreshEdge({
              sortDirection: sortDir,
              scrollTop: container.scrollTop,
              clientHeight: container.clientHeight,
              scrollHeight: container.scrollHeight,
            })
          : false;
        const isOnLiveEdgePage =
          historyMode !== "bookmarks" &&
          isLiveEdgePage({
            sortDirection: sortDir,
            page: effectiveHistoryPage,
            totalCount: baselineTotalCount,
            pageSize: appearance.messagePageSize,
          });
        const followEligible = isAtVisualEdge && isOnLiveEdgePage;

        let scrollPreservation: RefreshContext["scrollPreservation"] = null;
        let prevMessageIds = "";

        if (followEligible) {
          prevMessageIds = getMessageListFingerprint(detailMessages);
        } else if (container) {
          const anchor = getVisibleMessageAnchor(container);
          scrollPreservation = anchor
            ? {
                scrollTop: container.scrollTop,
                referenceMessageId: anchor.referenceMessageId,
                referenceOffsetTop: anchor.referenceOffsetTop,
              }
            : null;
        }

        const refreshContext: RefreshContext = {
          refreshId: id,
          originPage: effectiveHistoryPage,
          scopeKey,
          baselineTotalCount,
          followEligible,
          scrollPreservation,
          prevMessageIds,
        };
        const { updateSource, clearStartupWatchResort } = resolveStableRefreshSource(
          source,
          startupWatchResortPendingRef.current,
        );
        const consumeRefreshContext = async (
          target: "bookmarks" | "session" | "project_all" | "turn" | null,
        ) => {
          if (target === null) {
            refreshContextRef.current = null;
            return;
          }
          refreshContextRef.current = refreshContext;
          if (target === "bookmarks") {
            await loadBookmarks();
            return;
          }
          if (target === "session") {
            setSessionDetailRefreshNonce((value) => value + 1);
            return;
          }
          if (target === "turn") {
            setTurnDetailRefreshNonce((value) => value + 1);
            return;
          }
          setProjectCombinedDetailRefreshNonce((value) => value + 1);
        };

        if (source === "manual") {
          const sharedLoads: Promise<unknown>[] = [
            loadProjects(updateSource),
            loadSessions(updateSource),
            refreshTreeProjectSessions(updateSource),
          ];
          if (historyMode !== "bookmarks") {
            sharedLoads.push(loadBookmarks());
          }
          await Promise.all(sharedLoads);
          if (clearStartupWatchResort) {
            startupWatchResortPendingRef.current = false;
          }
          const refreshTarget =
            historyDetailMode === "turn" && historyViewActive && canToggleTurnView
              ? "turn"
              : historyMode === "bookmarks" && selectedProjectId
                ? "bookmarks"
                : historyMode === "session" && selectedSessionId
                  ? "session"
                  : historyMode === "project_all" && selectedProjectId
                    ? "project_all"
                    : null;
          await consumeRefreshContext(refreshTarget);
          return;
        }

        const previousProjectFingerprint = selectedProjectRefreshFingerprintRef.current;
        const previousSessionFingerprint = selectedSessionRefreshFingerprintRef.current;
        const nextProjects = await loadProjects(updateSource);
        if (clearStartupWatchResort) {
          startupWatchResortPendingRef.current = false;
        }
        const nextSelectedProject =
          nextProjects?.find((project) => project.id === selectedProjectId) ?? null;
        const projectFingerprintChanged =
          previousProjectFingerprint.length > 0 &&
          nextSelectedProject !== null &&
          getProjectRefreshFingerprint(nextSelectedProject) !== previousProjectFingerprint;

        let sessionFingerprintChanged = false;
        if (historyViewActive && selectedProjectId) {
          const nextSessions = await loadSessions(updateSource);
          const nextSelectedSession =
            nextSessions?.find((session) => session.id === selectedSessionId) ?? null;
          sessionFingerprintChanged =
            previousSessionFingerprint.length > 0 &&
            nextSelectedSession !== null &&
            getSessionRefreshFingerprint(nextSelectedSession) !== previousSessionFingerprint;
        }

        const refreshTarget =
          historyViewActive &&
          historyDetailMode === "turn" &&
          canToggleTurnView &&
          (turnVisualizationSelection.mode === "session"
            ? sessionFingerprintChanged && Boolean(turnVisualizationSelection.sessionId)
            : projectFingerprintChanged && Boolean(turnVisualizationSelection.projectId))
            ? "turn"
            : historyMode === "bookmarks" && historyViewActive && selectedProjectId
              ? "bookmarks"
              : historyViewActive &&
                  historyMode === "session" &&
                  sessionFingerprintChanged &&
                  selectedSessionId
                ? "session"
                : historyViewActive &&
                    historyMode === "project_all" &&
                    projectFingerprintChanged &&
                    selectedProjectId
                  ? "project_all"
                  : null;
        await consumeRefreshContext(refreshTarget);

        if (
          historyViewActive &&
          projectViewMode === "tree" &&
          Object.keys(treeProjectSessionsByProjectIdRef.current).length > 0
        ) {
          await refreshTreeProjectSessions(updateSource);
        }
      },
      [
        appearance.messagePageSize,
        bookmarkSortDirection,
        detailMessages,
        effectiveHistoryPage,
        historyDetailMode,
        historyMode,
        loadBookmarks,
        loadProjects,
        loadSessions,
        messageSortDirection,
        bookmarksResponse,
        canToggleTurnView,
        projectCombinedDetail,
        projectAllSortDirection,
        projectViewMode,
        refreshTreeProjectSessions,
        sessionTurnDetail,
        selectedProject,
        selectedProjectId,
        selectedSession,
        selectedSessionId,
        sessionDetail,
        turnAnchorMessageId,
        turnVisualizationSelection,
        turnSourceSessionId,
        turnViewSortDirection,
      ],
    ),
  };
}
