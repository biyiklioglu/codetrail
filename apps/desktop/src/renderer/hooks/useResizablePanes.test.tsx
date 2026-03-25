// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useResizablePanes } from "./useResizablePanes";

function Harness({ isHistoryLayout }: { isHistoryLayout: boolean }) {
  const panes = useResizablePanes({
    isHistoryLayout,
    projectMin: 230,
    projectMax: 520,
    sessionMin: 250,
    sessionMax: 620,
    initialProjectPaneWidth: 300,
    initialSessionPaneWidth: 320,
  });

  return (
    <div>
      <div data-testid="project-width">{panes.projectPaneWidth}</div>
      <div data-testid="session-width">{panes.sessionPaneWidth}</div>
      <div data-testid="project-handle" onPointerDown={panes.beginResize("project")} />
      <div data-testid="session-handle" onPointerDown={panes.beginResize("session")} />
    </div>
  );
}

describe("useResizablePanes", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    document.body.classList.remove("resizing-panels");
    vi.unstubAllGlobals();
  });

  it("resizes project and session panes within configured bounds", () => {
    if (!window.PointerEvent) {
      Object.defineProperty(window, "PointerEvent", {
        value: MouseEvent,
        configurable: true,
      });
    }

    render(<Harness isHistoryLayout={true} />);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("project-handle"), { clientX: 100 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 200 }));
    });
    expect(screen.getByTestId("project-width").textContent).toBe("300");
    expect(screen.getByTestId("project-handle").style.transform).toBe("translateX(100px)");
    expect(document.body.classList.contains("resizing-panels")).toBe(true);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(screen.getByTestId("project-width").textContent).toBe("400");
    expect(screen.getByTestId("project-handle").style.transform).toBe("");
    expect(document.body.classList.contains("resizing-panels")).toBe(false);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("session-handle"), { clientX: 250 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 600 }));
    });
    expect(screen.getByTestId("session-width").textContent).toBe("320");
    expect(screen.getByTestId("session-handle").style.transform).toBe("translateX(300px)");

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(screen.getByTestId("session-width").textContent).toBe("620");
    expect(screen.getByTestId("session-handle").style.transform).toBe("");
  });

  it("ignores pointer down events outside history layout", () => {
    if (!window.PointerEvent) {
      Object.defineProperty(window, "PointerEvent", {
        value: MouseEvent,
        configurable: true,
      });
    }

    render(<Harness isHistoryLayout={false} />);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("project-handle"), { clientX: 100 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 420 }));
    });

    expect(screen.getByTestId("project-width").textContent).toBe("300");
    expect(document.body.classList.contains("resizing-panels")).toBe(false);
  });

  it("does not overwrite the other pane width while dragging", () => {
    if (!window.PointerEvent) {
      Object.defineProperty(window, "PointerEvent", {
        value: MouseEvent,
        configurable: true,
      });
    }

    render(<Harness isHistoryLayout={true} />);
    const sessionHandle = screen.getByTestId("session-handle");

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("project-handle"), { clientX: 100 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 180 }));
    });

    expect(screen.getByTestId("project-handle").style.transform).toBe("translateX(80px)");
    expect(sessionHandle.style.transform).toBe("");
  });
});
