import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { clamp } from "../lib/viewUtils";

type Pane = "project" | "session";

export function useResizablePanes(args: {
  isHistoryLayout: boolean;
  projectMin: number;
  projectMax: number;
  sessionMin: number;
  sessionMax: number;
  initialProjectPaneWidth?: number;
  initialSessionPaneWidth?: number;
}) {
  const {
    isHistoryLayout,
    projectMin,
    projectMax,
    sessionMin,
    sessionMax,
    initialProjectPaneWidth = 300,
    initialSessionPaneWidth = 320,
  } = args;
  const [projectPaneWidth, setProjectPaneWidth] = useState(initialProjectPaneWidth);
  const [sessionPaneWidth, setSessionPaneWidth] = useState(initialSessionPaneWidth);
  const widthStateRef = useRef({
    projectPaneWidth: initialProjectPaneWidth,
    sessionPaneWidth: initialSessionPaneWidth,
  });
  const pendingFrameRef = useRef<number | null>(null);
  const resizeState = useRef<{
    pane: Pane;
    startX: number;
    projectPaneWidth: number;
    sessionPaneWidth: number;
    handleElement: HTMLDivElement;
  } | null>(null);

  const beginResize = useCallback(
    (pane: Pane) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isHistoryLayout) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      resizeState.current = {
        pane,
        startX: event.clientX,
        projectPaneWidth: widthStateRef.current.projectPaneWidth,
        sessionPaneWidth: widthStateRef.current.sessionPaneWidth,
        handleElement: event.currentTarget,
      };
      document.body.classList.add("resizing-panels");
    },
    [isHistoryLayout],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const active = resizeState.current;
      if (!active) {
        return;
      }

      const delta = event.clientX - active.startX;
      let previewOffset = 0;
      if (active.pane === "project") {
        const nextProjectPaneWidth = clamp(active.projectPaneWidth + delta, projectMin, projectMax);
        previewOffset = nextProjectPaneWidth - active.projectPaneWidth;
        widthStateRef.current = {
          projectPaneWidth: nextProjectPaneWidth,
          sessionPaneWidth: active.sessionPaneWidth,
        };
      } else {
        const nextSessionPaneWidth = clamp(active.sessionPaneWidth + delta, sessionMin, sessionMax);
        previewOffset = nextSessionPaneWidth - active.sessionPaneWidth;
        widthStateRef.current = {
          projectPaneWidth: active.projectPaneWidth,
          sessionPaneWidth: nextSessionPaneWidth,
        };
      }

      if (pendingFrameRef.current !== null) {
        return;
      }

      pendingFrameRef.current = window.requestAnimationFrame(() => {
        pendingFrameRef.current = null;
        active.handleElement.style.transform = `translateX(${Math.round(previewOffset)}px)`;
      });
    };

    const finishResize = () => {
      if (!resizeState.current) {
        return;
      }
      const active = resizeState.current;
      if (pendingFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
      active.handleElement.style.transform = "";

      if (active.pane === "project") {
        setProjectPaneWidth(widthStateRef.current.projectPaneWidth);
      } else {
        setSessionPaneWidth(widthStateRef.current.sessionPaneWidth);
      }
      resizeState.current = null;
      document.body.classList.remove("resizing-panels");
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      if (pendingFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
      resizeState.current?.handleElement.style.setProperty("transform", "");
      document.body.classList.remove("resizing-panels");
    };
  }, [projectMax, projectMin, sessionMax, sessionMin]);

  useEffect(() => {
    if (resizeState.current) {
      return;
    }
    widthStateRef.current = { projectPaneWidth, sessionPaneWidth };
  }, [projectPaneWidth, sessionPaneWidth]);

  return {
    projectPaneWidth,
    setProjectPaneWidth,
    sessionPaneWidth,
    setSessionPaneWidth,
    beginResize,
  };
}
