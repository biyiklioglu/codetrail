import { describe, expect, it } from "vitest";

import { scheduleHistoryAutoFollowScroll } from "./historyAutoFollowScroll";

describe("scheduleHistoryAutoFollowScroll", () => {
  it("keeps snapping to the bottom while the container grows after follow", () => {
    const frameQueue: FrameRequestCallback[] = [];
    const timeoutQueue = new Map<number, () => void>();
    let nextTimerId = 1;
    const container = {
      scrollTop: 0,
      scrollHeight: 200,
    };

    const cleanup = scheduleHistoryAutoFollowScroll({
      container,
      sortDirection: "asc",
      scheduleAnimationFrame: (callback) => {
        frameQueue.push(callback);
        return frameQueue.length;
      },
      cancelAnimationFrame: () => undefined,
      setTimeoutFn: ((callback: () => void) => {
        const id = nextTimerId++;
        timeoutQueue.set(id, callback);
        return id;
      }) as typeof window.setTimeout,
      clearTimeoutFn: ((id: number) => {
        timeoutQueue.delete(id);
      }) as typeof window.clearTimeout,
      createResizeObserver: null,
    });

    expect(container.scrollTop).toBe(200);

    container.scrollHeight = 420;
    const firstFrame = frameQueue.shift();
    expect(firstFrame).toBeDefined();
    firstFrame?.(0);
    expect(container.scrollTop).toBe(420);

    container.scrollHeight = 640;
    const secondFrame = frameQueue.shift();
    expect(secondFrame).toBeDefined();
    secondFrame?.(0);
    expect(container.scrollTop).toBe(640);

    container.scrollHeight = 880;
    const timeoutCallback = timeoutQueue.values().next().value as (() => void) | undefined;
    expect(timeoutCallback).toBeDefined();
    timeoutCallback?.();
    expect(container.scrollTop).toBe(880);

    cleanup();
  });

  it("snaps DESC follow to the top immediately", () => {
    const container = {
      scrollTop: 300,
      scrollHeight: 1200,
    };

    const cleanup = scheduleHistoryAutoFollowScroll({
      container,
      sortDirection: "desc",
      scheduleAnimationFrame: () => 0,
      cancelAnimationFrame: () => undefined,
      setTimeoutFn: (() => 0) as unknown as typeof window.setTimeout,
      clearTimeoutFn: (() => undefined) as typeof window.clearTimeout,
      createResizeObserver: null,
    });

    expect(container.scrollTop).toBe(0);
    cleanup();
  });
});
