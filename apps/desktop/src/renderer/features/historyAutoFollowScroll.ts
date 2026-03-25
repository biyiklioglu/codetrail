import type { SortDirection } from "../app/types";

type ScrollContainer = {
  scrollTop: number;
  scrollHeight: number;
};

type ResizeObserverLike = {
  observe: (target: Element) => void;
  disconnect: () => void;
};

export function scheduleHistoryAutoFollowScroll(args: {
  container: ScrollContainer & Partial<Element>;
  sortDirection: SortDirection;
  scheduleAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
  setTimeoutFn?: typeof window.setTimeout;
  clearTimeoutFn?: typeof window.clearTimeout;
  createResizeObserver?: ((callback: ResizeObserverCallback) => ResizeObserverLike) | null;
}): () => void {
  const {
    container,
    sortDirection,
    scheduleAnimationFrame = window.requestAnimationFrame.bind(window),
    cancelAnimationFrame = window.cancelAnimationFrame.bind(window),
    setTimeoutFn = window.setTimeout.bind(window),
    clearTimeoutFn = window.clearTimeout.bind(window),
    createResizeObserver = typeof ResizeObserver === "function"
      ? (callback) => new ResizeObserver(callback)
      : null,
  } = args;

  if (sortDirection === "desc") {
    container.scrollTop = 0;
    return () => undefined;
  }

  const scrollToBottom = () => {
    container.scrollTop = container.scrollHeight;
  };

  scrollToBottom();

  const rafIds: number[] = [];
  rafIds.push(
    scheduleAnimationFrame(() => {
      scrollToBottom();
      rafIds.push(
        scheduleAnimationFrame(() => {
          scrollToBottom();
        }),
      );
    }),
  );

  const settleTimeoutId = setTimeoutFn(() => {
    scrollToBottom();
  }, 48);

  let observer: ResizeObserverLike | null = null;
  let observerDisconnectTimeoutId: number | null = null;
  if (createResizeObserver && container instanceof Element) {
    observer = createResizeObserver(() => {
      scrollToBottom();
    });
    observer.observe(container);
    observerDisconnectTimeoutId = setTimeoutFn(() => {
      observer?.disconnect();
      observer = null;
    }, 160);
  }

  return () => {
    for (const rafId of rafIds) {
      cancelAnimationFrame(rafId);
    }
    clearTimeoutFn(settleTimeoutId);
    if (observerDisconnectTimeoutId !== null) {
      clearTimeoutFn(observerDisconnectTimeoutId);
    }
    observer?.disconnect();
  };
}
