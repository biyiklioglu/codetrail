import {
  type IpcResponse,
  type LiveSessionState,
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
  return (
    previousSnapshot.enabled === nextSnapshot.enabled &&
    providerCountsEqual(previousSnapshot.providerCounts, nextSnapshot.providerCounts) &&
    previousSnapshot.sessions.length === nextSnapshot.sessions.length &&
    previousSnapshot.sessions.every((session, index) => {
      const nextSession = nextSnapshot.sessions[index];
      return (
        nextSession !== undefined &&
        session.provider === nextSession.provider &&
        session.sessionIdentity === nextSession.sessionIdentity &&
        session.sourceSessionId === nextSession.sourceSessionId &&
        session.filePath === nextSession.filePath &&
        session.projectName === nextSession.projectName &&
        session.projectPath === nextSession.projectPath &&
        session.cwd === nextSession.cwd &&
        session.statusKind === nextSession.statusKind &&
        session.statusText === nextSession.statusText &&
        session.detailText === nextSession.detailText &&
        session.sourcePrecision === nextSession.sourcePrecision &&
        session.lastActivityAt === nextSession.lastActivityAt &&
        session.bestEffort === nextSession.bestEffort
      );
    }) &&
    claudeHookStateEqual(previousSnapshot.claudeHookState, nextSnapshot.claudeHookState)
  );
}

function providerCountsEqual(
  left: IpcResponse<"watcher:getLiveStatus">["providerCounts"],
  right: IpcResponse<"watcher:getLiveStatus">["providerCounts"],
): boolean {
  return (
    left.claude === right.claude &&
    left.codex === right.codex &&
    left.gemini === right.gemini &&
    left.cursor === right.cursor &&
    left.copilot === right.copilot
  );
}

function claudeHookStateEqual(
  left: IpcResponse<"watcher:getLiveStatus">["claudeHookState"],
  right: IpcResponse<"watcher:getLiveStatus">["claudeHookState"],
): boolean {
  return (
    left.settingsPath === right.settingsPath &&
    left.logPath === right.logPath &&
    left.installed === right.installed &&
    left.managed === right.managed &&
    left.lastError === right.lastError &&
    arraysEqual(left.managedEventNames, right.managedEventNames) &&
    arraysEqual(left.missingEventNames, right.missingEventNames)
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getNextSnapshotInvalidationAtMs(
  session: ReturnType<typeof finalizeLiveSessionState>,
  nowMs: number,
  idleTimeoutMs: number,
  pruneAfterMs: number,
): number {
  let nextInvalidationAtMs = session.lastActivityAtMs + pruneAfterMs;
  const canAutoIdle =
    session.sourcePrecision !== "hook" &&
    session.statusKind !== "waiting_for_approval" &&
    session.statusKind !== "waiting_for_input" &&
    session.statusKind !== "running_tool" &&
    session.statusKind !== "idle";
  if (canAutoIdle) {
    nextInvalidationAtMs = Math.min(nextInvalidationAtMs, session.lastActivityAtMs + idleTimeoutMs);
  }
  return nextInvalidationAtMs > nowMs ? nextInvalidationAtMs : Number.POSITIVE_INFINITY;
}
