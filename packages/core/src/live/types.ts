export const LIVE_SESSION_STATUS_KIND_VALUES = [
  "working",
  "thinking",
  "running_tool",
  "waiting_for_input",
  "waiting_for_approval",
  "idle",
  "active_recently",
  "unknown",
] as const;

export type LiveSessionStatusKind = (typeof LIVE_SESSION_STATUS_KIND_VALUES)[number];

export const LIVE_SOURCE_PRECISION_VALUES = ["passive", "hook"] as const;

export type LiveSourcePrecision = (typeof LIVE_SOURCE_PRECISION_VALUES)[number];

export const RECENT_TOOL_GRACE_MS = 15_000;
export const IDLE_LAST_ACTION_RETENTION_MS = 60_000;

export const CLAUDE_HOOK_EVENT_NAME_VALUES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
] as const;

export type ClaudeHookEventName = (typeof CLAUDE_HOOK_EVENT_NAME_VALUES)[number];
