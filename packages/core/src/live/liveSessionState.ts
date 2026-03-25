import type { Provider } from "../contracts/canonical";
import { asArray, asRecord, extractText, readString, toIsoTimestamp } from "../parsing/helpers";
import type { ClaudeHookEventName, LiveSessionStatusKind, LiveSourcePrecision } from "./types";

export type LiveSessionState = {
  provider: Provider;
  filePath: string;
  sessionIdentity: string;
  sourceSessionId: string;
  projectName: string | null;
  projectPath: string | null;
  cwd: string | null;
  lastActivityAtMs: number;
  sourcePrecision: LiveSourcePrecision;
  statusKind: LiveSessionStatusKind;
  statusText: string;
  detailText: string | null;
  resumeStatusKind: LiveSessionStatusKind | null;
  activeToolName: string | null;
  bestEffort: boolean;
};

export type LiveStatusInput = {
  nowMs: number;
  idleTimeoutMs: number;
};

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
    sourcePrecision: "passive",
    statusKind: "unknown",
    statusText: "Waiting for activity",
    detailText: null,
    resumeStatusKind: null,
    activeToolName: null,
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

  const timestampMs = readTimestampMs(record.timestamp) ?? nowMs;
  const recordType = readString(record.type);
  if (!recordType) {
    return state;
  }

  if (recordType === "session_meta" || recordType === "turn_context") {
    const payload = asRecord(record.payload);
    const next = cloneState(state);
    next.cwd = readString(payload?.cwd) ?? next.cwd;
    next.lastActivityAtMs = Math.max(next.lastActivityAtMs, timestampMs);
    return next;
  }

  if (recordType === "event_msg") {
    return applyCodexEventMessage(state, asRecord(record.payload), timestampMs);
  }

  if (recordType === "response_item") {
    return applyCodexResponseItem(state, asRecord(record.payload), timestampMs);
  }

  if (recordType === "compacted") {
    return updateState(state, {
      timestampMs,
      statusKind: "working",
      statusText: "Compacting context",
      detailText: "Codex compacted the running session",
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

  const timestampMs = readTimestampMs(record.timestamp) ?? nowMs;
  const recordType = readString(record.type);
  const message = asRecord(record.message);
  const content = asArray(message?.content);
  const toolUse = content
    .map((entry) => asRecord(entry))
    .find((entry) => readString(entry?.type) === "tool_use");
  const hasThinking = content.some((entry) => readString(asRecord(entry)?.type) === "thinking");

  const next = cloneState(state);
  next.cwd = readString(record.cwd) ?? next.cwd;

  if (recordType === "assistant") {
    if (toolUse) {
      return updateState(next, {
        timestampMs,
        statusKind: "running_tool",
        statusText: "Running tool",
        detailText: readString(toolUse.name),
      });
    }

    if (hasThinking) {
      return updateState(next, {
        timestampMs,
        statusKind: "thinking",
        statusText: "Thinking",
        detailText: firstText(extractText(content)),
      });
    }

    return updateState(next, {
      timestampMs,
      statusKind: "working",
      statusText: "Responding",
      detailText: firstText(extractText(content)),
    });
  }

  if (recordType === "user") {
    const toolResult = content
      .map((entry) => asRecord(entry))
      .find((entry) => readString(entry?.type) === "tool_result");
    return updateState(next, {
      timestampMs,
      statusKind: toolResult ? "working" : "active_recently",
      statusText: toolResult ? "Processing tool result" : "Prompt updated",
      detailText: firstText(extractText(content)),
    });
  }

  if (recordType === "summary") {
    return updateState(next, {
      timestampMs,
      statusKind: "active_recently",
      statusText: "Session updated",
      detailText: readString(record.summary),
    });
  }

  return next;
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
  const detailText =
    readString(record.tool_name) ??
    readString(record.message) ??
    readString(record.title) ??
    readString(record.last_assistant_message);

  if (hookEventName === "SessionStart") {
    return updateState(state, {
      timestampMs,
      statusKind: "working",
      statusText: "Starting session",
      detailText: readString(record.source),
      sourcePrecision: "hook",
    });
  }

  if (hookEventName === "SessionEnd") {
    return updateState(state, {
      timestampMs,
      statusKind: "idle",
      statusText: "Session ended",
      detailText,
      sourcePrecision: "hook",
    });
  }

  if (hookEventName === "UserPromptSubmit") {
    return updateState(state, {
      timestampMs,
      statusKind: "working",
      statusText: "Prompt submitted",
      detailText,
      sourcePrecision: "hook",
    });
  }

  if (hookEventName === "PreToolUse") {
    return updateState(state, {
      timestampMs,
      statusKind: "running_tool",
      statusText: "Running tool",
      detailText,
      sourcePrecision: "hook",
    });
  }

  if (hookEventName === "PostToolUse") {
    return updateState(state, {
      timestampMs,
      statusKind: "working",
      statusText: "Tool finished",
      detailText,
      sourcePrecision: "hook",
    });
  }

  if (hookEventName === "Notification") {
    const notificationType = readString(record.notification_type);
    if (notificationType === "permission_prompt") {
      return updateState(state, {
        timestampMs,
        statusKind: "waiting_for_approval",
        statusText: "Waiting for approval",
        detailText,
        sourcePrecision: "hook",
      });
    }
    if (notificationType === "idle_prompt") {
      return updateState(state, {
        timestampMs,
        statusKind: "idle",
        statusText: "Idle",
        detailText,
        sourcePrecision: "hook",
      });
    }
    return updateState(state, {
      timestampMs,
      statusKind: "active_recently",
      statusText: "Notification received",
      detailText,
      sourcePrecision: "hook",
    });
  }

  if (hookEventName === "Stop") {
    return updateState(state, {
      timestampMs,
      statusKind: "idle",
      statusText: "Idle",
      detailText,
      sourcePrecision: "hook",
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
  if (
    staleForMs >= input.idleTimeoutMs &&
    next.statusKind !== "waiting_for_approval" &&
    next.statusKind !== "waiting_for_input" &&
    next.statusKind !== "running_tool" &&
    next.sourcePrecision !== "hook"
  ) {
    next.statusKind = "idle";
    next.statusText = "Idle";
    if (!next.detailText && staleForMs > input.idleTimeoutMs * 2) {
      next.detailText = "No recent session activity";
    }
  }
  return next;
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
  if (!eventType) {
    return state;
  }

  if (eventType === "task_started") {
    return updateState(state, {
      timestampMs,
      statusKind: "working",
      statusText: "Starting task",
      detailText: firstText(extractText(payload)),
    });
  }

  if (eventType === "task_complete") {
    return updateState(state, {
      timestampMs,
      statusKind: "idle",
      statusText: "Idle",
      detailText: null,
    });
  }

  if (eventType === "turn_aborted") {
    return updateState(state, {
      timestampMs,
      statusKind: "idle",
      statusText: "Turn aborted",
      detailText: null,
    });
  }

  if (eventType.includes("approval_request")) {
    return updateState(state, {
      timestampMs,
      statusKind: "waiting_for_approval",
      statusText: "Waiting for approval",
      detailText: readString(eventPayload.command) ?? readString(eventPayload.reason),
    });
  }

  if (
    eventType === "request_user_input" ||
    eventType === "elicitation_request" ||
    eventType === "user-input-requested"
  ) {
    return updateState(state, {
      timestampMs,
      statusKind: "waiting_for_input",
      statusText: "Waiting for input",
      detailText: readString(eventPayload.prompt) ?? readString(eventPayload.title),
    });
  }

  if (eventType.includes("reasoning")) {
    return updateState(state, {
      timestampMs,
      statusKind: "thinking",
      statusText: "Thinking",
      detailText: firstText(extractText(eventPayload)),
    });
  }

  if (eventType === "exec_command_begin") {
    return updateState(state, {
      timestampMs,
      statusKind: "running_tool",
      statusText: "Running command",
      detailText: readString(eventPayload.command) ?? readString(eventPayload.cmd),
    });
  }

  if (eventType === "exec_command_end") {
    return updateState(state, {
      timestampMs,
      statusKind: state.resumeStatusKind ?? "working",
      statusText: "Working",
      detailText: null,
    });
  }

  if (eventType === "agent_message") {
    return updateState(state, {
      timestampMs,
      statusKind: "working",
      statusText: "Responding",
      detailText: firstText(extractText(eventPayload)),
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
  if (!payloadType) {
    return state;
  }

  if (payloadType === "reasoning") {
    return updateState(state, {
      timestampMs,
      statusKind: "thinking",
      statusText: "Thinking",
      detailText: firstText(extractText(itemPayload.summary)),
    });
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    const toolName = readString(itemPayload.name);
    const detailText =
      toolName === "exec_command" ? extractCodexCommand(itemPayload.arguments) : toolName;
    return updateState(state, {
      timestampMs,
      statusKind: "running_tool",
      statusText: toolName === "exec_command" ? "Running command" : "Running tool",
      detailText,
    });
  }

  if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
    return updateState(state, {
      timestampMs,
      statusKind: state.resumeStatusKind ?? "working",
      statusText: "Working",
      detailText: null,
    });
  }

  if (payloadType === "message") {
    const role = readString(itemPayload.role);
    if (role === "assistant") {
      return updateState(state, {
        timestampMs,
        statusKind: "working",
        statusText: "Responding",
        detailText: firstText(extractText(itemPayload.content)),
      });
    }
    if (role === "user") {
      return updateState(state, {
        timestampMs,
        statusKind: "active_recently",
        statusText: "Prompt updated",
        detailText: firstText(extractText(itemPayload.content)),
      });
    }
  }

  return state;
}

function updateState(
  state: LiveSessionState,
  input: {
    timestampMs: number;
    statusKind: LiveSessionStatusKind;
    statusText: string;
    detailText?: string | null;
    sourcePrecision?: LiveSourcePrecision;
  },
): LiveSessionState {
  const next = cloneState(state);
  next.lastActivityAtMs = Math.max(next.lastActivityAtMs, input.timestampMs);
  next.statusKind = input.statusKind;
  next.statusText = input.statusText;
  next.detailText = input.detailText ?? null;
  next.sourcePrecision = input.sourcePrecision ?? next.sourcePrecision;
  if (input.statusKind === "running_tool") {
    next.resumeStatusKind =
      state.statusKind === "running_tool" ? state.resumeStatusKind : state.statusKind;
    next.activeToolName = input.detailText ?? state.activeToolName;
  } else {
    next.activeToolName = null;
    if (input.statusKind !== "waiting_for_approval" && input.statusKind !== "waiting_for_input") {
      next.resumeStatusKind = null;
    }
  }
  return next;
}

function cloneState(state: LiveSessionState): LiveSessionState {
  return { ...state };
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
