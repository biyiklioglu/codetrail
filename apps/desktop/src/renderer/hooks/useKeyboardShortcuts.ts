import { useEffect } from "react";
import type { MessageCategory } from "@codetrail/core";

type MainView = "history" | "search" | "settings" | "help";

export function useKeyboardShortcuts(args: {
  mainView: MainView;
  hasFocusedHistoryMessage: boolean;
  setMainView: (view: MainView | ((value: MainView) => MainView)) => void;
  clearFocusedHistoryMessage: () => void;
  focusGlobalSearch: () => void;
  focusSessionSearch: () => void;
  toggleFocusMode: () => void;
  toggleScopedMessagesExpanded: () => void;
  toggleHistoryCategory: (category: MessageCategory) => void;
  toggleProjectPaneCollapsed: () => void;
  toggleSessionPaneCollapsed: () => void;
  goToPreviousHistoryPage: () => void;
  goToNextHistoryPage: () => void;
  goToPreviousSearchPage: () => void;
  goToNextSearchPage: () => void;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
}): void {
  const {
    mainView,
    hasFocusedHistoryMessage,
    setMainView,
    clearFocusedHistoryMessage,
    focusGlobalSearch,
    focusSessionSearch,
    toggleFocusMode,
    toggleScopedMessagesExpanded,
    toggleHistoryCategory,
    toggleProjectPaneCollapsed,
    toggleSessionPaneCollapsed,
    goToPreviousHistoryPage,
    goToNextHistoryPage,
    goToPreviousSearchPage,
    goToNextSearchPage,
    applyZoomAction,
  } = args;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "?" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setMainView("help");
      } else if (event.key === "Escape") {
        if (mainView === "search" || mainView === "settings" || mainView === "help") {
          event.preventDefault();
          setMainView("history");
        } else if (mainView === "history" && hasFocusedHistoryMessage) {
          event.preventDefault();
          clearFocusedHistoryMessage();
        }
      } else if (command && shift && key === "f") {
        event.preventDefault();
        focusGlobalSearch();
      } else if (command && key === "f") {
        event.preventDefault();
        focusSessionSearch();
      } else if (command && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        void applyZoomAction("in");
      } else if (command && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        void applyZoomAction("out");
      } else if (command && event.key === "0") {
        event.preventDefault();
        void applyZoomAction("reset");
      } else if (
        command &&
        !shift &&
        !event.altKey &&
        event.key === "ArrowLeft" &&
        !isEditableTarget(event.target)
      ) {
        if (mainView === "history") {
          event.preventDefault();
          goToPreviousHistoryPage();
        } else if (mainView === "search") {
          event.preventDefault();
          goToPreviousSearchPage();
        }
      } else if (
        command &&
        !shift &&
        !event.altKey &&
        event.key === "ArrowRight" &&
        !isEditableTarget(event.target)
      ) {
        if (mainView === "history") {
          event.preventDefault();
          goToNextHistoryPage();
        } else if (mainView === "search") {
          event.preventDefault();
          goToNextSearchPage();
        }
      } else if (mainView === "history" && command && shift && key === "m") {
        event.preventDefault();
        toggleFocusMode();
      } else if (mainView === "history" && command && key === "e") {
        event.preventDefault();
        toggleScopedMessagesExpanded();
      } else if (mainView === "history" && command && shift && key === "b") {
        event.preventDefault();
        toggleSessionPaneCollapsed();
      } else if (mainView === "history" && command && key === "b") {
        event.preventDefault();
        toggleProjectPaneCollapsed();
      } else if (mainView === "history" && command && event.key === "1") {
        event.preventDefault();
        toggleHistoryCategory("user");
      } else if (mainView === "history" && command && event.key === "2") {
        event.preventDefault();
        toggleHistoryCategory("assistant");
      } else if (mainView === "history" && command && event.key === "3") {
        event.preventDefault();
        toggleHistoryCategory("tool_edit");
      } else if (mainView === "history" && command && event.key === "4") {
        event.preventDefault();
        toggleHistoryCategory("tool_use");
      } else if (mainView === "history" && command && event.key === "5") {
        event.preventDefault();
        toggleHistoryCategory("tool_result");
      } else if (mainView === "history" && command && event.key === "6") {
        event.preventDefault();
        toggleHistoryCategory("thinking");
      } else if (mainView === "history" && command && event.key === "7") {
        event.preventDefault();
        toggleHistoryCategory("system");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    applyZoomAction,
    clearFocusedHistoryMessage,
    focusGlobalSearch,
    focusSessionSearch,
    hasFocusedHistoryMessage,
    mainView,
    setMainView,
    goToNextHistoryPage,
    goToPreviousHistoryPage,
    goToNextSearchPage,
    goToPreviousSearchPage,
    toggleFocusMode,
    toggleHistoryCategory,
    toggleProjectPaneCollapsed,
    toggleScopedMessagesExpanded,
    toggleSessionPaneCollapsed,
  ]);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}
