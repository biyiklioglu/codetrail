import { useCallback, useMemo } from "react";
import type {
  Dispatch,
  MutableRefObject,
  KeyboardEvent as ReactKeyboardEvent,
  UIEvent as ReactUIEvent,
  RefObject,
  SetStateAction,
} from "react";

import type { MessageCategory, Provider } from "@codetrail/core/browser";

import { CATEGORIES, PROVIDERS } from "../app/constants";
import { createHistorySelection } from "../app/historySelection";
import type {
  HistoryMessage,
  HistorySearchNavigation,
  HistorySelection,
  ProjectViewMode,
  TreeAutoRevealSessionRequest,
} from "../app/types";
import type { CodetrailClient } from "../lib/codetrailClient";
import type { StableListUpdateSource } from "../lib/projectUpdates";
import { toggleValue } from "../lib/viewUtils";
import type { HistoryCategoryFilterRestoreState } from "./historyInteractionTypes";

const USER_ASSISTANT_WRITE_CATEGORIES: readonly MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
];

function areSameCategorySets(left: MessageCategory[], right: MessageCategory[]): boolean {
  return left.length === right.length && left.every((category, index) => category === right[index]);
}

function areAllCategoriesVisible(
  currentCategories: MessageCategory[],
  targetCategories: readonly MessageCategory[],
): boolean {
  return targetCategories.every((category) => currentCategories.includes(category));
}

function ensureCategoryVisible(
  currentCategories: MessageCategory[],
  targetCategory: MessageCategory,
): MessageCategory[] {
  if (currentCategories.includes(targetCategory)) {
    return currentCategories;
  }
  return CATEGORIES.filter(
    (category) => currentCategories.includes(category) || category === targetCategory,
  );
}

export function useHistoryMessageInteractions({
  codetrail,
  logError,
  historyMode,
  selectedProjectId,
  selectedSessionId,
  historyCategories,
  bookmarksResponse,
  activeHistoryMessages,
  setMessageExpanded,
  setHistoryCategories,
  historyCategoriesRef,
  historyCategorySoloRestoreRef,
  setExpandedByDefaultCategories,
  setSessionPage,
  isExpandedByDefault,
  setPendingSearchNavigation,
  setSessionQueryInput,
  setBookmarkQueryInput,
  setFocusMessageId,
  setPendingRevealTarget,
  setHistorySelection,
  loadBookmarks,
  loadProjects,
  loadSessions,
  refreshTreeProjectSessions,
  refreshVisibleBookmarkStates,
  setProjectProviders,
  setProjectQueryInput,
  sessionScrollTopRef,
  sessionScrollSyncTimerRef,
  setSessionScrollTop,
  messageListRef,
  projectPaneCollapsed,
  setProjectPaneCollapsed,
  sessionPaneCollapsed,
  hideSessionsPaneForTreeView,
  projectViewMode,
  setProjectViewMode,
  setAutoRevealSessionRequest,
  openProjectBookmarksView,
}: {
  codetrail: CodetrailClient;
  logError: (context: string, error: unknown) => void;
  historyMode: HistorySelection["mode"];
  selectedProjectId: string;
  selectedSessionId: string;
  historyCategories: MessageCategory[];
  bookmarksResponse: {
    results: Array<{
      projectId: string;
      sessionId: string;
      message: HistoryMessage;
    }>;
  };
  activeHistoryMessages: HistoryMessage[];
  setMessageExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  historyCategoriesRef: MutableRefObject<MessageCategory[]>;
  historyCategorySoloRestoreRef: MutableRefObject<HistoryCategoryFilterRestoreState | null>;
  setExpandedByDefaultCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setSessionPage: Dispatch<SetStateAction<number>>;
  isExpandedByDefault: (category: MessageCategory) => boolean;
  setPendingSearchNavigation: Dispatch<SetStateAction<HistorySearchNavigation | null>>;
  setSessionQueryInput: Dispatch<SetStateAction<string>>;
  setBookmarkQueryInput: Dispatch<SetStateAction<string>>;
  setFocusMessageId: Dispatch<SetStateAction<string>>;
  setPendingRevealTarget: Dispatch<
    SetStateAction<{
      messageId: string;
      sourceId: string;
    } | null>
  >;
  setHistorySelection: Dispatch<SetStateAction<HistorySelection>>;
  loadBookmarks: () => Promise<unknown>;
  loadProjects: (source?: StableListUpdateSource) => Promise<unknown>;
  loadSessions: (source?: StableListUpdateSource) => Promise<unknown>;
  refreshTreeProjectSessions: (source?: StableListUpdateSource) => Promise<void>;
  refreshVisibleBookmarkStates: () => void;
  setProjectProviders: Dispatch<SetStateAction<Provider[]>>;
  setProjectQueryInput: Dispatch<SetStateAction<string>>;
  sessionScrollTopRef: MutableRefObject<number>;
  sessionScrollSyncTimerRef: MutableRefObject<number | null>;
  setSessionScrollTop: Dispatch<SetStateAction<number>>;
  messageListRef: RefObject<HTMLDivElement | null>;
  projectPaneCollapsed: boolean;
  setProjectPaneCollapsed: Dispatch<SetStateAction<boolean>>;
  sessionPaneCollapsed: boolean;
  hideSessionsPaneForTreeView: boolean;
  projectViewMode: ProjectViewMode;
  setProjectViewMode: Dispatch<SetStateAction<ProjectViewMode>>;
  setAutoRevealSessionRequest: Dispatch<SetStateAction<TreeAutoRevealSessionRequest | null>>;
  openProjectBookmarksView: (projectId: string) => void;
}) {
  const messagesByCategory = useMemo(() => {
    const map = new Map<MessageCategory, HistoryMessage[]>();
    for (const message of activeHistoryMessages) {
      const existing = map.get(message.category);
      if (existing) {
        existing.push(message);
      } else {
        map.set(message.category, [message]);
      }
    }
    return map;
  }, [activeHistoryMessages]);

  const projectMessagesById = useMemo(
    () => new Map(activeHistoryMessages.map((message) => [message.id, message])),
    [activeHistoryMessages],
  );
  const bookmarksByMessageId = useMemo(
    () => new Map(bookmarksResponse.results.map((entry) => [entry.message.id, entry])),
    [bookmarksResponse.results],
  );

  const setCategoryDefaultExpansion = useCallback(
    (category: MessageCategory, expanded: boolean) => {
      setExpandedByDefaultCategories((value) => {
        const alreadyExpanded = value.includes(category);
        if (expanded === alreadyExpanded) {
          return value;
        }
        return expanded ? [...value, category] : value.filter((item) => item !== category);
      });
      const categoryMessages = messagesByCategory.get(category) ?? [];
      setMessageExpanded((value) => {
        let changed = false;
        const next = { ...value };
        for (const message of categoryMessages) {
          if (!(message.id in next)) {
            continue;
          }
          delete next[message.id];
          changed = true;
        }
        return changed ? next : value;
      });
    },
    [messagesByCategory, setExpandedByDefaultCategories, setMessageExpanded],
  );

  const handleToggleHistoryCategoryShortcut = useCallback(
    (category: MessageCategory) => {
      historyCategorySoloRestoreRef.current = null;
      const nextCategories = toggleValue<MessageCategory>(historyCategoriesRef.current, category);
      historyCategoriesRef.current = nextCategories;
      setHistoryCategories(nextCategories);
      setSessionPage(0);
    },
    [historyCategoriesRef, historyCategorySoloRestoreRef, setHistoryCategories, setSessionPage],
  );

  const handleSoloHistoryCategoryShortcut = useCallback(
    (category: MessageCategory) => {
      const currentCategories = historyCategoriesRef.current;
      const restoreState = historyCategorySoloRestoreRef.current;
      const isCurrentSoloState =
        currentCategories.length === 1 && currentCategories[0] === category;
      const restoreCategories =
        restoreState?.mode === `solo:${category}` ? restoreState.categories : null;
      const hasUsefulRestore =
        Array.isArray(restoreCategories) &&
        !areSameCategorySets(restoreCategories, currentCategories);

      const nextCategories = isCurrentSoloState
        ? hasUsefulRestore
          ? [...restoreCategories]
          : [...CATEGORIES]
        : [category];

      historyCategorySoloRestoreRef.current = isCurrentSoloState
        ? null
        : {
            mode: `solo:${category}`,
            categories: [...currentCategories],
          };
      historyCategoriesRef.current = nextCategories;
      setHistoryCategories(nextCategories);
      setSessionPage(0);
    },
    [historyCategoriesRef, historyCategorySoloRestoreRef, setHistoryCategories, setSessionPage],
  );

  const handleTogglePrimaryHistoryCategoriesShortcut = useCallback(() => {
    const currentCategories = historyCategoriesRef.current;
    historyCategorySoloRestoreRef.current = null;
    const targetCategories = new Set(USER_ASSISTANT_WRITE_CATEGORIES);
    const nextCategories = areAllCategoriesVisible(
      currentCategories,
      USER_ASSISTANT_WRITE_CATEGORIES,
    )
      ? currentCategories.filter((category) => !targetCategories.has(category))
      : [
          ...currentCategories.filter((category) => !targetCategories.has(category)),
          ...USER_ASSISTANT_WRITE_CATEGORIES,
        ];
    historyCategoriesRef.current = nextCategories;
    setHistoryCategories(nextCategories);
    setSessionPage(0);
  }, [historyCategoriesRef, historyCategorySoloRestoreRef, setHistoryCategories, setSessionPage]);

  const handleToggleAllHistoryCategoriesShortcut = useCallback(() => {
    const currentCategories = historyCategoriesRef.current;
    historyCategorySoloRestoreRef.current = null;
    const nextCategories = areSameCategorySets(currentCategories, [...CATEGORIES])
      ? []
      : [...CATEGORIES];
    historyCategoriesRef.current = nextCategories;
    setHistoryCategories(nextCategories);
    setSessionPage(0);
  }, [historyCategoriesRef, historyCategorySoloRestoreRef, setHistoryCategories, setSessionPage]);

  const handleFocusPrimaryHistoryCategoriesShortcut = useCallback(() => {
    const currentCategories = historyCategoriesRef.current;
    const restoreState = historyCategorySoloRestoreRef.current;
    const isCurrentPreset = areSameCategorySets(currentCategories, [
      ...USER_ASSISTANT_WRITE_CATEGORIES,
    ]);
    const restoreCategories =
      restoreState?.mode === "preset:primary" ? restoreState.categories : null;
    const hasUsefulRestore =
      Array.isArray(restoreCategories) &&
      !areSameCategorySets(restoreCategories, currentCategories);
    const nextCategories = isCurrentPreset
      ? hasUsefulRestore
        ? [...restoreCategories]
        : [...CATEGORIES]
      : [...USER_ASSISTANT_WRITE_CATEGORIES];
    historyCategorySoloRestoreRef.current = isCurrentPreset
      ? null
      : {
          mode: "preset:primary",
          categories: [...currentCategories],
        };
    historyCategoriesRef.current = nextCategories;
    setHistoryCategories(nextCategories);
    setSessionPage(0);
  }, [historyCategoriesRef, historyCategorySoloRestoreRef, setHistoryCategories, setSessionPage]);

  const handleFocusAllHistoryCategoriesShortcut = useCallback(() => {
    const currentCategories = historyCategoriesRef.current;
    const restoreState = historyCategorySoloRestoreRef.current;
    const isCurrentPreset = areSameCategorySets(currentCategories, [...CATEGORIES]);
    const restoreCategories = restoreState?.mode === "preset:all" ? restoreState.categories : null;
    const hasUsefulRestore =
      Array.isArray(restoreCategories) &&
      !areSameCategorySets(restoreCategories, currentCategories);
    const nextCategories = isCurrentPreset
      ? hasUsefulRestore
        ? [...restoreCategories]
        : [...CATEGORIES]
      : [...CATEGORIES];
    historyCategorySoloRestoreRef.current = isCurrentPreset
      ? null
      : {
          mode: "preset:all",
          categories: [...currentCategories],
        };
    historyCategoriesRef.current = nextCategories;
    setHistoryCategories(nextCategories);
    setSessionPage(0);
  }, [historyCategoriesRef, historyCategorySoloRestoreRef, setHistoryCategories, setSessionPage]);

  const handleToggleVisibleCategoryMessagesExpanded = useCallback(
    (category: MessageCategory) => {
      const categoryMessages = messagesByCategory.get(category) ?? [];
      if (categoryMessages.length === 0) {
        return;
      }
      setMessageExpanded((value) => {
        const expanded = !categoryMessages.every(
          (message) => value[message.id] ?? isExpandedByDefault(message.category),
        );
        const next = { ...value };
        for (const message of categoryMessages) {
          applyExpansionOverride(next, message.id, message.category, expanded, {
            isExpandedByDefault,
          });
        }
        return next;
      });
    },
    [isExpandedByDefault, messagesByCategory, setMessageExpanded],
  );

  const handleToggleMessageExpanded = useCallback(
    (messageId: string, category: MessageCategory) => {
      setMessageExpanded((value) => {
        const nextExpanded = !(value[messageId] ?? isExpandedByDefault(category));
        const next = { ...value };
        applyExpansionOverride(next, messageId, category, nextExpanded, { isExpandedByDefault });
        return next;
      });
    },
    [isExpandedByDefault, setMessageExpanded],
  );

  const handleToggleCategoryDefaultExpansion = useCallback(
    (category: MessageCategory) => {
      setCategoryDefaultExpansion(category, !isExpandedByDefault(category));
    },
    [isExpandedByDefault, setCategoryDefaultExpansion],
  );

  const handleToggleAllCategoryDefaultExpansion = useCallback(() => {
    if (historyCategories.length === 0) {
      return;
    }
    const enabledCategories = new Set(historyCategories);
    const expanded = !historyCategories.every((category) => isExpandedByDefault(category));
    setExpandedByDefaultCategories((current) => {
      const preservedDisabledCategories = current.filter(
        (category) => !enabledCategories.has(category),
      );
      return expanded
        ? [...preservedDisabledCategories, ...historyCategories]
        : preservedDisabledCategories;
    });
    setMessageExpanded((value) => {
      let changed = false;
      const next = { ...value };
      for (const message of activeHistoryMessages) {
        if (!(message.id in next)) {
          continue;
        }
        delete next[message.id];
        changed = true;
      }
      return changed ? next : value;
    });
  }, [
    activeHistoryMessages,
    historyCategories,
    isExpandedByDefault,
    setExpandedByDefaultCategories,
    setMessageExpanded,
  ]);

  const ensureHistoryCategoryVisible = useCallback(
    (category: MessageCategory) => {
      const currentCategories = historyCategoriesRef.current;
      const nextCategories = ensureCategoryVisible(currentCategories, category);
      if (nextCategories === currentCategories) {
        return currentCategories;
      }
      historyCategoriesRef.current = nextCategories;
      setHistoryCategories(nextCategories);
      return nextCategories;
    },
    [historyCategoriesRef, setHistoryCategories],
  );

  const handleRevealInSession = useCallback(
    (messageId: string, sourceId: string, category: MessageCategory) => {
      const shouldRevealViaProjectTree = sessionPaneCollapsed || hideSessionsPaneForTreeView;
      const requestTreeReveal = (projectId: string, sessionId: string) => {
        if (!shouldRevealViaProjectTree) {
          return;
        }
        if (projectPaneCollapsed) {
          setProjectPaneCollapsed(false);
        }
        if (projectViewMode !== "tree") {
          setProjectViewMode("tree");
        }
        setAutoRevealSessionRequest({ projectId, sessionId });
      };

      if (historyMode === "bookmarks") {
        const bookmarked = bookmarksByMessageId.get(messageId);
        if (!bookmarked) {
          return;
        }
        const nextHistoryCategories = ensureHistoryCategoryVisible(category);
        requestTreeReveal(bookmarked.projectId, bookmarked.sessionId);
        setPendingSearchNavigation({
          targetMode: "session",
          projectId: bookmarked.projectId,
          sessionId: bookmarked.sessionId,
          messageId,
          sourceId,
          historyCategories: nextHistoryCategories,
        });
        return;
      }

      if (historyMode === "project_all") {
        const projectMessage = projectMessagesById.get(messageId);
        if (!projectMessage || !selectedProjectId) {
          return;
        }
        const nextHistoryCategories = ensureHistoryCategoryVisible(category);
        requestTreeReveal(selectedProjectId, projectMessage.sessionId);
        setPendingSearchNavigation({
          targetMode: "session",
          projectId: selectedProjectId,
          sessionId: projectMessage.sessionId,
          messageId,
          sourceId,
          historyCategories: nextHistoryCategories,
        });
        return;
      }

      if (selectedProjectId && selectedSessionId) {
        requestTreeReveal(selectedProjectId, selectedSessionId);
      }
      ensureHistoryCategoryVisible(category);
      setSessionQueryInput("");
      setFocusMessageId(messageId);
      setPendingRevealTarget({ messageId, sourceId });
    },
    [
      bookmarksByMessageId,
      ensureHistoryCategoryVisible,
      hideSessionsPaneForTreeView,
      historyMode,
      projectMessagesById,
      projectPaneCollapsed,
      projectViewMode,
      selectedProjectId,
      selectedSessionId,
      sessionPaneCollapsed,
      setAutoRevealSessionRequest,
      setFocusMessageId,
      setPendingRevealTarget,
      setPendingSearchNavigation,
      setProjectPaneCollapsed,
      setProjectViewMode,
      setSessionQueryInput,
    ],
  );

  const handleRevealInProject = useCallback(
    (messageId: string, sourceId: string, sessionId: string, category: MessageCategory) => {
      if (!selectedProjectId) {
        return;
      }
      const nextHistoryCategories = ensureHistoryCategoryVisible(category);
      setProjectProviders((value) => (value.length === PROVIDERS.length ? value : [...PROVIDERS]));
      setProjectQueryInput("");
      setPendingSearchNavigation({
        targetMode: "project_all",
        projectId: selectedProjectId,
        sessionId,
        messageId,
        sourceId,
        historyCategories: nextHistoryCategories,
      });
      setHistorySelection(createHistorySelection("project_all", selectedProjectId));
    },
    [
      ensureHistoryCategoryVisible,
      selectedProjectId,
      setHistorySelection,
      setPendingSearchNavigation,
      setProjectProviders,
      setProjectQueryInput,
    ],
  );

  const handleRevealInBookmarks = useCallback(
    (messageId: string, sourceId: string) => {
      if (!selectedProjectId || historyMode === "bookmarks") {
        return;
      }
      setBookmarkQueryInput("");
      openProjectBookmarksView(selectedProjectId);
      setFocusMessageId(messageId);
      setPendingRevealTarget({ messageId, sourceId });
    },
    [
      historyMode,
      openProjectBookmarksView,
      selectedProjectId,
      setBookmarkQueryInput,
      setFocusMessageId,
      setPendingRevealTarget,
    ],
  );

  const handleToggleBookmark = useCallback(
    async (message: HistoryMessage) => {
      if (!selectedProjectId) {
        return;
      }
      try {
        await codetrail.invoke("bookmarks:toggle", {
          projectId: selectedProjectId,
          sessionId: message.sessionId,
          messageId: message.id,
          messageSourceId: message.sourceId,
        });
        await Promise.all([
          loadBookmarks(),
          loadProjects("resort"),
          loadSessions(),
          refreshTreeProjectSessions(),
        ]);
        refreshVisibleBookmarkStates();
      } catch (error) {
        logError("Failed toggling bookmark", error);
      }
    },
    [
      codetrail,
      loadBookmarks,
      loadProjects,
      loadSessions,
      logError,
      refreshTreeProjectSessions,
      refreshVisibleBookmarkStates,
      selectedProjectId,
    ],
  );

  const handleMessageListScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      sessionScrollTopRef.current = Math.max(0, Math.round(event.currentTarget.scrollTop));
      if (sessionScrollSyncTimerRef.current !== null) {
        return;
      }
      sessionScrollSyncTimerRef.current = window.setTimeout(() => {
        sessionScrollSyncTimerRef.current = null;
        setSessionScrollTop((value) =>
          value === sessionScrollTopRef.current ? value : sessionScrollTopRef.current,
        );
      }, 120);
    },
    [sessionScrollSyncTimerRef, sessionScrollTopRef, setSessionScrollTop],
  );

  const handleHistorySearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (
        event.key !== "Enter" &&
        event.key !== "Escape" &&
        !(event.key === "Tab" && !event.shiftKey)
      ) {
        return;
      }
      event.preventDefault();
      messageListRef.current?.focus({ preventScroll: true });
    },
    [messageListRef],
  );

  return {
    handleToggleHistoryCategoryShortcut,
    handleSoloHistoryCategoryShortcut,
    handleTogglePrimaryHistoryCategoriesShortcut,
    handleToggleAllHistoryCategoriesShortcut,
    handleFocusPrimaryHistoryCategoriesShortcut,
    handleFocusAllHistoryCategoriesShortcut,
    handleToggleVisibleCategoryMessagesExpanded,
    handleToggleCategoryDefaultExpansion,
    handleToggleAllCategoryDefaultExpansion,
    handleToggleMessageExpanded,
    handleRevealInSession,
    handleRevealInProject,
    handleRevealInBookmarks,
    handleToggleBookmark,
    handleMessageListScroll,
    handleHistorySearchKeyDown,
  };
}

function applyExpansionOverride(
  overrides: Record<string, boolean>,
  messageId: string,
  category: MessageCategory,
  expanded: boolean,
  options: { isExpandedByDefault: (category: MessageCategory) => boolean },
): void {
  if (expanded === options.isExpandedByDefault(category)) {
    delete overrides[messageId];
    return;
  }
  overrides[messageId] = expanded;
}
