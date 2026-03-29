import { describe, expect, it } from "vitest";

import {
  applyCodexLiveLine,
  createInitialLiveSessionState,
  createProviderRecord,
} from "@codetrail/core";

import { buildLiveStatusSnapshot } from "./liveSnapshot";

function createCursorMap(state: ReturnType<typeof createInitialLiveSessionState>) {
  return new Map([[state.filePath, { session: state }]]);
}

describe("liveSnapshot", () => {
  it("keeps the same revision when only updatedAt changes", () => {
    const state = applyCodexLiveLine(
      createInitialLiveSessionState({
        provider: "codex",
        filePath: "/tmp/codex.jsonl",
        sessionIdentity: "session-1",
        sourceSessionId: "session-1",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
      }),
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Applying patch" },
      }),
      Date.parse("2026-03-24T09:00:00.000Z"),
    );

    const first = buildLiveStatusSnapshot({
      enabled: true,
      instrumentationEnabled: false,
      nowMs: Date.parse("2026-03-24T09:00:10.000Z"),
      sessionCursors: createCursorMap(state),
      claudeHookState: {
        settingsPath: "",
        logPath: "",
        installed: false,
        managed: false,
        managedEventNames: [],
        missingEventNames: [],
        lastError: null,
      },
      idleTimeoutMs: 120_000,
      pruneAfterMs: 180_000,
      previousSnapshot: null,
      previousRevision: 0,
    });

    const second = buildLiveStatusSnapshot({
      enabled: true,
      instrumentationEnabled: true,
      nowMs: Date.parse("2026-03-24T09:00:20.000Z"),
      sessionCursors: createCursorMap(state),
      claudeHookState: {
        settingsPath: "",
        logPath: "",
        installed: false,
        managed: false,
        managedEventNames: [],
        missingEventNames: [],
        lastError: null,
      },
      idleTimeoutMs: 120_000,
      pruneAfterMs: 180_000,
      previousSnapshot: first.snapshot,
      previousRevision: first.revision,
    });

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(1);
  });

  it("uses prune-only invalidation for approval states that must not auto-idle", () => {
    const state = applyCodexLiveLine(
      createInitialLiveSessionState({
        provider: "codex",
        filePath: "/tmp/codex.jsonl",
        sessionIdentity: "session-1",
        sourceSessionId: "session-1",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
      }),
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "shell_approval_request", command: "git commit -m test" },
      }),
      Date.parse("2026-03-24T09:00:00.000Z"),
    );

    const snapshot = buildLiveStatusSnapshot({
      enabled: true,
      instrumentationEnabled: false,
      nowMs: Date.parse("2026-03-24T09:00:10.000Z"),
      sessionCursors: createCursorMap(state),
      claudeHookState: {
        settingsPath: "",
        logPath: "",
        installed: false,
        managed: false,
        managedEventNames: [],
        missingEventNames: [],
        lastError: null,
      },
      idleTimeoutMs: 120_000,
      pruneAfterMs: 180_000,
      previousSnapshot: {
        enabled: true,
        instrumentationEnabled: false,
        revision: 0,
        updatedAt: new Date(0).toISOString(),
        providerCounts: createProviderRecord(() => 0),
        sessions: [],
        claudeHookState: {
          settingsPath: "",
          logPath: "",
          installed: false,
          managed: false,
          managedEventNames: [],
          missingEventNames: [],
          lastError: null,
        },
      },
      previousRevision: 0,
    });

    expect(snapshot.expiresAtMs).toBe(Date.parse("2026-03-24T09:03:00.000Z"));
  });
});
