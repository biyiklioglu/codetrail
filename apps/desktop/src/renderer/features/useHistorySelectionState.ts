import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, SetStateAction } from "react";

import {
  createHistorySelectionFromPaneState,
} from "../app/historySelection";
import type {
  HistorySelection,
  HistorySelectionCommitMode,
  PaneStateSnapshot,
} from "../app/types";

type PendingSelectionCommit =
  | {
      kind: "selection";
      selection: HistorySelection;
      delayMs: number;
    }
  | {
      kind: "noop";
      delayMs: number;
    };

const PROJECT_SELECTION_COMMIT_DEBOUNCE_MS = 140;
const SESSION_SELECTION_COMMIT_DEBOUNCE_MS = 140;

let _testHistorySelectionDebounceOverrides: { project: number; session: number } | null = null;

function getHistorySelectionCommitDebounceMs(kind: "project" | "session"): number {
  if (_testHistorySelectionDebounceOverrides) {
    return kind === "project"
      ? _testHistorySelectionDebounceOverrides.project
      : _testHistorySelectionDebounceOverrides.session;
  }
  return kind === "project"
    ? PROJECT_SELECTION_COMMIT_DEBOUNCE_MS
    : SESSION_SELECTION_COMMIT_DEBOUNCE_MS;
}

function historySelectionsEqual(left: HistorySelection, right: HistorySelection): boolean {
  if (left.mode !== right.mode || left.projectId !== right.projectId) {
    return false;
  }
  if (left.mode !== "session" && right.mode !== "session") {
    return true;
  }
  return left.mode === "session" && right.mode === "session" && left.sessionId === right.sessionId;
}

export function setTestHistorySelectionDebounceOverrides(
  overrides: { project: number; session: number } | null,
): void {
  _testHistorySelectionDebounceOverrides = overrides;
}

export function useHistorySelectionState(initialPaneState?: PaneStateSnapshot | null): {
  selection: HistorySelection;
  committedSelection: HistorySelection;
  pendingProjectPaneFocusCommitModeRef: MutableRefObject<HistorySelectionCommitMode>;
  pendingProjectPaneFocusWaitForKeyboardIdleRef: MutableRefObject<boolean>;
  clearSelectionCommitTimer: () => void;
  queueSelectionNoopCommit: (
    commitMode?: HistorySelectionCommitMode,
    waitForKeyboardIdle?: boolean,
  ) => void;
  setHistorySelectionImmediate: (value: SetStateAction<HistorySelection>) => void;
  setHistorySelectionWithCommitMode: (
    value: SetStateAction<HistorySelection>,
    commitMode?: HistorySelectionCommitMode,
    waitForKeyboardIdle?: boolean,
  ) => void;
  consumeProjectPaneFocusSelectionBehavior: () => {
    commitMode: HistorySelectionCommitMode;
    waitForKeyboardIdle: boolean;
  };
} {
  const [selection, setHistorySelection] = useState<HistorySelection>(() =>
    createHistorySelectionFromPaneState(initialPaneState),
  );
  const [committedSelection, setCommittedSelection] = useState<HistorySelection>(() =>
    createHistorySelectionFromPaneState(initialPaneState),
  );

  const selectionRef = useRef(selection);
  const committedSelectionRef = useRef(committedSelection);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const pendingDebouncedSelectionRef = useRef<PendingSelectionCommit | null>(null);
  const pendingProjectPaneFocusCommitModeRef = useRef<HistorySelectionCommitMode>("immediate");
  const pendingProjectPaneFocusWaitForKeyboardIdleRef = useRef(false);

  const clearSelectionCommitTimer = useCallback(() => {
    if (selectionCommitTimerRef.current === null) {
      return;
    }
    window.clearTimeout(selectionCommitTimerRef.current);
    selectionCommitTimerRef.current = null;
  }, []);

  const commitHistorySelection = useCallback(
    (nextSelection: HistorySelection) => {
      clearSelectionCommitTimer();
      selectionRef.current = nextSelection;
      setHistorySelection((current) =>
        historySelectionsEqual(current, nextSelection) ? current : nextSelection,
      );
      committedSelectionRef.current = nextSelection;
      setCommittedSelection((current) =>
        historySelectionsEqual(current, nextSelection) ? current : nextSelection,
      );
    },
    [clearSelectionCommitTimer],
  );

  const scheduleCommittedSelection = useCallback(
    (nextSelection: HistorySelection, delayMs: number) => {
      pendingDebouncedSelectionRef.current = null;
      clearSelectionCommitTimer();
      selectionCommitTimerRef.current = window.setTimeout(() => {
        selectionCommitTimerRef.current = null;
        commitHistorySelection(nextSelection);
      }, delayMs);
    },
    [clearSelectionCommitTimer, commitHistorySelection],
  );

  const scheduleNoopCommit = useCallback(
    (delayMs: number) => {
      pendingDebouncedSelectionRef.current = null;
      clearSelectionCommitTimer();
      selectionCommitTimerRef.current = window.setTimeout(() => {
        selectionCommitTimerRef.current = null;
      }, delayMs);
    },
    [clearSelectionCommitTimer],
  );

  const flushPendingDebouncedSelection = useCallback(() => {
    const pendingCommit = pendingDebouncedSelectionRef.current;
    if (!pendingCommit) {
      return;
    }
    if (pendingCommit.kind === "selection") {
      scheduleCommittedSelection(pendingCommit.selection, pendingCommit.delayMs);
      return;
    }
    scheduleNoopCommit(pendingCommit.delayMs);
  }, [scheduleCommittedSelection, scheduleNoopCommit]);

  const setHistorySelectionWithCommitMode = useCallback(
    (
      value: SetStateAction<HistorySelection>,
      commitMode: HistorySelectionCommitMode = "immediate",
      waitForKeyboardIdle = false,
    ) => {
      const nextSelection = typeof value === "function" ? value(selectionRef.current) : value;
      selectionRef.current = nextSelection;
      setHistorySelection((current) =>
        historySelectionsEqual(current, nextSelection) ? current : nextSelection,
      );

      if (commitMode === "immediate") {
        pendingDebouncedSelectionRef.current = null;
        commitHistorySelection(nextSelection);
        return;
      }

      const delayMs = getHistorySelectionCommitDebounceMs(
        commitMode === "debounced_project" ? "project" : "session",
      );
      if (waitForKeyboardIdle) {
        pendingDebouncedSelectionRef.current = {
          kind: "selection",
          selection: nextSelection,
          delayMs,
        };
        clearSelectionCommitTimer();
        return;
      }
      scheduleCommittedSelection(nextSelection, delayMs);
    },
    [clearSelectionCommitTimer, commitHistorySelection, scheduleCommittedSelection],
  );

  const setHistorySelectionImmediate = useCallback(
    (value: SetStateAction<HistorySelection>) => {
      setHistorySelectionWithCommitMode(value, "immediate");
    },
    [setHistorySelectionWithCommitMode],
  );

  const queueSelectionNoopCommit = useCallback(
    (
      commitMode: HistorySelectionCommitMode = "immediate",
      waitForKeyboardIdle = false,
    ) => {
      if (commitMode === "immediate") {
        pendingDebouncedSelectionRef.current = null;
        clearSelectionCommitTimer();
        return;
      }

      const delayMs = getHistorySelectionCommitDebounceMs(
        commitMode === "debounced_project" ? "project" : "session",
      );
      if (waitForKeyboardIdle) {
        pendingDebouncedSelectionRef.current = {
          kind: "noop",
          delayMs,
        };
        clearSelectionCommitTimer();
        return;
      }
      scheduleNoopCommit(delayMs);
    },
    [clearSelectionCommitTimer, scheduleNoopCommit],
  );

  const consumeProjectPaneFocusSelectionBehavior = useCallback(() => {
    const nextCommitMode = pendingProjectPaneFocusCommitModeRef.current;
    const waitForKeyboardIdle = pendingProjectPaneFocusWaitForKeyboardIdleRef.current;
    pendingProjectPaneFocusCommitModeRef.current = "immediate";
    pendingProjectPaneFocusWaitForKeyboardIdleRef.current = false;
    return {
      commitMode: nextCommitMode,
      waitForKeyboardIdle,
    };
  }, []);

  useEffect(() => {
    const flushOnArrowRelease = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      flushPendingDebouncedSelection();
    };
    const flushOnBlur = () => {
      flushPendingDebouncedSelection();
    };
    window.addEventListener("keyup", flushOnArrowRelease);
    window.addEventListener("blur", flushOnBlur);
    return () => {
      window.removeEventListener("keyup", flushOnArrowRelease);
      window.removeEventListener("blur", flushOnBlur);
    };
  }, [flushPendingDebouncedSelection]);

  return {
    selection,
    committedSelection,
    pendingProjectPaneFocusCommitModeRef,
    pendingProjectPaneFocusWaitForKeyboardIdleRef,
    clearSelectionCommitTimer,
    queueSelectionNoopCommit,
    setHistorySelectionImmediate,
    setHistorySelectionWithCommitMode,
    consumeProjectPaneFocusSelectionBehavior,
  };
}
