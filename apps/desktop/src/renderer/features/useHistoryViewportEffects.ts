import { useEffect, useLayoutEffect } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";

import type { HistoryMessage, PendingMessagePageNavigation } from "../app/types";
import { getEdgeItemId } from "../lib/historyNavigation";
import {
  getMessageListFingerprint,
  scrollFocusedHistoryMessageIntoView,
} from "./historyControllerShared";
import type { RefreshContext } from "./useHistoryController";

export function useHistoryViewportEffects({
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
  activeHistoryMessages,
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
}: {
  messageListRef: RefObject<HTMLDivElement>;
  historyMode: "session" | "bookmarks" | "project_all";
  selectedProjectId: string;
  selectedSessionId: string;
  sessionPage: number;
  setSessionScrollTop: Dispatch<SetStateAction<number>>;
  sessionScrollTopRef: MutableRefObject<number>;
  pendingRestoredSessionScrollRef: MutableRefObject<{
    sessionId: string;
    sessionPage: number;
    scrollTop: number;
  } | null>;
  refreshContextRef: MutableRefObject<RefreshContext | null>;
  pendingAutoScrollRef: MutableRefObject<boolean>;
  prevMessageIdsRef: MutableRefObject<string>;
  activeHistoryMessages: HistoryMessage[];
  activeMessageSortDirection: "asc" | "desc";
  focusMessageId: string;
  visibleFocusedMessageId: string;
  focusedMessagePosition: number;
  focusedMessageRef: RefObject<HTMLDivElement>;
  pendingMessageAreaFocus: boolean;
  setPendingMessageAreaFocus: Dispatch<SetStateAction<boolean>>;
  pendingMessagePageNavigation: PendingMessagePageNavigation | null;
  loadedHistoryPage: number;
  setPendingMessagePageNavigation: Dispatch<SetStateAction<PendingMessagePageNavigation | null>>;
  setFocusMessageId: Dispatch<SetStateAction<string>>;
  scrollPreservationRef: MutableRefObject<{
    scrollTop: number;
    referenceMessageId: string;
    referenceOffsetTop: number;
  } | null>;
}) {
  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }
    const scrollScopeId = historyMode === "project_all" ? selectedProjectId : selectedSessionId;
    if (!scrollScopeId || sessionPage < 0) {
      messageListRef.current.scrollTop = 0;
      sessionScrollTopRef.current = 0;
      setSessionScrollTop(0);
      return;
    }

    const refreshCtx = refreshContextRef.current;
    if (refreshCtx?.autoScroll) {
      pendingAutoScrollRef.current = true;
      prevMessageIdsRef.current = refreshCtx.prevMessageIds;
      refreshContextRef.current = null;
      return;
    }

    const pendingRestore = pendingRestoredSessionScrollRef.current;
    if (
      pendingRestore &&
      pendingRestore.sessionId === scrollScopeId &&
      pendingRestore.sessionPage === sessionPage
    ) {
      messageListRef.current.scrollTop = pendingRestore.scrollTop;
      sessionScrollTopRef.current = pendingRestore.scrollTop;
      setSessionScrollTop(pendingRestore.scrollTop);
      pendingRestoredSessionScrollRef.current = null;
      return;
    }

    if (pendingRestore) {
      pendingRestoredSessionScrollRef.current = null;
    }
    messageListRef.current.scrollTop = 0;
    sessionScrollTopRef.current = 0;
    setSessionScrollTop(0);
  }, [
    historyMode,
    messageListRef,
    pendingAutoScrollRef,
    pendingRestoredSessionScrollRef,
    prevMessageIdsRef,
    refreshContextRef,
    selectedProjectId,
    selectedSessionId,
    sessionPage,
    sessionScrollTopRef,
    setSessionScrollTop,
  ]);

  useEffect(() => {
    if (
      !focusMessageId ||
      !visibleFocusedMessageId ||
      focusedMessagePosition < 0 ||
      !focusedMessageRef.current ||
      !messageListRef.current
    ) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      if (!focusedMessageRef.current || !messageListRef.current) {
        return;
      }
      scrollFocusedHistoryMessageIntoView(messageListRef.current, focusedMessageRef.current);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [
    focusMessageId,
    focusedMessagePosition,
    focusedMessageRef,
    messageListRef,
    visibleFocusedMessageId,
  ]);

  useEffect(() => {
    if (!pendingMessageAreaFocus || !visibleFocusedMessageId || !messageListRef.current) {
      return;
    }

    messageListRef.current.focus({ preventScroll: true });
    setPendingMessageAreaFocus(false);
  }, [messageListRef, pendingMessageAreaFocus, setPendingMessageAreaFocus, visibleFocusedMessageId]);

  useEffect(() => {
    if (!pendingMessagePageNavigation) {
      return;
    }
    if (loadedHistoryPage !== pendingMessagePageNavigation.targetPage) {
      return;
    }

    const targetMessageId = getEdgeItemId(
      activeHistoryMessages,
      pendingMessagePageNavigation.direction,
    );
    setPendingMessagePageNavigation(null);
    if (!targetMessageId) {
      return;
    }
    setFocusMessageId(targetMessageId);
  }, [
    activeHistoryMessages,
    loadedHistoryPage,
    pendingMessagePageNavigation,
    setFocusMessageId,
    setPendingMessagePageNavigation,
  ]);

  useLayoutEffect(() => {
    const container = messageListRef.current;
    if (!container) {
      return;
    }

    const refreshCtx = refreshContextRef.current;
    if (refreshCtx !== null) {
      refreshContextRef.current = null;
      if (refreshCtx.autoScroll) {
        const currentFingerprint = getMessageListFingerprint(activeHistoryMessages);
        if (currentFingerprint !== refreshCtx.prevMessageIds) {
          window.requestAnimationFrame(() => {
            container.scrollTop = activeMessageSortDirection === "asc" ? container.scrollHeight : 0;
          });
        }
        return;
      }
      if (refreshCtx.scrollPreservation) {
        const saved = refreshCtx.scrollPreservation;
        const refEl = container.querySelector<HTMLElement>(
          `[data-history-message-id="${CSS.escape(saved.referenceMessageId)}"]`,
        );
        if (refEl) {
          container.scrollTop = saved.scrollTop + (refEl.offsetTop - saved.referenceOffsetTop);
          return;
        }
        container.scrollTop = saved.scrollTop;
        return;
      }
    }

    if (pendingAutoScrollRef.current) {
      pendingAutoScrollRef.current = false;
      const currentFingerprint = getMessageListFingerprint(activeHistoryMessages);
      if (currentFingerprint !== prevMessageIdsRef.current) {
        prevMessageIdsRef.current = currentFingerprint;
        window.requestAnimationFrame(() => {
          container.scrollTop = activeMessageSortDirection === "asc" ? container.scrollHeight : 0;
        });
      }
      return;
    }

    const saved = scrollPreservationRef.current;
    if (!saved) {
      return;
    }
    scrollPreservationRef.current = null;

    if (saved.referenceMessageId) {
      const refEl = container.querySelector<HTMLElement>(
        `[data-history-message-id="${CSS.escape(saved.referenceMessageId)}"]`,
      );
      if (refEl) {
        container.scrollTop = saved.scrollTop + (refEl.offsetTop - saved.referenceOffsetTop);
        return;
      }
    }
    container.scrollTop = saved.scrollTop;
  }, [
    activeHistoryMessages,
    activeMessageSortDirection,
    messageListRef,
    pendingAutoScrollRef,
    prevMessageIdsRef,
    refreshContextRef,
    scrollPreservationRef,
  ]);
}
