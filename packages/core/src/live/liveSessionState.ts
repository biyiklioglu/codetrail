import type { Provider } from "../contracts/canonical";
import {
  asArray,
  asRecord,
  extractText,
  firstNonEmptyString,
  readString,
  toIsoTimestamp,
} from "../parsing/helpers";
import {
  type ClaudeHookEventName,
  IDLE_LAST_ACTION_RETENTION_MS,
  type LiveSessionStatusKind,
  type LiveSourcePrecision,
  RECENT_TOOL_GRACE_MS,
} from "./types";

type LiveOperationKind = "command" | "tool";
type LiveDetailSource = "semantic" | "activity" | "last_action" | "terminal" | "fallback" | "none";

type LiveOperation = {
  id: string;
  kind: LiveOperationKind;
  detailText: string | null;
  statusText: string;
  sourcePrecision: LiveSourcePrecision;
  startedAtMs: number;
};

/**
 * Live-row policy:
 * - Keep semantic meaning (prompt/waiting/terminal detail) separate from transient activity detail.
 * - Track multiple active operations so "running tool" stays visible until the final matching
 *   tool/command completes.
 * - Prefer precise hook state over stale passive transcript state when timestamps disagree.
 * - Avoid blank "Working" rows by falling back to the last meaningful action detail when the
 *   current state has no stronger detail of its own.
 */
export type LiveSessionState = {
  provider: Provider;
  filePath: string;
  sessionIdentity: string;
  sourceSessionId: string;
  projectName: string | null;
  projectPath: string | null;
  cwd: string | null;
  lastActivityAtMs: number;
  latestPassiveAtMs: number;
  latestPreciseAtMs: number;
  sourcePrecision: LiveSourcePrecision;
  statusKind: LiveSessionStatusKind;
  statusText: string;
  detailText: string | null;
  visibleDetailSource: LiveDetailSource;
  baseStatusKind: LiveSessionStatusKind;
  baseStatusText: string;
  baseSourcePrecision: LiveSourcePrecision;
  semanticDetail: string | null;
  activityDetail: string | null;
  terminalDetail: string | null;
  terminalDetailAtMs: number;
  lastActionDetail: string | null;
  lastActionKind: LiveOperationKind | null;
  lastActionAtMs: number;
  activeOperations: LiveOperation[];
  syntheticOperationSequence: number;
  bestEffort: boolean;
};

export type LiveStatusInput = {
  nowMs: number;
  idleTimeoutMs: number;
};

export function canLiveSessionAutoIdle(
  state: Pick<LiveSessionState, "activeOperations" | "baseStatusKind" | "baseSourcePrecision">,
): boolean {
  return (
    state.activeOperations.length === 0 &&
    state.baseStatusKind !== "waiting_for_approval" &&
    state.baseStatusKind !== "waiting_for_input" &&
    state.baseSourcePrecision !== "hook"
  );
}

export function createInitialLiveSessionState(input: {
  provider: Provider;
  filePath: string;
  sessionIdentity: string;
  sourceSessionId: string;
  projectName?: string | null;
  projectPath?: string | null;
  cwd?: string | null;
}): LiveSessionState {
  return {
    provider: input.provider,
    filePath: input.filePath,
    sessionIdentity: input.sessionIdentity,
    sourceSessionId: input.sourceSessionId,
    projectName: input.projectName ?? null,
    projectPath: input.projectPath ?? null,
    cwd: input.cwd ?? null,
    lastActivityAtMs: 0,
    latestPassiveAtMs: 0,
    latestPreciseAtMs: 0,
    sourcePrecision: "passive",
    statusKind: "unknown",
    statusText: "Waiting for activity",
    detailText: null,
    visibleDetailSource: "none",
    baseStatusKind: "unknown",
    baseStatusText: "Waiting for activity",
    baseSourcePrecision: "passive",
    semanticDetail: null,
    activityDetail: null,
    terminalDetail: null,
    terminalDetailAtMs: 0,
    lastActionDetail: null,
    lastActionKind: null,
    lastActionAtMs: 0,
    activeOperations: [],
    syntheticOperationSequence: 0,
    bestEffort: false,
  };
}

export function applyCodexLiveLine(
  state: LiveSessionState,
  line: string,
  nowMs: number,
): LiveSessionState {
  const parsed = safeParseJson(line);
  const record = asRecord(parsed);
  if (!record) {
    return state;
  }

  const explicitTimestampMs = readTimestampMs(record.timestamp);
  const timestampMs = explicitTimestampMs ?? nowMs;
  if (!shouldApplyPassiveRecord(state, explicitTimestampMs, timestampMs)) {
    return state;
  }
  const recordType = readString(record.type);
  if (!recordType) {
    return state;
  }

  if (recordType === "session_meta" || recordType === "turn_context") {
    const payload = asRecord(record.payload);
    const next = cloneState(state);
    if (explicitTimestampMs !== null) {
      touchState(next, timestampMs, "passive");
    }
    next.cwd = readString(payload?.cwd) ?? next.cwd;
    return syncVisibleState(next, timestampMs);
  }

  if (recordType === "event_msg") {
    return applyCodexEventMessage(state, asRecord(record.payload), timestampMs);
  }

  if (recordType === "response_item") {
    return applyCodexResponseItem(state, asRecord(record.payload), timestampMs);
  }

  if (recordType === "compacted") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "working",
      statusText: "Compacting context",
      detailText: "Codex compacted the running session",
      detailBucket: "semantic",
    });
  }

  return state;
}

export function applyClaudeTranscriptLine(
  state: LiveSessionState,
  line: string,
  nowMs: number,
): LiveSessionState {
  const parsed = safeParseJson(line);
  const record = asRecord(parsed);
  if (!record) {
    return state;
  }

  const explicitTimestampMs = readTimestampMs(record.timestamp);
  const timestampMs = explicitTimestampMs ?? nowMs;
  if (!shouldApplyPassiveRecord(state, explicitTimestampMs, timestampMs)) {
    return state;
  }

  const recordType = readString(record.type);
  const message = asRecord(record.message);
  const content = asArray(message?.content);
  const contentRecords = content.map((entry) => asRecord(entry)).filter(Boolean) as Array<
    Record<string, unknown>
  >;
  const toolUses = contentRecords.filter((entry) => readString(entry.type) === "tool_use");
  const toolResults = contentRecords.filter((entry) => readString(entry.type) === "tool_result");
  const hasThinking = contentRecords.some((entry) => readString(entry.type) === "thinking");
  const detailText = firstText(extractText(content));

  const next = cloneState(state);
  touchState(next, timestampMs, "passive");
  next.cwd = readString(record.cwd) ?? next.cwd;

  if (recordType === "assistant") {
    if (hasThinking) {
      setBaseStatusInPlace(next, {
        timestampMs,
        precision: "passive",
        statusKind: "thinking",
        statusText: "Thinking",
        detailText,
        detailBucket: "activity",
      });
    } else if (detailText) {
      setBaseStatusInPlace(next, {
        timestampMs,
        precision: "passive",
        statusKind: "working",
        statusText: "Responding",
        detailText,
        detailBucket: "activity",
      });
    } else {
      setBaseStatusInPlace(next, {
        timestampMs,
        precision: "passive",
        statusKind: "working",
        statusText: "Working",
        detailText: null,
        detailBucket: "none",
      });
    }

    for (const [index, toolUse] of toolUses.entries()) {
      startOperationInPlace(next, {
        timestampMs,
        precision: "passive",
        id: readString(toolUse.id),
        kind: humanizeToolKind(readString(toolUse.name)),
        detailText: humanizeToolName(readString(toolUse.name)),
        syntheticHint: `claude-tool-use-${index}`,
      });
    }
    return syncVisibleState(next, timestampMs);
  }

  if (recordType === "user") {
    for (const [index, toolResult] of toolResults.entries()) {
      finishOperationInPlace(next, {
        timestampMs,
        precision: "passive",
        id: readString(toolResult.tool_use_id),
        kind: "tool",
        detailText: null,
        syntheticHint: `claude-tool-result-${index}`,
      });
    }
    if (toolResults.length === 0) {
      clearOperationsByPrecisionInPlace(next, "passive", timestampMs);
    }
    setBaseStatusInPlace(next, {
      timestampMs,
      precision: "passive",
      statusKind: toolResults.length > 0 ? "working" : "active_recently",
      statusText: toolResults.length > 0 ? "Processing tool result" : "Prompt updated",
      detailText,
      detailBucket: toolResults.length > 0 ? "activity" : "semantic",
    });
    return syncVisibleState(next, timestampMs);
  }

  if (recordType === "summary") {
    setBaseStatusInPlace(next, {
      timestampMs,
      precision: "passive",
      statusKind: "active_recently",
      statusText: "Session updated",
      detailText: readString(record.summary),
      detailBucket: "semantic",
    });
    return syncVisibleState(next, timestampMs);
  }

  return syncVisibleState(next, timestampMs);
}

export function applyClaudeHookLine(
  state: LiveSessionState,
  line: string,
  nowMs: number,
): LiveSessionState {
  const parsed = safeParseJson(line);
  const record = asRecord(parsed);
  if (!record) {
    return state;
  }

  const hookEventName = readString(record.hook_event_name) as ClaudeHookEventName | null;
  if (!hookEventName) {
    return state;
  }

  const timestampMs = readTimestampMs(record.timestamp) ?? nowMs;
  if (!shouldApplyEvent(state, timestampMs, "hook")) {
    return state;
  }

  const detailText =
    readString(record.message) ??
    readString(record.title) ??
    readString(record.last_assistant_message) ??
    readString(record.tool_name);

  if (hookEventName === "SessionStart") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "hook",
      statusKind: "working",
      statusText: "Starting session",
      detailText: readString(record.source),
      detailBucket: "semantic",
    });
  }

  if (hookEventName === "SessionEnd") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "hook",
      statusKind: "idle",
      statusText: "Session ended",
      detailText,
      detailBucket: "terminal",
    });
  }

  if (hookEventName === "UserPromptSubmit") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "hook",
      statusKind: "working",
      statusText: "Prompt submitted",
      detailText,
      detailBucket: "semantic",
    });
  }

  if (hookEventName === "PreToolUse") {
    return startOperation(state, {
      timestampMs,
      precision: "hook",
      id: readString(record.tool_use_id),
      kind: "tool",
      detailText: humanizeToolName(readString(record.tool_name)),
      syntheticHint: "claude-hook-tool",
    });
  }

  if (hookEventName === "PostToolUse") {
    const afterFinish = cloneState(state);
    finishOperationInPlace(afterFinish, {
      timestampMs,
      precision: "hook",
      id: readString(record.tool_use_id),
      kind: "tool",
      detailText: humanizeToolName(readString(record.tool_name)),
      syntheticHint: "claude-hook-tool",
    });
    setBaseStatusInPlace(afterFinish, {
      timestampMs,
      precision: "hook",
      statusKind: "working",
      statusText: "Tool finished",
      detailText,
      detailBucket: detailText ? "activity" : "none",
    });
    return syncVisibleState(afterFinish, timestampMs);
  }

  if (hookEventName === "Notification") {
    const notificationType = readString(record.notification_type);
    if (notificationType === "permission_prompt") {
      return setBaseStatus(state, {
        timestampMs,
        precision: "hook",
        statusKind: "waiting_for_approval",
        statusText: "Waiting for approval",
        detailText,
        detailBucket: "semantic",
      });
    }
    if (notificationType === "idle_prompt") {
      return setBaseStatus(state, {
        timestampMs,
        precision: "hook",
        statusKind: "idle",
        statusText: "Idle",
        detailText,
        detailBucket: "terminal",
      });
    }
    return setBaseStatus(state, {
      timestampMs,
      precision: "hook",
      statusKind: "active_recently",
      statusText: "Notification received",
      detailText,
      detailBucket: "semantic",
    });
  }

  if (hookEventName === "Stop") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "hook",
      statusKind: "idle",
      statusText: "Idle",
      detailText,
      detailBucket: "terminal",
    });
  }

  return state;
}

export function finalizeLiveSessionState(
  state: LiveSessionState,
  input: LiveStatusInput,
): LiveSessionState {
  const next = cloneState(state);
  if (next.lastActivityAtMs <= 0) {
    return next;
  }

  const staleForMs = input.nowMs - next.lastActivityAtMs;
  if (staleForMs >= input.idleTimeoutMs && canLiveSessionAutoIdle(next)) {
    next.baseStatusKind = "idle";
    next.baseStatusText = "Idle";
    next.baseSourcePrecision = "passive";
    next.activityDetail = null;
    next.semanticDetail = null;
  }

  const finalized = syncVisibleState(next, input.nowMs);
  if (!finalized.detailText && staleForMs > input.idleTimeoutMs * 2) {
    finalized.detailText = "No recent session activity";
    finalized.visibleDetailSource = "fallback";
  }
  return finalized;
}

export function readClaudeHookTranscriptPath(line: string): string | null {
  const parsed = safeParseJson(line);
  const record = asRecord(parsed);
  return readString(record?.transcript_path) ?? readString(record?.agent_transcript_path);
}

function applyCodexEventMessage(
  state: LiveSessionState,
  payload: Record<string, unknown> | null,
  timestampMs: number,
): LiveSessionState {
  const eventPayload = payload ?? {};
  const eventType = readString(eventPayload.type);
  if (!eventType || !shouldApplyEvent(state, timestampMs, "passive")) {
    return state;
  }

  if (eventType === "task_started") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "working",
      statusText: "Starting task",
      detailText: firstNonEmptyString(
        firstText(extractText(eventPayload)),
        readString(eventPayload.title),
      ),
      detailBucket: "semantic",
    });
  }

  if (eventType === "task_complete") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "idle",
      statusText: "Idle",
      detailText: firstNonEmptyString(
        readString(eventPayload.last_agent_message),
        firstText(extractText(eventPayload)),
      ),
      detailBucket: "terminal",
    });
  }

  if (eventType === "turn_aborted") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "idle",
      statusText: "Turn aborted",
      detailText: firstText(extractText(eventPayload)),
      detailBucket: "terminal",
    });
  }

  if (eventType.includes("approval_request")) {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "waiting_for_approval",
      statusText: "Waiting for approval",
      detailText: readString(eventPayload.command) ?? readString(eventPayload.reason),
      detailBucket: "semantic",
    });
  }

  if (
    eventType === "request_user_input" ||
    eventType === "elicitation_request" ||
    eventType === "user-input-requested"
  ) {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "waiting_for_input",
      statusText: "Waiting for input",
      detailText: readString(eventPayload.prompt) ?? readString(eventPayload.title),
      detailBucket: "semantic",
    });
  }

  if (eventType.includes("reasoning")) {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "thinking",
      statusText: "Thinking",
      detailText: firstText(extractText(eventPayload)),
      detailBucket: "activity",
    });
  }

  if (eventType === "exec_command_begin") {
    return startOperation(state, {
      timestampMs,
      precision: "passive",
      id: readString(eventPayload.call_id),
      kind: "command",
      detailText: readString(eventPayload.command) ?? readString(eventPayload.cmd),
      syntheticHint: "codex-event-command",
    });
  }

  if (eventType === "exec_command_end") {
    return finishOperation(state, {
      timestampMs,
      precision: "passive",
      id: readString(eventPayload.call_id),
      kind: "command",
      detailText: readString(eventPayload.command) ?? readString(eventPayload.cmd),
      syntheticHint: "codex-event-command",
    });
  }

  if (eventType === "agent_message") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "working",
      statusText: "Responding",
      detailText: firstText(extractText(eventPayload)),
      detailBucket: "activity",
    });
  }

  return state;
}

function applyCodexResponseItem(
  state: LiveSessionState,
  payload: Record<string, unknown> | null,
  timestampMs: number,
): LiveSessionState {
  const itemPayload = payload ?? {};
  const payloadType = readString(itemPayload.type);
  if (!payloadType || !shouldApplyEvent(state, timestampMs, "passive")) {
    return state;
  }

  if (payloadType === "reasoning") {
    return setBaseStatus(state, {
      timestampMs,
      precision: "passive",
      statusKind: "thinking",
      statusText: "Thinking",
      detailText: firstText(extractText(itemPayload.summary)),
      detailBucket: "activity",
    });
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    const toolName = readString(itemPayload.name);
    const isCommand = toolName === "exec_command";
    return startOperation(state, {
      timestampMs,
      precision: "passive",
      id: readString(itemPayload.call_id),
      kind: isCommand ? "command" : "tool",
      detailText: isCommand
        ? extractCodexCommand(itemPayload.arguments)
        : humanizeToolName(toolName),
      syntheticHint: toolName ?? payloadType,
    });
  }

  if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
    const completionKind = resolveCodexCompletionKind(state, readString(itemPayload.call_id));
    if (!completionKind) {
      return state;
    }
    return finishOperation(state, {
      timestampMs,
      precision: "passive",
      id: readString(itemPayload.call_id),
      kind: completionKind,
      detailText: null,
      syntheticHint: payloadType,
    });
  }

  if (payloadType === "message") {
    const role = readString(itemPayload.role);
    if (role === "assistant") {
      return setBaseStatus(state, {
        timestampMs,
        precision: "passive",
        statusKind: "working",
        statusText: "Responding",
        detailText: firstText(extractText(itemPayload.content)),
        detailBucket: "activity",
      });
    }
    if (role === "user") {
      return setBaseStatus(state, {
        timestampMs,
        precision: "passive",
        statusKind: "active_recently",
        statusText: "Prompt updated",
        detailText: firstText(extractText(itemPayload.content)),
        detailBucket: "semantic",
      });
    }
  }

  return state;
}

function setBaseStatus(
  state: LiveSessionState,
  input: {
    timestampMs: number;
    precision: LiveSourcePrecision;
    statusKind: LiveSessionStatusKind;
    statusText: string;
    detailText: string | null;
    detailBucket: "semantic" | "activity" | "terminal" | "none";
  },
): LiveSessionState {
  const next = cloneState(state);
  setBaseStatusInPlace(next, input);
  return syncVisibleState(next, input.timestampMs);
}

function startOperation(
  state: LiveSessionState,
  input: {
    timestampMs: number;
    precision: LiveSourcePrecision;
    id: string | null;
    kind: LiveOperationKind;
    detailText: string | null;
    syntheticHint: string;
  },
): LiveSessionState {
  const next = cloneState(state);
  startOperationInPlace(next, input);
  return syncVisibleState(next, input.timestampMs);
}

function finishOperation(
  state: LiveSessionState,
  input: {
    timestampMs: number;
    precision: LiveSourcePrecision;
    id: string | null;
    kind: LiveOperationKind;
    detailText: string | null;
    syntheticHint: string;
  },
): LiveSessionState {
  const next = cloneState(state);
  finishOperationInPlace(next, input);
  return syncVisibleState(next, input.timestampMs);
}

function syncVisibleState(state: LiveSessionState, nowMs: number): LiveSessionState {
  if (
    state.baseStatusKind === "waiting_for_approval" ||
    state.baseStatusKind === "waiting_for_input"
  ) {
    state.statusKind = state.baseStatusKind;
    state.statusText = coerceStatusText(state.baseStatusKind, state.baseStatusText);
    state.sourcePrecision = state.baseSourcePrecision;
    const currentDetail = getCurrentDetailCandidate(state);
    state.detailText = currentDetail?.text ?? getLastActionFallback(state, nowMs);
    state.visibleDetailSource =
      currentDetail?.source ?? (state.detailText ? "last_action" : "none");
    return state;
  }
  const visibleOperation = getVisibleOperation(state.activeOperations);
  if (visibleOperation) {
    state.statusKind = "running_tool";
    state.statusText = visibleOperation.statusText;
    state.sourcePrecision = visibleOperation.sourcePrecision;
    state.detailText = visibleOperation.detailText;
    state.visibleDetailSource = visibleOperation.detailText ? "activity" : "none";
    return state;
  }

  state.statusKind = state.baseStatusKind;
  state.statusText = coerceStatusText(state.baseStatusKind, state.baseStatusText);
  state.sourcePrecision = state.baseSourcePrecision;

  const currentDetail = getCurrentDetailCandidate(state);
  state.detailText = currentDetail?.text ?? getLastActionFallback(state, nowMs);
  state.visibleDetailSource = currentDetail?.source ?? (state.detailText ? "last_action" : "none");
  return state;
}

function getCurrentDetailCandidate(
  state: LiveSessionState,
): { text: string; source: LiveDetailSource } | null {
  if (
    state.baseStatusKind === "waiting_for_approval" ||
    state.baseStatusKind === "waiting_for_input"
  ) {
    return state.semanticDetail ? { text: state.semanticDetail, source: "semantic" } : null;
  }
  if (state.baseStatusKind === "idle") {
    if (state.terminalDetail) {
      return { text: state.terminalDetail, source: "terminal" };
    }
    return state.semanticDetail ? { text: state.semanticDetail, source: "semantic" } : null;
  }
  if (state.baseStatusKind === "thinking") {
    if (state.activityDetail) {
      return { text: state.activityDetail, source: "activity" };
    }
    return state.semanticDetail ? { text: state.semanticDetail, source: "semantic" } : null;
  }
  if (state.baseStatusKind === "working") {
    if (
      state.baseStatusText === "Prompt submitted" ||
      state.baseStatusText === "Starting task" ||
      state.baseStatusText === "Starting session" ||
      state.baseStatusText === "Compacting context"
    ) {
      return state.semanticDetail ? { text: state.semanticDetail, source: "semantic" } : null;
    }
    if (state.activityDetail) {
      return { text: state.activityDetail, source: "activity" };
    }
    return state.semanticDetail ? { text: state.semanticDetail, source: "semantic" } : null;
  }
  if (state.baseStatusKind === "active_recently") {
    if (state.semanticDetail) {
      return { text: state.semanticDetail, source: "semantic" };
    }
    return state.activityDetail ? { text: state.activityDetail, source: "activity" } : null;
  }
  if (state.semanticDetail) {
    return { text: state.semanticDetail, source: "semantic" };
  }
  return state.activityDetail ? { text: state.activityDetail, source: "activity" } : null;
}

function getLastActionFallback(state: LiveSessionState, nowMs: number): string | null {
  if (!state.lastActionDetail || !state.lastActionKind || state.lastActionAtMs <= 0) {
    return null;
  }
  const ageMs = Math.max(0, nowMs - state.lastActionAtMs);
  if (state.baseStatusKind === "idle") {
    if (ageMs > IDLE_LAST_ACTION_RETENTION_MS) {
      return null;
    }
  } else if (ageMs > RECENT_TOOL_GRACE_MS) {
    return null;
  }
  return `${state.lastActionKind === "command" ? "Last command" : "Last tool"}: ${state.lastActionDetail}`;
}

function shouldApplyEvent(
  state: LiveSessionState,
  timestampMs: number,
  precision: LiveSourcePrecision,
): boolean {
  if (precision === "hook") {
    return timestampMs >= state.latestPreciseAtMs;
  }
  return timestampMs >= state.latestPassiveAtMs && timestampMs >= state.latestPreciseAtMs;
}

function shouldApplyPassiveRecord(
  state: LiveSessionState,
  explicitTimestampMs: number | null,
  timestampMs: number,
): boolean {
  if (explicitTimestampMs === null) {
    return state.latestPreciseAtMs === 0;
  }
  return shouldApplyEvent(state, timestampMs, "passive");
}

function touchState(
  state: LiveSessionState,
  timestampMs: number,
  precision: LiveSourcePrecision,
): void {
  state.lastActivityAtMs = Math.max(state.lastActivityAtMs, timestampMs);
  if (precision === "hook") {
    state.latestPreciseAtMs = Math.max(state.latestPreciseAtMs, timestampMs);
  } else {
    state.latestPassiveAtMs = Math.max(state.latestPassiveAtMs, timestampMs);
  }
}

function coerceStatusText(
  kind: LiveSessionStatusKind,
  statusText: string | null | undefined,
): string {
  const candidate = typeof statusText === "string" ? statusText.trim() : "";
  if (candidate.length > 0) {
    return candidate;
  }
  if (kind === "running_tool") {
    return "Running tool";
  }
  if (kind === "thinking") {
    return "Thinking";
  }
  if (kind === "waiting_for_approval") {
    return "Waiting for approval";
  }
  if (kind === "waiting_for_input") {
    return "Waiting for input";
  }
  if (kind === "idle") {
    return "Idle";
  }
  if (kind === "active_recently") {
    return "Recently active";
  }
  if (kind === "working") {
    return "Working";
  }
  return "Waiting for activity";
}

function createSyntheticOperationId(
  state: LiveSessionState,
  kind: LiveOperationKind,
  hint: string,
  timestampMs: number,
): string {
  state.syntheticOperationSequence += 1;
  return `${kind}:${hint}:${timestampMs}:${state.syntheticOperationSequence}`;
}

function findReusableSyntheticOperationId(
  operations: LiveOperation[],
  kind: LiveOperationKind,
  detailText: string | null,
  timestampMs: number,
): string | null {
  if (!detailText) {
    return null;
  }
  const duplicateIndex = findLastIndex(
    operations,
    (operation) =>
      operation.kind === kind &&
      operation.detailText === detailText &&
      Math.abs(operation.startedAtMs - timestampMs) <= 1_000,
  );
  return duplicateIndex >= 0 ? (operations[duplicateIndex]?.id ?? null) : null;
}

function findOperationIndex(
  operations: LiveOperation[],
  id: string | null,
  kind: LiveOperationKind,
  detailText: string | null,
): number {
  if (id) {
    const byId = operations.findIndex((operation) => operation.id === id);
    if (byId >= 0) {
      return byId;
    }
  }
  if (detailText) {
    const byDetail = findLastIndex(
      operations,
      (operation) => operation.kind === kind && operation.detailText === detailText,
    );
    if (byDetail >= 0) {
      return byDetail;
    }
  }
  const byKind = findLastIndex(operations, (operation) => operation.kind === kind);
  if (byKind >= 0) {
    return byKind;
  }
  return operations.length === 1 ? 0 : -1;
}

function getVisibleOperation(operations: LiveOperation[]): LiveOperation | null {
  return operations.length > 0 ? (operations[operations.length - 1] ?? null) : null;
}

function cloneState(state: LiveSessionState): LiveSessionState {
  return {
    ...state,
    activeOperations: state.activeOperations.map((operation) => ({ ...operation })),
  };
}

function setBaseStatusInPlace(
  state: LiveSessionState,
  input: {
    timestampMs: number;
    precision: LiveSourcePrecision;
    statusKind: LiveSessionStatusKind;
    statusText: string;
    detailText: string | null;
    detailBucket: "semantic" | "activity" | "terminal" | "none";
  },
): void {
  touchState(state, input.timestampMs, input.precision);
  state.baseStatusKind = input.statusKind;
  state.baseStatusText = coerceStatusText(input.statusKind, input.statusText);
  state.baseSourcePrecision = input.precision;

  if (input.statusKind !== "idle") {
    state.terminalDetail = null;
    state.terminalDetailAtMs = 0;
  }

  if (input.detailBucket === "semantic") {
    state.semanticDetail = input.detailText;
    state.activityDetail = null;
  } else if (input.detailBucket === "activity") {
    state.semanticDetail = null;
    state.activityDetail = input.detailText;
  } else if (input.detailBucket === "terminal") {
    state.semanticDetail = null;
    state.activityDetail = null;
    state.terminalDetail = input.detailText;
    state.terminalDetailAtMs = input.timestampMs;
  } else {
    state.semanticDetail = null;
    state.activityDetail = null;
  }
}

function startOperationInPlace(
  state: LiveSessionState,
  input: {
    timestampMs: number;
    precision: LiveSourcePrecision;
    id: string | null;
    kind: LiveOperationKind;
    detailText: string | null;
    syntheticHint: string;
  },
): void {
  touchState(state, input.timestampMs, input.precision);
  const operationId =
    input.id ??
    findReusableSyntheticOperationId(
      state.activeOperations,
      input.kind,
      input.detailText,
      input.timestampMs,
    ) ??
    createSyntheticOperationId(state, input.kind, input.syntheticHint, input.timestampMs);
  const statusText = input.kind === "command" ? "Running command" : "Running tool";
  const existingIndex = state.activeOperations.findIndex(
    (operation) => operation.id === operationId,
  );
  const operation: LiveOperation = {
    id: operationId,
    kind: input.kind,
    detailText: input.detailText,
    statusText,
    sourcePrecision: input.precision,
    startedAtMs: input.timestampMs,
  };
  if (existingIndex >= 0) {
    state.activeOperations[existingIndex] = operation;
  } else {
    state.activeOperations.push(operation);
  }
}

function finishOperationInPlace(
  state: LiveSessionState,
  input: {
    timestampMs: number;
    precision: LiveSourcePrecision;
    id: string | null;
    kind: LiveOperationKind;
    detailText: string | null;
    syntheticHint: string;
  },
): void {
  touchState(state, input.timestampMs, input.precision);
  const matchedIndex = findOperationIndex(
    state.activeOperations,
    input.id,
    input.kind,
    input.detailText,
  );
  const matchedOperation = matchedIndex >= 0 ? state.activeOperations[matchedIndex] : null;
  if (matchedIndex >= 0) {
    state.activeOperations.splice(matchedIndex, 1);
  }
  const lastActionDetail = matchedOperation?.detailText ?? input.detailText;
  const lastActionKind = matchedOperation?.kind ?? input.kind;
  if (lastActionDetail) {
    state.lastActionDetail = lastActionDetail;
    state.lastActionKind = lastActionKind;
    state.lastActionAtMs = input.timestampMs;
  }
}

function clearOperationsByPrecisionInPlace(
  state: LiveSessionState,
  precision: LiveSourcePrecision,
  timestampMs: number,
): void {
  const removedOperations = state.activeOperations.filter(
    (operation) => operation.sourcePrecision === precision,
  );
  if (removedOperations.length === 0) {
    return;
  }
  state.activeOperations = state.activeOperations.filter(
    (operation) => operation.sourcePrecision !== precision,
  );
  const lastRemoved = removedOperations[removedOperations.length - 1] ?? null;
  if (lastRemoved?.detailText) {
    state.lastActionDetail = lastRemoved.detailText;
    state.lastActionKind = lastRemoved.kind;
    state.lastActionAtMs = timestampMs;
  }
}

function humanizeToolKind(toolName: string | null): LiveOperationKind {
  return toolName === "exec_command" ? "command" : "tool";
}

function resolveCodexCompletionKind(
  state: LiveSessionState,
  callId: string | null,
): LiveOperationKind | null {
  if (callId) {
    const matchedOperation = state.activeOperations.find((operation) => operation.id === callId);
    if (matchedOperation) {
      return matchedOperation.kind;
    }
  }
  if (state.activeOperations.length === 1) {
    return state.activeOperations[0]?.kind ?? null;
  }
  return null;
}

function humanizeToolName(toolName: string | null): string | null {
  if (!toolName) {
    return null;
  }
  if (!toolName.includes("_")) {
    return toolName;
  }
  return toolName
    .split("_")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function safeParseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readTimestampMs(value: unknown): number | null {
  const iso = toIsoTimestamp(value);
  if (!iso) {
    return null;
  }
  return new Date(iso).valueOf();
}

function extractCodexCommand(argumentsValue: unknown): string | null {
  if (typeof argumentsValue === "string") {
    try {
      const parsed = asRecord(JSON.parse(argumentsValue));
      return readString(parsed?.cmd) ?? readString(parsed?.command);
    } catch {
      return argumentsValue;
    }
  }
  const record = asRecord(argumentsValue);
  return readString(record?.cmd) ?? readString(record?.command);
}

function firstText(values: string[]): string | null {
  return values[0] ?? null;
}

// Keep a local reverse scan until the repo target includes Array.prototype.findLastIndex.
function findLastIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && predicate(value)) {
      return index;
    }
  }
  return -1;
}
