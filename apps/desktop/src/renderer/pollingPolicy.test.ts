import { describe, expect, it } from "vitest";

import { resolveIndexingStatusPollMs, resolveWatcherStatusPollMs } from "./App";
import { resolveLiveStatusPollMs } from "./features/useLiveWatchController";

describe("polling policy", () => {
  it("uses burst polling briefly after watcher startup and then backs off", () => {
    expect(
      resolveWatcherStatusPollMs({
        watchStrategyActive: true,
        documentVisible: true,
        nowMs: 1000,
        burstUntilMs: 6000,
        pendingPathCount: 0,
      }),
    ).toBe(250);

    expect(
      resolveWatcherStatusPollMs({
        watchStrategyActive: true,
        documentVisible: true,
        nowMs: 7000,
        burstUntilMs: 6000,
        pendingPathCount: 4,
      }),
    ).toBe(1000);

    expect(
      resolveWatcherStatusPollMs({
        watchStrategyActive: true,
        documentVisible: true,
        nowMs: 7000,
        burstUntilMs: 6000,
        pendingPathCount: 0,
      }),
    ).toBe(3000);
  });

  it("slows watcher and indexing polling when the document is hidden", () => {
    expect(
      resolveWatcherStatusPollMs({
        watchStrategyActive: true,
        documentVisible: false,
        nowMs: 7000,
        burstUntilMs: 6000,
        pendingPathCount: 4,
      }),
    ).toBe(5000);

    expect(
      resolveIndexingStatusPollMs({
        documentVisible: false,
        indexingRunning: true,
      }),
    ).toBe(5000);
  });

  it("backs off live status polling outside settings", () => {
    expect(
      resolveLiveStatusPollMs({
        documentVisible: true,
        mainView: "settings",
      }),
    ).toBe(3000);

    expect(
      resolveLiveStatusPollMs({
        documentVisible: true,
        mainView: "history",
      }),
    ).toBe(10000);

    expect(
      resolveLiveStatusPollMs({
        documentVisible: false,
        mainView: "history",
      }),
    ).toBe(15000);
  });
});
