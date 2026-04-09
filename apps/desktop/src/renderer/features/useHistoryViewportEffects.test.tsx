// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { HistoryMessage, PendingMessagePageNavigation } from "../app/types";
import { useHistoryViewportEffects } from "./useHistoryViewportEffects";

function ViewportHarness({
  historyDetailMode,
  historyMode,
  selectedProjectId = "",
  selectedSessionId = "session_1",
  turnAnchorMessageId = "",
  sessionPage,
}: {
  historyDetailMode: "flat" | "turn";
  historyMode: "session" | "bookmarks" | "project_all";
  selectedProjectId?: string;
  selectedSessionId?: string;
  turnAnchorMessageId?: string;
  sessionPage: number;
}) {
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const focusedMessageRef = useRef<HTMLDivElement | null>(null);
  const sessionScrollTopRef = useRef(0);
  const pendingRestoredSessionScrollRef = useRef<{
    sessionId: string;
    sessionPage: number;
    scrollTop: number;
  } | null>(null);
  const refreshContextRef = useRef(null);
  const pendingAutoScrollRef = useRef(false);
  const prevMessageIdsRef = useRef("");
  const [pendingMessageAreaFocus, setPendingMessageAreaFocus] = useState(false);
  const [pendingMessagePageNavigation, setPendingMessagePageNavigation] =
    useState<PendingMessagePageNavigation | null>(null);
  const [, setSessionScrollTop] = useState(0);
  const [, setFocusMessageId] = useState("");

  useHistoryViewportEffects({
    messageListRef,
    historyDetailMode,
    historyMode,
    selectedProjectId,
    selectedSessionId,
    turnAnchorMessageId,
    sessionPage,
    setSessionScrollTop,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
    refreshContextRef,
    pendingAutoScrollRef,
    prevMessageIdsRef,
    activeHistoryMessages: [{ id: "message_1" }] as HistoryMessage[],
    activeMessageSortDirection: "desc",
    focusMessageId: "",
    visibleFocusedMessageId: "",
    focusedMessagePosition: -1,
    focusedMessageRef,
    pendingMessageAreaFocus,
    setPendingMessageAreaFocus,
    pendingMessagePageNavigation,
    loadedHistoryPage: sessionPage,
    setPendingMessagePageNavigation,
    setFocusMessageId,
    scrollPreservationRef: useRef(null),
  });

  return <div ref={messageListRef} data-testid="message-list" />;
}

describe("useHistoryViewportEffects", () => {
  it("resets scroll when a flat history page changes", async () => {
    const { rerender } = render(
      <ViewportHarness historyDetailMode="flat" historyMode="session" sessionPage={0} />,
    );
    const container = screen.getByTestId("message-list");

    await waitFor(() => {
      expect(container.scrollTop).toBe(0);
    });

    act(() => {
      container.scrollTop = 180;
    });

    rerender(<ViewportHarness historyDetailMode="flat" historyMode="session" sessionPage={1} />);

    await waitFor(() => {
      expect(container.scrollTop).toBe(0);
    });
  });

  it("preserves scroll when turn display page changes but the viewed turn anchor stays the same", async () => {
    const { rerender } = render(
      <ViewportHarness
        historyDetailMode="turn"
        historyMode="session"
        turnAnchorMessageId="turn_anchor_1"
        sessionPage={0}
      />,
    );
    const container = screen.getByTestId("message-list");

    await waitFor(() => {
      expect(container.scrollTop).toBe(0);
    });

    act(() => {
      container.scrollTop = 180;
    });

    rerender(
      <ViewportHarness
        historyDetailMode="turn"
        historyMode="session"
        turnAnchorMessageId="turn_anchor_1"
        sessionPage={1}
      />,
    );

    await waitFor(() => {
      expect(container.scrollTop).toBe(180);
    });
  });

  it("resets scroll when the viewed turn anchor changes", async () => {
    const { rerender } = render(
      <ViewportHarness
        historyDetailMode="turn"
        historyMode="session"
        turnAnchorMessageId="turn_anchor_1"
        sessionPage={0}
      />,
    );
    const container = screen.getByTestId("message-list");

    await waitFor(() => {
      expect(container.scrollTop).toBe(0);
    });

    act(() => {
      container.scrollTop = 180;
    });

    rerender(
      <ViewportHarness
        historyDetailMode="turn"
        historyMode="session"
        turnAnchorMessageId="turn_anchor_2"
        sessionPage={0}
      />,
    );

    await waitFor(() => {
      expect(container.scrollTop).toBe(0);
    });
  });
});
