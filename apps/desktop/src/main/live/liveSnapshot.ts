import {
  IDLE_LAST_ACTION_RETENTION_MS,
  type IpcResponse,
  type LiveSessionState,
  RECENT_TOOL_GRACE_MS,
  canLiveSessionAutoIdle,
  createProviderRecord,
  finalizeLiveSessionState,
} from "@codetrail/core";

export type LiveSessionCursor = {
  session: LiveSessionState;
};

export function pruneStaleSessionCursors(
  sessionCursors: Map<string, LiveSessionCursor>,
  nowMs: number,
  pruneAfterMs: number,
): boolean {
  let removed = false;
  for (const [filePath, cursor] of sessionCursors.entries()) {
    const lastActivityAtMs = cursor.session.lastActivityAtMs;
    if (lastActivityAtMs <= 0 || nowMs - lastActivityAtMs > pruneAfterMs) {
      sessionCursors.delete(filePath);
      removed = true;
    }
  }
  return removed;
}

export function buildLiveStatusSnapshot(input: {
  enabled: boolean;
  instrumentationEnabled: boolean;
  nowMs: number;
  sessionCursors: Map<string, LiveSessionCursor>;
  claudeHookState: IpcResponse<"watcher:getLiveStatus">["claudeHookState"];
  idleTimeoutMs: number;
  pruneAfterMs: number;
  previousSnapshot: IpcResponse<"watcher:getLiveStatus"> | null;
  previousRevision: number;
}): {
  snapshot: IpcResponse<"watcher:getLiveStatus">;
  revision: number;
  expiresAtMs: number;
} {
  const providerCounts = createProviderRecord(() => 0);
  let nextInvalidationAtMs = Number.POSITIVE_INFINITY;
  const sessions = [...input.sessionCursors.values()].flatMap((cursor) => {
    const session = finalizeLiveSessionState(cursor.session, {
      nowMs: input.nowMs,
      idleTimeoutMs: input.idleTimeoutMs,
    });
    if (session.lastActivityAtMs <= 0) {
      return [];
    }
    providerCounts[session.provider] += 1;
    nextInvalidationAtMs = Math.min(
      nextInvalidationAtMs,
      getNextSnapshotInvalidationAtMs(
        session,
        input.nowMs,
        input.idleTimeoutMs,
        input.pruneAfterMs,
      ),
    );
    return [
      {
        provider: session.provider,
        sessionIdentity: session.sessionIdentity,
        sourceSessionId: session.sourceSessionId,
        filePath: session.filePath,
        projectName: session.projectName,
        projectPath: session.projectPath,
        cwd: session.cwd,
        statusKind: session.statusKind,
        statusText: session.statusText,
        detailText: session.detailText,
        sourcePrecision: session.sourcePrecision,
        lastActivityAt: new Date(session.lastActivityAtMs).toISOString(),
        bestEffort: session.bestEffort,
      },
    ];
  });

  const baseSnapshot = {
    enabled: input.enabled,
    instrumentationEnabled: input.instrumentationEnabled,
    revision: input.previousRevision,
    updatedAt: new Date(input.nowMs).toISOString(),
    providerCounts,
    sessions,
    claudeHookState: input.claudeHookState,
  } satisfies IpcResponse<"watcher:getLiveStatus">;

  const revision = areSnapshotsEquivalent(input.previousSnapshot, baseSnapshot)
    ? input.previousRevision
    : input.previousRevision + 1;

  return {
    snapshot: {
      ...baseSnapshot,
      revision,
    },
    revision,
    expiresAtMs: Number.isFinite(nextInvalidationAtMs)
      ? nextInvalidationAtMs
      : Number.POSITIVE_INFINITY,
  };
}

function areSnapshotsEquivalent(
  previousSnapshot: IpcResponse<"watcher:getLiveStatus"> | null,
  nextSnapshot: IpcResponse<"watcher:getLiveStatus">,
): boolean {
  if (!previousSnapshot) {
    return false;
  }
  if (previousSnapshot.enabled !== nextSnapshot.enabled) {
    return false;
  }
  if (!providerCountsEqual(previousSnapshot.providerCounts, nextSnapshot.providerCounts)) {
    return false;
  }
  if (!sessionsEqual(previousSnapshot.sessions, nextSnapshot.sessions)) {
    return false;
  }
  return claudeHookStatesEqual(previousSnapshot.claudeHookState, nextSnapshot.claudeHookState);
}

function getNextSnapshotInvalidationAtMs(
  session: ReturnType<typeof finalizeLiveSessionState>,
  nowMs: number,
  idleTimeoutMs: number,
  pruneAfterMs: number,
): number {
  let nextInvalidationAtMs = session.lastActivityAtMs + pruneAfterMs;
  if (canLiveSessionAutoIdle(session) && session.statusKind !== "idle") {
    nextInvalidationAtMs = Math.min(nextInvalidationAtMs, session.lastActivityAtMs + idleTimeoutMs);
  }
  if (session.lastActionAtMs > 0) {
    if (session.baseStatusKind === "idle") {
      nextInvalidationAtMs = Math.min(
        nextInvalidationAtMs,
        session.lastActionAtMs + IDLE_LAST_ACTION_RETENTION_MS,
      );
    } else {
      nextInvalidationAtMs = Math.min(
        nextInvalidationAtMs,
        session.lastActionAtMs + RECENT_TOOL_GRACE_MS,
      );
    }
  }
  return nextInvalidationAtMs > nowMs ? nextInvalidationAtMs : Number.POSITIVE_INFINITY;
}

function providerCountsEqual(
  left: IpcResponse<"watcher:getLiveStatus">["providerCounts"],
  right: IpcResponse<"watcher:getLiveStatus">["providerCounts"],
): boolean {
  return (
    left.claude === right.claude &&
    left.codex === right.codex &&
    left.copilot === right.copilot &&
    left.cursor === right.cursor &&
    left.gemini === right.gemini &&
    left.opencode === right.opencode
  );
}

function sessionsEqual(
  left: IpcResponse<"watcher:getLiveStatus">["sessions"],
  right: IpcResponse<"watcher:getLiveStatus">["sessions"],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftSession = left[index];
    const rightSession = right[index];
    if (!leftSession || !rightSession) {
      return false;
    }
    if (
      leftSession.provider !== rightSession.provider ||
      leftSession.sessionIdentity !== rightSession.sessionIdentity ||
      leftSession.sourceSessionId !== rightSession.sourceSessionId ||
      leftSession.filePath !== rightSession.filePath ||
      leftSession.projectName !== rightSession.projectName ||
      leftSession.projectPath !== rightSession.projectPath ||
      leftSession.cwd !== rightSession.cwd ||
      leftSession.statusKind !== rightSession.statusKind ||
      leftSession.statusText !== rightSession.statusText ||
      leftSession.detailText !== rightSession.detailText ||
      leftSession.sourcePrecision !== rightSession.sourcePrecision ||
      leftSession.lastActivityAt !== rightSession.lastActivityAt ||
      leftSession.bestEffort !== rightSession.bestEffort
    ) {
      return false;
    }
  }
  return true;
}

function claudeHookStatesEqual(
  left: IpcResponse<"watcher:getLiveStatus">["claudeHookState"],
  right: IpcResponse<"watcher:getLiveStatus">["claudeHookState"],
): boolean {
  if (
    left.settingsPath !== right.settingsPath ||
    left.logPath !== right.logPath ||
    left.installed !== right.installed ||
    left.managed !== right.managed ||
    left.lastError !== right.lastError
  ) {
    return false;
  }
  if (left.managedEventNames.length !== right.managedEventNames.length) {
    return false;
  }
  for (let index = 0; index < left.managedEventNames.length; index += 1) {
    if (left.managedEventNames[index] !== right.managedEventNames[index]) {
      return false;
    }
  }
  if (left.missingEventNames.length !== right.missingEventNames.length) {
    return false;
  }
  for (let index = 0; index < left.missingEventNames.length; index += 1) {
    if (left.missingEventNames[index] !== right.missingEventNames[index]) {
      return false;
    }
  }
  return true;
}
