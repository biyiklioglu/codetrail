import { join } from "node:path";

import type { LiveSessionState } from "@codetrail/core";
import { firstNonEmptyString } from "@codetrail/core";

import { appendDebugLog } from "../debugLog";

const LIVE_TRACE_MAX_BYTES = 4 * 1024 * 1024;
const LIVE_TRACE_MAX_ARCHIVES = 3;
const LINE_PREVIEW_LIMIT = 600;
const DETAIL_PREVIEW_LIMIT = 240;

type JsonRecord = Record<string, unknown>;

export function getLiveTraceLogPath(userDataDir: string): string {
  return join(userDataDir, "live-status", "live-trace.jsonl");
}

export function getLiveUiTraceLogPath(userDataDir: string): string {
  return join(userDataDir, "live-status", "live-ui-trace.jsonl");
}

export function appendLiveInstrumentationRecord(
  logPath: string,
  record: Record<string, unknown>,
): void {
  appendDebugLog(logPath, `${JSON.stringify(record)}\n`, {
    maxBytes: LIVE_TRACE_MAX_BYTES,
    maxArchives: LIVE_TRACE_MAX_ARCHIVES,
  });
}

export function summarizeLiveSessionState(state: LiveSessionState): Record<string, unknown> {
  return {
    provider: state.provider,
    sessionIdentity: state.sessionIdentity,
    sourceSessionId: state.sourceSessionId,
    filePath: state.filePath,
    projectPath: state.projectPath,
    cwd: state.cwd,
    sourcePrecision: state.sourcePrecision,
    statusKind: state.statusKind,
    statusText: state.statusText,
    detailText: truncateString(state.detailText, DETAIL_PREVIEW_LIMIT),
    visibleDetailSource: state.visibleDetailSource,
    baseStatusKind: state.baseStatusKind,
    baseStatusText: state.baseStatusText,
    semanticDetail: truncateString(state.semanticDetail, DETAIL_PREVIEW_LIMIT),
    activityDetail: truncateString(state.activityDetail, DETAIL_PREVIEW_LIMIT),
    terminalDetail: truncateString(state.terminalDetail, DETAIL_PREVIEW_LIMIT),
    lastActionDetail: truncateString(state.lastActionDetail, DETAIL_PREVIEW_LIMIT),
    lastActionKind: state.lastActionKind,
    activeOperationCount: state.activeOperations.length,
    activeOperations: state.activeOperations.slice(-3).map((operation) => ({
      id: truncateString(operation.id, 80),
      kind: operation.kind,
      statusText: operation.statusText,
      detailText: truncateString(operation.detailText, DETAIL_PREVIEW_LIMIT),
      sourcePrecision: operation.sourcePrecision,
    })),
    bestEffort: state.bestEffort,
    lastActivityAt:
      state.lastActivityAtMs > 0 ? new Date(state.lastActivityAtMs).toISOString() : null,
  };
}

export function summarizeLiveLine(line: string): Record<string, unknown> {
  const parsed = safeParseJson(line);
  const record = asRecord(parsed);
  if (!record) {
    return {
      parseable: false,
      linePreview: truncateString(line, LINE_PREVIEW_LIMIT),
    };
  }

  const payload = asRecord(record.payload);
  const message = asRecord(record.message);
  const content = asArray(message?.content);
  const firstToolUse = content
    .map((entry) => asRecord(entry))
    .find((entry) => readString(entry?.type) === "tool_use");
  const firstToolResult = content
    .map((entry) => asRecord(entry))
    .find((entry) => readString(entry?.type) === "tool_result");
  const contentTypes = content
    .map((entry) => readString(asRecord(entry)?.type))
    .filter((value): value is string => Boolean(value));

  const textPreview =
    firstNonEmptyString(
      readString(record.message),
      readString(record.summary),
      readString(record.text),
      readString(record.title),
      readString(record.last_assistant_message),
      readString(record.message),
      readString(payload?.text),
      readString(payload?.title),
      readString(payload?.prompt),
      readString(payload?.reason),
      readString(payload?.command),
      readString(payload?.cmd),
      readString(firstToolResult?.content),
      findFirstText(content),
    ) ?? null;

  return {
    parseable: true,
    timestamp: readString(record.timestamp),
    type: readString(record.type),
    payloadType: readString(payload?.type),
    hookEventName: readString(record.hook_event_name),
    notificationType: readString(record.notification_type),
    toolName:
      firstNonEmptyString(
        readString(record.tool_name),
        readString(payload?.name),
        readString(firstToolUse?.name),
      ) ?? null,
    command:
      firstNonEmptyString(
        readString(record.command),
        readString(payload?.command),
        readString(payload?.cmd),
        extractArgumentsCommand(payload?.arguments),
      ) ?? null,
    contentTypes,
    textPreview: truncateString(textPreview, DETAIL_PREVIEW_LIMIT),
    transcriptPath:
      firstNonEmptyString(
        readString(record.transcript_path),
        readString(record.agent_transcript_path),
      ) ?? null,
    linePreview: truncateString(line, LINE_PREVIEW_LIMIT),
  };
}

export function areInstrumentationValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => areInstrumentationValuesEqual(value, right[index]));
  }
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (!leftRecord || !rightRecord) {
    return false;
  }
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!(key in rightRecord)) {
      return false;
    }
    if (!areInstrumentationValuesEqual(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

function safeParseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function findFirstText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = findFirstText(item);
      if (text) {
        return text;
      }
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of ["text", "content", "message", "body", "value", "thinking", "summary"]) {
    const text = findFirstText(record[key]);
    if (text) {
      return text;
    }
  }
  for (const key of ["parts", "content", "messages"]) {
    const nested = findFirstText(record[key]);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function extractArgumentsCommand(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = safeParseJson(value);
    const record = asRecord(parsed);
    return readString(record?.cmd) ?? readString(record?.command) ?? truncateString(value, 200);
  }
  const record = asRecord(value);
  return readString(record?.cmd) ?? readString(record?.command);
}

function truncateString(value: string | null | undefined, limit: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}
