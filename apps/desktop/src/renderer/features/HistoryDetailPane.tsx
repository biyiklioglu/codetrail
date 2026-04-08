import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";

import type { IpcRequestInput, MessageCategory } from "@codetrail/core/browser";

import { type MessagePageSize, UI_MESSAGE_PAGE_SIZE_VALUES } from "../../shared/uiPreferences";
import { CATEGORIES } from "../app/constants";
import type { WatchLiveStatusResponse } from "../app/types";
import { AdvancedSearchToggleButton } from "../components/AdvancedSearchToggleButton";
import { HistoryExportMenu } from "../components/HistoryExportMenu";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { ZoomPercentInput } from "../components/ZoomPercentInput";
import { TurnView } from "../components/history/TurnView";
import { MessageCard } from "../components/messages/MessagePresentation";
import {
  buildLiveSummary,
  createLiveUiTracePayload,
  formatCompactLiveAge,
  getNextCompactLiveAgeUpdateDelayMs,
  selectRelevantLiveSessionCandidate,
} from "../lib/liveSessions";
import { formatCompactInteger, formatInteger } from "../lib/numberFormatting";
import { usePaneFocus } from "../lib/paneFocusController";
import {
  getAdvancedSearchToggleTitle,
  getSearchQueryPlaceholder,
  getSearchQueryTooltip,
} from "../lib/searchLabels";
import { useShortcutRegistry } from "../lib/shortcutRegistry";
import { useTooltipFormatter } from "../lib/tooltipText";
import type { useHistoryController } from "./useHistoryController";
import { formatSelectedSummaryMessageCount } from "./useHistoryDerivedState";

type HistoryController = ReturnType<typeof useHistoryController>;

function getHistoryCategoryShortcutDigit(
  history: HistoryController,
  category: MessageCategory,
): string {
  const match = history.historyCategoriesShortcutMap[category].match(/\d$/);
  return match?.[0] ?? "";
}

function getHistoryCategoryTooltip(
  history: HistoryController,
  category: MessageCategory,
  count: number,
  shortcuts: ReturnType<typeof useShortcutRegistry>,
  formatTooltipLabel: ReturnType<typeof useTooltipFormatter>,
): string {
  const label = history.prettyCategory(category);
  const formattedCount = formatInteger(count);
  return [
    formatTooltipLabel(
      `Show or hide ${label} messages (${formattedCount})`,
      history.historyCategoriesShortcutMap[category],
    ),
    formatTooltipLabel(
      `${shortcuts.labels.categoryClickModifier}+Click Focus only ${label} messages`,
      history.historyCategorySoloShortcutMap[category],
    ),
  ].join("\n");
}

function getHistoryCategoryAriaLabel(
  history: HistoryController,
  category: MessageCategory,
  count: number,
): string {
  const label = history.prettyCategory(category);
  return `Show or hide ${label} messages (${formatInteger(count)})`;
}

function getHistoryCategoryExpansionDefaultTooltip(
  history: HistoryController,
  category: MessageCategory,
  expandedByDefault: boolean,
  formatTooltipLabel: ReturnType<typeof useTooltipFormatter>,
): string {
  const label = history.prettyCategory(category);
  const nextAction = expandedByDefault ? "Collapse" : "Expand";
  return formatTooltipLabel(
    `${nextAction} ${label} messages`,
    history.historyCategoryExpandShortcutMap[category],
  );
}

function formatHistoryCategorySelection(
  history: HistoryController,
  categories: MessageCategory[],
): string {
  if (categories.length === 0) {
    return "None";
  }
  if (categories.length === CATEGORIES.length) {
    return "All";
  }
  return categories.map((category) => history.prettyCategory(category)).join(", ");
}

function getHistoryExportViewLabel(history: HistoryController): string {
  if (history.historyMode === "project_all") {
    return "All Sessions";
  }
  if (history.historyMode === "bookmarks") {
    return "Bookmarks";
  }
  return "Session";
}

function selectNumericValueOrFallback<T extends number>(
  value: string,
  allowedValues: readonly T[],
  fallback: T,
): T {
  const numericValue = Number(value);
  return allowedValues.includes(numericValue as T) ? (numericValue as T) : fallback;
}

export function HistoryDetailPane({
  history,
  advancedSearchEnabled,
  setAdvancedSearchEnabled,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  applyZoomAction,
  setZoomPercent,
  liveSessions = [],
  liveRowHasBackground = true,
  recordLiveUiTrace,
}: {
  history: HistoryController;
  advancedSearchEnabled: boolean;
  setAdvancedSearchEnabled: Dispatch<SetStateAction<boolean>>;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
  setZoomPercent: (percent: number) => Promise<void>;
  liveSessions?: WatchLiveStatusResponse["sessions"];
  liveRowHasBackground?: boolean;
  recordLiveUiTrace?: (payload: IpcRequestInput<"debug:recordLiveUiTrace">) => void;
}) {
  const paneFocus = usePaneFocus();
  const shortcuts = useShortcutRegistry();
  const formatTooltipLabel = useTooltipFormatter();
  const focusMessagePane = () => paneFocus.focusHistoryPane("message");
  const messagePaneChromeProps = paneFocus.getPaneChromeProps("message");
  const isTurnView = history.historyDetailMode === "turn";
  const isBookmarksView = history.historyVisualization === "bookmarks";
  const isMessagesView = history.historyVisualization === "messages";
  const turnMessages = history.turnVisibleMessages;
  const turnCategoryCounts = history.turnCategoryCounts;
  const effectiveHistoryCategories = isTurnView
    ? history.turnViewCategories
    : history.historyCategories;
  const effectiveExpandedByDefaultCategories = isTurnView
    ? history.turnViewExpandedByDefaultCategories
    : history.expandedByDefaultCategories;
  const effectiveCategoryCounts = isTurnView ? turnCategoryCounts : history.historyCategoryCounts;
  const effectiveQueryError = isTurnView
    ? (history.sessionTurnDetail?.queryError ?? null)
    : history.historyQueryError;
  const effectiveSortDirection = isTurnView
    ? history.turnViewSortDirection
    : history.activeMessageSortDirection;
  const summaryCountLabel = isTurnView
    ? formatSelectedSummaryMessageCount(
        turnMessages.length,
        history.sessionTurnDetail?.totalCount ?? turnMessages.length,
        "turn messages",
      )
    : history.selectedSummaryMessageCount;
  const bookmarksEmptyStateLabel =
    history.selectedSessionId.length > 0
      ? "There are no bookmarks for this session."
      : "There are no bookmarks for this project.";
  const bookmarksEmptyStateActionLabel =
    history.selectedSessionId.length > 0 ? "Go To Session Messages" : "Go To Project Messages";
  const preserveMessagePaneFocusProps = paneFocus.getPreservePaneFocusProps("message");
  const exportAllPagesCount =
    history.historyMode === "bookmarks"
      ? history.bookmarksResponse.filteredCount
      : history.historyMode === "project_all"
        ? (history.projectCombinedDetail?.totalCount ?? 0)
        : (history.sessionDetail?.totalCount ?? 0);
  const exportCurrentPageCount = isTurnView
    ? turnMessages.length
    : history.activeHistoryMessages.length;
  const exportSortLabel =
    effectiveSortDirection === "asc" ? "Oldest to newest" : "Newest to oldest";
  const paginationTotal = isTurnView
    ? history.totalPages
    : history.historyMode === "bookmarks"
      ? history.bookmarksResponse.filteredCount
      : history.historyMode === "project_all"
        ? (history.projectCombinedDetail?.totalCount ?? 0)
        : (history.sessionDetail?.totalCount ?? 0);
  const messageSortScopeSuffix = isTurnView
    ? "turn"
    : history.historyMode === "project_all"
      ? "all sessions"
      : history.historyMode === "bookmarks"
        ? "bookmarks"
        : "session";
  const messageSortAriaLabel =
    effectiveSortDirection === "asc"
      ? `Oldest first (${messageSortScopeSuffix}). Switch to newest first`
      : `Newest first (${messageSortScopeSuffix}). Switch to oldest first`;
  const historySearchPlaceholder = getSearchQueryPlaceholder(advancedSearchEnabled);
  const historySearchTooltip = getSearchQueryTooltip(advancedSearchEnabled);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [pageInputValue, setPageInputValue] = useState(() => `${history.sessionPage + 1}`);
  const skipNextPageInputBlurResetRef = useRef(false);
  const lastLiveUiTraceRef = useRef<string | null>(null);
  const handledCtrlFilterMouseDownRef = useRef<MessageCategory | null>(null);
  const liveSessionSelection = useMemo(
    () =>
      selectRelevantLiveSessionCandidate({
        sessions: liveSessions,
        selectionMode: history.historyMode,
        selectedProject: history.selectedProject,
        selectedSession: history.selectedSession,
      }),
    [history.historyMode, history.selectedProject, history.selectedSession, liveSessions],
  );
  const liveSession = liveSessionSelection.session;
  const liveUiTracePayload = useMemo(() => {
    if (!recordLiveUiTrace) {
      return null;
    }
    return createLiveUiTracePayload({
      sessions: liveSessions,
      selectionMode: history.historyMode,
      selectedProject: history.selectedProject,
      selectedSession: history.selectedSession,
      selection: liveSessionSelection,
    });
  }, [
    history.historyMode,
    history.selectedProject,
    history.selectedSession,
    liveSessions,
    liveSessionSelection,
    recordLiveUiTrace,
  ]);

  useEffect(() => {
    if (!liveSession) {
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) {
        return;
      }
      const nextNowMs = Date.now();
      setLiveNowMs(nextNowMs);
      const nextDelayMs = getNextCompactLiveAgeUpdateDelayMs(liveSession.lastActivityAt, nextNowMs);
      timeoutId = window.setTimeout(tick, nextDelayMs);
    };

    setLiveNowMs(Date.now());
    let timeoutId = window.setTimeout(
      tick,
      getNextCompactLiveAgeUpdateDelayMs(liveSession.lastActivityAt),
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [liveSession]);

  useEffect(() => {
    if (!recordLiveUiTrace) {
      return;
    }
    if (!liveUiTracePayload) {
      return;
    }
    const serialized = JSON.stringify(liveUiTracePayload);
    if (lastLiveUiTraceRef.current === serialized) {
      return;
    }
    lastLiveUiTraceRef.current = serialized;
    recordLiveUiTrace(liveUiTracePayload);
  }, [liveUiTracePayload, recordLiveUiTrace]);

  useEffect(() => {
    setPageInputValue(`${history.sessionPage + 1}`);
  }, [history.sessionPage]);

  const liveTimer = liveSession
    ? formatCompactLiveAge(liveSession.lastActivityAt, liveNowMs)
    : null;
  const liveDetailText = liveSession?.detailText?.trim() ?? "";
  // The live row is intentionally single-line. Timer and status stay stable; detail is the only
  // field that gives way, and it should carry the best current or last meaningful activity rather
  // than collapsing to a blank "Working" row.
  const liveSummary = liveSession ? buildLiveSummary(liveSession, liveTimer) : null;

  const resetPageInputValue = () => {
    setPageInputValue(`${history.sessionPage + 1}`);
  };

  const commitPageInputValue = () => {
    const parsedValue = Number.parseInt(pageInputValue.trim(), 10);
    skipNextPageInputBlurResetRef.current = true;
    if (!Number.isFinite(parsedValue)) {
      resetPageInputValue();
      focusMessagePane();
      return;
    }
    const nextPageNumber = Math.max(1, Math.min(history.totalPages, parsedValue));
    setPageInputValue(`${nextPageNumber}`);
    if (nextPageNumber !== history.sessionPage + 1) {
      history.goToHistoryPage(nextPageNumber - 1);
    }
    focusMessagePane();
  };

  return (
    <div className="history-view">
      <div className="msg-header" {...messagePaneChromeProps}>
        <div className="msg-header-top">
          <div className="msg-view-switcher" role="tablist" aria-label="Message pane visualization">
            <button
              type="button"
              role="tab"
              className={`toolbar-btn msg-view-switcher-button msg-view-switcher-button-messages${isMessagesView ? " is-active" : ""}`}
              aria-selected={isMessagesView}
              {...preserveMessagePaneFocusProps}
              onClick={() => {
                history.handleSelectMessagesView();
                focusMessagePane();
              }}
              title={formatTooltipLabel("Messages", [
                shortcuts.actions.showMessagesView,
                {
                  label: "Cycle",
                  shortcut: shortcuts.actions.cycleMessagesTurnsView,
                },
              ])}
            >
              <ToolbarIcon name="history" />
              <span>Messages</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`toolbar-btn msg-view-switcher-button msg-view-switcher-button-turns${isTurnView ? " is-active" : ""}`}
              aria-selected={isTurnView}
              {...preserveMessagePaneFocusProps}
              onClick={() => {
                void history.handleSelectTurnsView();
                focusMessagePane();
              }}
              disabled={!history.canToggleTurnView && !isTurnView}
              title={formatTooltipLabel("Turns", [
                shortcuts.actions.showTurnsView,
                {
                  label: "Cycle",
                  shortcut: shortcuts.actions.cycleMessagesTurnsView,
                },
              ])}
            >
              <ToolbarIcon name="turns" />
              <span>Turns</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`toolbar-btn msg-view-switcher-button msg-view-switcher-button-bookmarks${isBookmarksView ? " is-active" : ""}`}
              aria-selected={isBookmarksView}
              {...preserveMessagePaneFocusProps}
              onClick={() => {
                history.handleSelectBookmarksVisualization();
                focusMessagePane();
              }}
              title={formatTooltipLabel("Bookmarks", shortcuts.actions.showBookmarksView)}
            >
              <ToolbarIcon name="bookmark" />
              <span>Bookmarks</span>
            </button>
          </div>
          <div className="msg-toolbar">
            {!isTurnView ? (
              <HistoryExportMenu
                disabled={exportCurrentPageCount === 0}
                viewLabel={getHistoryExportViewLabel(history)}
                currentPageCount={exportCurrentPageCount}
                allPagesCount={exportAllPagesCount}
                categoryLabel={formatHistoryCategorySelection(history, effectiveHistoryCategories)}
                sortLabel={exportSortLabel}
                onExport={async ({ scope }) => {
                  await history.handleExportMessages({ scope });
                }}
              />
            ) : null}
            <button
              type="button"
              className="toolbar-btn msg-sort-btn"
              {...preserveMessagePaneFocusProps}
              onClick={() => {
                if (isTurnView) {
                  history.setTurnViewSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                  focusMessagePane();
                  return;
                }
                if (history.historyMode === "project_all") {
                  history.setProjectAllSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                  history.setSessionPage(0);
                  focusMessagePane();
                  return;
                }
                if (history.historyMode === "bookmarks") {
                  history.setBookmarkSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                  focusMessagePane();
                  return;
                }
                history.setMessageSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                history.setSessionPage(0);
                focusMessagePane();
              }}
              aria-label={messageSortAriaLabel}
              title={
                isTurnView
                  ? effectiveSortDirection === "asc"
                    ? "Oldest first"
                    : "Newest first"
                  : history.messageSortTooltip
              }
            >
              <ToolbarIcon name={effectiveSortDirection === "asc" ? "sortAsc" : "sortDesc"} />
            </button>
            <div className="expand-scope-control">
              <button
                type="button"
                className="toolbar-btn expand-scope-action"
                {...preserveMessagePaneFocusProps}
                onClick={() => {
                  history.handleToggleAllCategoryDefaultExpansion();
                  focusMessagePane();
                }}
                aria-label={`${history.globalExpandCollapseLabel} shown items`}
                title={formatTooltipLabel(
                  `${history.globalExpandCollapseLabel} shown items`,
                  shortcuts.actions.toggleAllMessagesExpanded,
                )}
              >
                <ToolbarIcon name={history.globalExpandCollapseIconName} />
                {history.globalExpandCollapseLabel}
              </button>
            </div>
            <div className="toolbar-zoom-group">
              <button
                type="button"
                className="toolbar-btn zoom-btn"
                {...preserveMessagePaneFocusProps}
                onClick={() => void applyZoomAction("out")}
                disabled={!canZoomOut}
                aria-label="Zoom out"
                title={formatTooltipLabel("Zoom out", shortcuts.actions.zoomOut)}
              >
                <ToolbarIcon name="zoomOut" />
              </button>
              <ZoomPercentInput
                value={zoomPercent}
                onCommit={(percent) => void setZoomPercent(percent)}
                ariaLabel="Zoom percentage"
                title={formatTooltipLabel("Zoom level", shortcuts.actions.zoomReset)}
                wrapperClassName="zoom-level-control"
                inputClassName="zoom-level-input"
              />
              <button
                type="button"
                className="toolbar-btn zoom-btn"
                {...preserveMessagePaneFocusProps}
                onClick={() => void applyZoomAction("in")}
                disabled={!canZoomIn}
                aria-label="Zoom in"
                title={formatTooltipLabel("Zoom in", shortcuts.actions.zoomIn)}
              >
                <ToolbarIcon name="zoomIn" />
              </button>
            </div>
          </div>
        </div>
        {liveSession && liveTimer ? (
          <div
            className={`msg-live-row${liveRowHasBackground ? "" : " is-flat"}`}
            title={liveSummary ?? undefined}
          >
            <span className="msg-live-label">Live</span>
            <span className="msg-live-separator" aria-hidden="true">
              ·
            </span>
            <span className="msg-live-timer">{liveTimer}</span>
            <span className="msg-live-separator" aria-hidden="true">
              ·
            </span>
            <span className={`msg-live-status msg-live-status-${liveSession.statusKind}`}>
              {liveSession.statusText}
            </span>
            {liveDetailText ? (
              <>
                <span className="msg-live-separator" aria-hidden="true">
                  ·
                </span>
                <span className="msg-live-detail">{liveDetailText}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="msg-filters">
        {CATEGORIES.map((category) => (
          <div
            key={category}
            className={`msg-filter ${category}-filter${
              effectiveHistoryCategories.includes(category) ? " active" : ""
            }`}
          >
            <button
              type="button"
              className="msg-filter-main"
              {...preserveMessagePaneFocusProps}
              aria-label={getHistoryCategoryAriaLabel(
                history,
                category,
                effectiveCategoryCounts[category],
              )}
              title={getHistoryCategoryTooltip(
                history,
                category,
                effectiveCategoryCounts[category],
                shortcuts,
                formatTooltipLabel,
              )}
              onMouseDown={(event) => {
                if (!shortcuts.matches.isCategoryExpansionClick(event) || event.button !== 0) {
                  handledCtrlFilterMouseDownRef.current = null;
                  return;
                }
                handledCtrlFilterMouseDownRef.current = category;
                event.preventDefault();
                history.handleSoloHistoryCategoryShortcut(category);
                focusMessagePane();
              }}
              onContextMenu={(event) => {
                if (shortcuts.matches.isCategoryExpansionClick(event)) {
                  event.preventDefault();
                }
              }}
              onClick={(event) => {
                if (shortcuts.matches.isCategoryExpansionClick(event)) {
                  if (handledCtrlFilterMouseDownRef.current === category) {
                    handledCtrlFilterMouseDownRef.current = null;
                    return;
                  }
                  history.handleSoloHistoryCategoryShortcut(category);
                } else {
                  handledCtrlFilterMouseDownRef.current = null;
                  history.handleToggleHistoryCategoryShortcut(category);
                }
                focusMessagePane();
              }}
            >
              <span className="filter-shortcut" aria-hidden="true">
                {getHistoryCategoryShortcutDigit(history, category)}
              </span>
              <span className="filter-label">
                {history.prettyCategory(category)}
                <span className="filter-count" aria-hidden="true">
                  {formatCompactInteger(effectiveCategoryCounts[category])}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="msg-filter-expand-toggle"
              {...preserveMessagePaneFocusProps}
              aria-label={getHistoryCategoryExpansionDefaultTooltip(
                history,
                category,
                effectiveExpandedByDefaultCategories.includes(category),
                formatTooltipLabel,
              )}
              title={getHistoryCategoryExpansionDefaultTooltip(
                history,
                category,
                effectiveExpandedByDefaultCategories.includes(category),
                formatTooltipLabel,
              )}
              onClick={() => {
                history.handleToggleCategoryDefaultExpansion(category);
                focusMessagePane();
              }}
            >
              <svg
                className={`msg-chevron filter-expand-chevron${
                  effectiveExpandedByDefaultCategories.includes(category) ? "" : " is-collapsed"
                }`}
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="msg-search">
        <div className={effectiveQueryError ? "search-box invalid" : "search-box"}>
          <div className="search-input-shell">
            <ToolbarIcon name="search" />
            <input
              ref={history.refs.sessionSearchInputRef}
              className="search-input"
              value={
                isTurnView
                  ? history.turnQueryInput
                  : history.historyMode === "bookmarks"
                    ? history.bookmarkQueryInput
                    : history.sessionQueryInput
              }
              onKeyDown={history.handleHistorySearchKeyDown}
              onChange={(event) => {
                if (isTurnView) {
                  history.setTurnQueryInput(event.target.value);
                  return;
                }
                if (history.historyMode === "bookmarks") {
                  history.setBookmarkQueryInput(event.target.value);
                  return;
                }
                history.setSessionQueryInput(event.target.value);
                history.setSessionPage(0);
              }}
              placeholder={historySearchPlaceholder}
              title={effectiveQueryError ?? historySearchTooltip}
              aria-label="Search current history view"
            />
          </div>
          <AdvancedSearchToggleButton
            enabled={advancedSearchEnabled}
            variant="history"
            onToggle={() => {
              setAdvancedSearchEnabled((value) => !value);
              history.setSessionPage(0);
            }}
            title={getAdvancedSearchToggleTitle(advancedSearchEnabled)}
          />
        </div>
        {effectiveQueryError ? (
          <p className="search-error" title={effectiveQueryError}>
            {effectiveQueryError}
          </p>
        ) : null}
      </div>

      <div
        className="msg-scroll message-list"
        ref={(element) => {
          history.refs.messageListRef.current = element;
          paneFocus.registerHistoryPaneTarget("message", element);
        }}
        tabIndex={-1}
        onScroll={history.handleMessageListScroll}
      >
        {isTurnView ? (
          <TurnView history={history} />
        ) : history.activeHistoryMessages.length ? (
          history.activeHistoryMessages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              query={
                history.historyMode === "bookmarks"
                  ? history.effectiveBookmarkQuery
                  : history.effectiveSessionQuery
              }
              highlightPatterns={history.historyHighlightPatterns}
              pathRoots={history.messagePathRoots}
              isFocused={message.id === history.focusMessageId}
              isBookmarked={history.bookmarkedMessageIds.has(message.id)}
              isOrphaned={
                history.historyMode === "bookmarks"
                  ? (history.bookmarkOrphanedByMessageId.get(message.id) ?? false)
                  : false
              }
              isExpanded={
                history.messageExpansionOverrides[message.id] ??
                history.isExpandedByDefault(message.category)
              }
              onToggleExpanded={history.handleToggleMessageExpanded}
              onToggleCategoryExpanded={history.handleToggleVisibleCategoryMessagesExpanded}
              onToggleBookmark={history.handleToggleBookmark}
              cardRef={
                history.focusMessageId === message.id ? history.refs.focusedMessageRef : null
              }
              {...(history.historyMode === "session"
                ? {}
                : { onRevealInSession: history.handleRevealInSession })}
              {...(history.historyMode === "project_all"
                ? {}
                : { onRevealInProject: history.handleRevealInProject })}
              {...(history.historyMode === "bookmarks"
                ? {}
                : history.bookmarkedMessageIds.has(message.id)
                  ? { onRevealInBookmarks: history.handleRevealInBookmarks }
                  : {})}
              {...(history.canToggleTurnView ? { onRevealInTurn: history.handleRevealInTurn } : {})}
            />
          ))
        ) : history.historyMode === "bookmarks" &&
          history.bookmarksResponse.totalCount === 0 &&
          !history.effectiveBookmarkQuery ? (
          <div className="empty-state empty-state-with-action">
            <p>{bookmarksEmptyStateLabel}</p>
            <button
              type="button"
              className="toolbar-btn"
              {...preserveMessagePaneFocusProps}
              onClick={() => {
                history.handleSelectMessagesView();
                focusMessagePane();
              }}
            >
              {bookmarksEmptyStateActionLabel}
            </button>
          </div>
        ) : (
          <p className="empty-state">
            {history.historyMode === "bookmarks"
              ? "No bookmarked messages match current filters."
              : "No messages match current filters."}
          </p>
        )}
      </div>

      <div
        className={`msg-pagination pagination-row history-visualization-${history.historyVisualization}`}
        {...messagePaneChromeProps}
      >
        <div className="msg-pagination-group msg-pagination-summary">
          <span className="page-total">{summaryCountLabel}</span>
        </div>

        <div className="msg-pagination-group msg-pagination-controls">
          <button
            type="button"
            className="page-btn page-icon-btn"
            {...preserveMessagePaneFocusProps}
            onClick={() => {
              history.goToFirstHistoryPage();
              focusMessagePane();
            }}
            disabled={!history.canGoToPreviousHistoryPage}
            title={isTurnView ? "First turn" : "First page"}
            aria-label={isTurnView ? "First turn" : "First page"}
          >
            <ToolbarIcon name="chevronsLeft" />
          </button>
          <button
            type="button"
            className="page-btn page-icon-btn"
            {...preserveMessagePaneFocusProps}
            onClick={() => {
              history.goToPreviousHistoryPage();
              focusMessagePane();
            }}
            disabled={!history.canGoToPreviousHistoryPage}
            title={formatTooltipLabel(
              isTurnView ? "Previous turn" : "Previous page",
              shortcuts.actions.previousPage,
            )}
            aria-label={isTurnView ? "Previous turn" : "Previous page"}
          >
            <ToolbarIcon name="chevronLeft" />
          </button>

          <label className="page-jump-control">
            <span className="page-jump-label-text">{isTurnView ? "Turn" : "Page"}</span>
            <input
              className="page-jump-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pageInputValue}
              onChange={(event) => {
                setPageInputValue(event.target.value);
              }}
              onBlur={() => {
                if (skipNextPageInputBlurResetRef.current) {
                  skipNextPageInputBlurResetRef.current = false;
                  return;
                }
                resetPageInputValue();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPageInputValue();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  resetPageInputValue();
                  focusMessagePane();
                }
              }}
              aria-label={isTurnView ? "Turn number" : "Page number"}
            />
            <span className="page-jump-total">{`of ${history.totalPages}`}</span>
          </label>

          <button
            type="button"
            className="page-btn page-icon-btn"
            {...preserveMessagePaneFocusProps}
            onClick={() => {
              history.goToNextHistoryPage();
              focusMessagePane();
            }}
            disabled={!history.canGoToNextHistoryPage}
            title={formatTooltipLabel(
              isTurnView ? "Next turn" : "Next page",
              shortcuts.actions.nextPage,
            )}
            aria-label={isTurnView ? "Next turn" : "Next page"}
          >
            <ToolbarIcon name="chevronRight" />
          </button>
          <button
            type="button"
            className="page-btn page-icon-btn"
            {...preserveMessagePaneFocusProps}
            onClick={() => {
              history.goToLastHistoryPage();
              focusMessagePane();
            }}
            disabled={!history.canGoToNextHistoryPage}
            title={isTurnView ? "Latest turn" : "Last page"}
            aria-label={isTurnView ? "Latest turn" : "Last page"}
          >
            <ToolbarIcon name="chevronsRight" />
          </button>
        </div>

        <div
          className={`msg-pagination-group msg-pagination-page-size${isTurnView ? " is-hidden" : ""}`}
        >
          {!isTurnView ? (
            <label className="page-size-control">
              <span className="page-size-label-text">Per page</span>
              <div className="pagination-select-wrap">
                <select
                  className="pagination-select"
                  aria-label="Messages per page"
                  value={history.messagePageSize}
                  onChange={(event) => {
                    history.setMessagePageSize(
                      selectNumericValueOrFallback(
                        event.target.value,
                        UI_MESSAGE_PAGE_SIZE_VALUES,
                        history.messagePageSize as MessagePageSize,
                      ),
                    );
                    focusMessagePane();
                  }}
                >
                  {UI_MESSAGE_PAGE_SIZE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <span className="pagination-select-chevron" aria-hidden>
                  <svg viewBox="0 0 12 12">
                    <title>Open menu</title>
                    <path d="M3 4.5L6 7.5L9 4.5" />
                  </svg>
                </span>
              </div>
            </label>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
}
