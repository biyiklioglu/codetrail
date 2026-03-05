// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

function Harness(args: Parameters<typeof useKeyboardShortcuts>[0]) {
  useKeyboardShortcuts(args);
  return <div>shortcuts</div>;
}

describe("useKeyboardShortcuts", () => {
  it("routes search, zoom, and history shortcuts", () => {
    const setMainView = vi.fn();
    const focusGlobalSearch = vi.fn();
    const focusSessionSearch = vi.fn();
    const toggleFocusMode = vi.fn();
    const toggleScopedMessagesExpanded = vi.fn();
    const toggleHistoryCategory = vi.fn();
    const toggleProjectPaneCollapsed = vi.fn();
    const toggleSessionPaneCollapsed = vi.fn();
    const goToPreviousHistoryPage = vi.fn();
    const goToNextHistoryPage = vi.fn();
    const goToPreviousSearchPage = vi.fn();
    const goToNextSearchPage = vi.fn();
    const applyZoomAction = vi.fn(async () => undefined);

    render(
      <Harness
        mainView="history"
        hasFocusedHistoryMessage={false}
        setMainView={setMainView}
        clearFocusedHistoryMessage={vi.fn()}
        focusGlobalSearch={focusGlobalSearch}
        focusSessionSearch={focusSessionSearch}
        toggleFocusMode={toggleFocusMode}
        toggleScopedMessagesExpanded={toggleScopedMessagesExpanded}
        toggleHistoryCategory={toggleHistoryCategory}
        toggleProjectPaneCollapsed={toggleProjectPaneCollapsed}
        toggleSessionPaneCollapsed={toggleSessionPaneCollapsed}
        goToPreviousHistoryPage={goToPreviousHistoryPage}
        goToNextHistoryPage={goToNextHistoryPage}
        goToPreviousSearchPage={goToPreviousSearchPage}
        goToNextSearchPage={goToNextSearchPage}
        applyZoomAction={applyZoomAction}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true }));

    expect(focusGlobalSearch).toHaveBeenCalledTimes(1);
    expect(focusSessionSearch).toHaveBeenCalledTimes(1);
    expect(applyZoomAction).toHaveBeenCalledWith("in");
    expect(toggleFocusMode).toHaveBeenCalledTimes(1);
    expect(toggleScopedMessagesExpanded).toHaveBeenCalledTimes(1);
    expect(toggleHistoryCategory).toHaveBeenCalledWith("user");
    expect(toggleProjectPaneCollapsed).toHaveBeenCalledTimes(1);
    expect(toggleSessionPaneCollapsed).toHaveBeenCalledTimes(1);
    expect(goToPreviousHistoryPage).toHaveBeenCalledTimes(1);
    expect(goToNextHistoryPage).toHaveBeenCalledTimes(1);
    expect(goToPreviousSearchPage).not.toHaveBeenCalled();
    expect(goToNextSearchPage).not.toHaveBeenCalled();
    expect(setMainView).not.toHaveBeenCalledWith("history");
  });

  it("routes page shortcuts to global search pagination in search view", () => {
    const goToPreviousHistoryPage = vi.fn();
    const goToNextHistoryPage = vi.fn();
    const goToPreviousSearchPage = vi.fn();
    const goToNextSearchPage = vi.fn();

    render(
      <Harness
        mainView="search"
        hasFocusedHistoryMessage={false}
        setMainView={vi.fn()}
        clearFocusedHistoryMessage={vi.fn()}
        focusGlobalSearch={vi.fn()}
        focusSessionSearch={vi.fn()}
        toggleFocusMode={vi.fn()}
        toggleScopedMessagesExpanded={vi.fn()}
        toggleHistoryCategory={vi.fn()}
        toggleProjectPaneCollapsed={vi.fn()}
        toggleSessionPaneCollapsed={vi.fn()}
        goToPreviousHistoryPage={goToPreviousHistoryPage}
        goToNextHistoryPage={goToNextHistoryPage}
        goToPreviousSearchPage={goToPreviousSearchPage}
        goToNextSearchPage={goToNextSearchPage}
        applyZoomAction={vi.fn(async () => undefined)}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true }));

    expect(goToPreviousSearchPage).toHaveBeenCalledTimes(1);
    expect(goToNextSearchPage).toHaveBeenCalledTimes(1);
    expect(goToPreviousHistoryPage).not.toHaveBeenCalled();
    expect(goToNextHistoryPage).not.toHaveBeenCalled();
  });

  it("handles escape and question-mark help shortcuts", () => {
    const setMainView = vi.fn();

    const { rerender } = render(
      <Harness
        mainView="search"
        hasFocusedHistoryMessage={false}
        setMainView={setMainView}
        clearFocusedHistoryMessage={vi.fn()}
        focusGlobalSearch={vi.fn()}
        focusSessionSearch={vi.fn()}
        toggleFocusMode={vi.fn()}
        toggleScopedMessagesExpanded={vi.fn()}
        toggleHistoryCategory={vi.fn()}
        toggleProjectPaneCollapsed={vi.fn()}
        toggleSessionPaneCollapsed={vi.fn()}
        goToPreviousHistoryPage={vi.fn()}
        goToNextHistoryPage={vi.fn()}
        goToPreviousSearchPage={vi.fn()}
        goToNextSearchPage={vi.fn()}
        applyZoomAction={vi.fn(async () => undefined)}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(setMainView).toHaveBeenCalledWith("history");

    rerender(
      <Harness
        mainView="history"
        hasFocusedHistoryMessage={false}
        setMainView={setMainView}
        clearFocusedHistoryMessage={vi.fn()}
        focusGlobalSearch={vi.fn()}
        focusSessionSearch={vi.fn()}
        toggleFocusMode={vi.fn()}
        toggleScopedMessagesExpanded={vi.fn()}
        toggleHistoryCategory={vi.fn()}
        toggleProjectPaneCollapsed={vi.fn()}
        toggleSessionPaneCollapsed={vi.fn()}
        goToPreviousHistoryPage={vi.fn()}
        goToNextHistoryPage={vi.fn()}
        goToPreviousSearchPage={vi.fn()}
        goToNextSearchPage={vi.fn()}
        applyZoomAction={vi.fn(async () => undefined)}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    expect(setMainView).toHaveBeenCalledWith("help");
  });

  it("does not open help when typing '?' in an input", () => {
    const setMainView = vi.fn();

    render(
      <div>
        <input id="query-input" />
        <Harness
          mainView="history"
          hasFocusedHistoryMessage={false}
          setMainView={setMainView}
          clearFocusedHistoryMessage={vi.fn()}
          focusGlobalSearch={vi.fn()}
          focusSessionSearch={vi.fn()}
          toggleFocusMode={vi.fn()}
          toggleScopedMessagesExpanded={vi.fn()}
          toggleHistoryCategory={vi.fn()}
          toggleProjectPaneCollapsed={vi.fn()}
          toggleSessionPaneCollapsed={vi.fn()}
          goToPreviousHistoryPage={vi.fn()}
          goToNextHistoryPage={vi.fn()}
          goToPreviousSearchPage={vi.fn()}
          goToNextSearchPage={vi.fn()}
          applyZoomAction={vi.fn(async () => undefined)}
        />
      </div>,
    );

    const input = document.getElementById("query-input");
    input?.focus();
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));

    expect(setMainView).not.toHaveBeenCalledWith("help");
  });

  it("clears focused history message on escape", () => {
    const clearFocusedHistoryMessage = vi.fn();

    render(
      <Harness
        mainView="history"
        hasFocusedHistoryMessage={true}
        setMainView={vi.fn()}
        clearFocusedHistoryMessage={clearFocusedHistoryMessage}
        focusGlobalSearch={vi.fn()}
        focusSessionSearch={vi.fn()}
        toggleFocusMode={vi.fn()}
        toggleScopedMessagesExpanded={vi.fn()}
        toggleHistoryCategory={vi.fn()}
        toggleProjectPaneCollapsed={vi.fn()}
        toggleSessionPaneCollapsed={vi.fn()}
        goToPreviousHistoryPage={vi.fn()}
        goToNextHistoryPage={vi.fn()}
        goToPreviousSearchPage={vi.fn()}
        goToNextSearchPage={vi.fn()}
        applyZoomAction={vi.fn(async () => undefined)}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(clearFocusedHistoryMessage).toHaveBeenCalledTimes(1);
  });
});
