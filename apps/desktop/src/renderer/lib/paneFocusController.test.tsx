// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PaneFocusProvider,
  useCreatePaneFocusController,
  usePaneFocus,
} from "./paneFocusController";

function PaneFocusHarness() {
  const controller = useCreatePaneFocusController();

  return (
    <PaneFocusProvider controller={controller}>
      <PaneFocusHarnessInner />
    </PaneFocusProvider>
  );
}

function PaneFocusHarnessInner() {
  const paneFocus = usePaneFocus();
  const [sessionCollapsed, setSessionCollapsed] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => paneFocus.focusHistoryPane("project")}>
        focus-project
      </button>
      <button type="button" onClick={() => paneFocus.focusHistoryPane("session")}>
        focus-session
      </button>
      <button type="button" onClick={() => paneFocus.focusHistoryPane("message")}>
        focus-message
      </button>
      <button type="button" onClick={() => paneFocus.enterView("help")}>
        enter-help
      </button>
      <button type="button" onClick={() => paneFocus.enterView("search")}>
        enter-search
      </button>
      <button type="button" onClick={() => paneFocus.exitViewAndRestoreHistoryPane()}>
        restore-history
      </button>
      <button type="button" onClick={() => setSessionCollapsed((current) => !current)}>
        toggle-session-collapsed
      </button>
      <button
        type="button"
        onClick={() => {
          const token = paneFocus.pushOverlay();
          const testWindow = window as Window & { __paneFocusOverlayTokens?: number[] };
          testWindow.__paneFocusOverlayTokens = [
            ...(testWindow.__paneFocusOverlayTokens ?? []),
            token,
          ];
        }}
      >
        push-overlay
      </button>
      <button
        type="button"
        onClick={() => {
          const testWindow = window as Window & { __paneFocusOverlayTokens?: number[] };
          const token = testWindow.__paneFocusOverlayTokens?.pop();
          if (typeof token === "number") {
            paneFocus.popOverlayAndRestore(token);
          }
        }}
      >
        pop-overlay
      </button>

      <div data-testid="active-domain">
        {paneFocus.activeDomain.kind === "history"
          ? `history:${paneFocus.activeDomain.pane}`
          : paneFocus.activeDomain.kind}
      </div>
      <div data-testid="last-history-pane">{paneFocus.lastHistoryPane}</div>
      <div data-testid="overlay-depth">{paneFocus.overlayDepth}</div>

      <aside
        className="history-focus-pane"
        {...paneFocus.getHistoryPaneRootProps("project")}
        ref={(element) => paneFocus.registerHistoryPaneRoot("project", element)}
      >
        <button
          ref={(element) => paneFocus.registerHistoryPaneTarget("project", element)}
          type="button"
        >
          project-target
        </button>
      </aside>
      <aside
        className={`history-focus-pane${sessionCollapsed ? " collapsed" : ""}`}
        {...paneFocus.getHistoryPaneRootProps("session")}
        ref={(element) => paneFocus.registerHistoryPaneRoot("session", element)}
      >
        <button
          ref={(element) => paneFocus.registerHistoryPaneTarget("session", element)}
          type="button"
        >
          session-target
        </button>
      </aside>
      <section
        className="history-focus-pane"
        {...paneFocus.getHistoryPaneRootProps("message")}
        ref={(element) => paneFocus.registerHistoryPaneRoot("message", element)}
      >
        <div data-testid="message-chrome" {...paneFocus.getPaneChromeProps("message")}>
          <span>message-count-text</span>
        </div>
        <button
          data-testid="message-preserve-button"
          type="button"
          {...paneFocus.getPreservePaneFocusProps("message")}
        >
          message-preserve-button
        </button>
        <button
          ref={(element) => paneFocus.registerHistoryPaneTarget("message", element)}
          type="button"
        >
          message-target
        </button>
      </section>

      <section ref={(element) => paneFocus.registerViewTarget("help", element)} tabIndex={-1}>
        help-target
      </section>
      <section ref={(element) => paneFocus.registerViewTarget("search", element)} tabIndex={-1}>
        search-target
      </section>
      <section ref={(element) => paneFocus.registerViewTarget("settings", element)} tabIndex={-1}>
        settings-target
      </section>
    </div>
  );
}

afterEach(() => {
  delete (window as Window & { __paneFocusOverlayTokens?: number[] }).__paneFocusOverlayTokens;
  vi.restoreAllMocks();
});

describe("paneFocusController", () => {
  it("defaults to the message pane", () => {
    render(<PaneFocusHarness />);

    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:message");
    expect(screen.getByTestId("last-history-pane")).toHaveTextContent("message");
    expect(screen.getByText("message-target").closest('[data-pane-active="true"]')).not.toBeNull();
  });

  it("tracks active and last history panes when focus moves", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-project"));
    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:project");
    expect(screen.getByTestId("last-history-pane")).toHaveTextContent("project");

    fireEvent.click(screen.getByText("focus-session"));
    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:session");
    expect(screen.getByTestId("last-history-pane")).toHaveTextContent("session");
  });

  it("preserves the last history pane when entering and exiting full views", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-project"));
    fireEvent.click(screen.getByText("enter-help"));
    expect(screen.getByTestId("active-domain")).toHaveTextContent("help");
    expect(screen.getByTestId("last-history-pane")).toHaveTextContent("project");

    fireEvent.click(screen.getByText("restore-history"));
    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:project");
    expect(document.activeElement).toBe(screen.getByText("project-target"));
  });

  it("restores the prior domain after overlays close", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-session"));
    fireEvent.click(screen.getByText("enter-search"));
    fireEvent.click(screen.getByText("push-overlay"));
    fireEvent.click(screen.getByText("push-overlay"));

    expect(screen.getByTestId("active-domain")).toHaveTextContent("overlay");
    expect(screen.getByTestId("overlay-depth")).toHaveTextContent("2");

    fireEvent.click(screen.getByText("pop-overlay"));
    expect(screen.getByTestId("active-domain")).toHaveTextContent("overlay");
    expect(screen.getByTestId("overlay-depth")).toHaveTextContent("1");

    fireEvent.click(screen.getByText("pop-overlay"));
    expect(screen.getByTestId("active-domain")).toHaveTextContent("search");
    expect(document.activeElement).toHaveTextContent("search-target");
  });

  it("restores the enclosing view after overlays close from help", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-project"));
    fireEvent.click(screen.getByText("enter-help"));
    fireEvent.click(screen.getByText("push-overlay"));

    expect(screen.getByTestId("active-domain")).toHaveTextContent("overlay");

    fireEvent.click(screen.getByText("pop-overlay"));

    expect(screen.getByTestId("active-domain")).toHaveTextContent("help");
    expect(screen.getByTestId("last-history-pane")).toHaveTextContent("project");
    expect(document.activeElement).toBe(screen.getByText("help-target"));
  });

  it("restores the last history pane when overlays close from history", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-session"));
    fireEvent.click(screen.getByText("push-overlay"));
    fireEvent.click(screen.getByText("pop-overlay"));

    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:session");
    expect(screen.getByTestId("last-history-pane")).toHaveTextContent("session");
    expect(document.activeElement).toBe(screen.getByText("session-target"));
  });

  it("restores the nearest available history pane when the previous pane is no longer available", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-session"));
    fireEvent.click(screen.getByText("enter-help"));
    fireEvent.click(screen.getByText("toggle-session-collapsed"));
    fireEvent.click(screen.getByText("restore-history"));

    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:message");
    expect(screen.getByTestId("last-history-pane")).toHaveTextContent("message");
    expect(document.activeElement).toBe(screen.getByText("message-target"));
  });

  it("focuses pane chrome without preventing default selection behavior", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-project"));

    const text = screen.getByText("message-count-text");
    const event = createMouseDownEvent(text);
    fireEvent(text, event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:message");
    expect(document.activeElement).toBe(screen.getByText("project-target"));

    fireEvent.click(text);
    expect(document.activeElement).toBe(screen.getByText("message-target"));
  });

  it("does not refocus pane chrome while the user has selected text", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-project"));
    const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "message-count-text",
    } as Selection);

    fireEvent.click(screen.getByText("message-count-text"));

    expect(getSelection).toHaveBeenCalled();
    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:project");
    expect(document.activeElement).toBe(screen.getByText("project-target"));
  });

  it("preserves pane focus buttons by preventing default focus transfer", () => {
    render(<PaneFocusHarness />);

    fireEvent.click(screen.getByText("focus-project"));

    const button = screen.getByTestId("message-preserve-button");
    const event = createMouseDownEvent(button);
    fireEvent(button, event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByTestId("active-domain")).toHaveTextContent("history:message");
    expect(document.activeElement).toBe(screen.getByText("message-target"));
  });
});

function createMouseDownEvent(target: HTMLElement) {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(event, "target", {
    value: target,
    configurable: true,
  });
  return event;
}
