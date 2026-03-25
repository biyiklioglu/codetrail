import { describe, expect, it } from "vitest";

import {
  applyClaudeHookLine,
  applyClaudeTranscriptLine,
  applyCodexLiveLine,
  createInitialLiveSessionState,
  finalizeLiveSessionState,
  readClaudeHookTranscriptPath,
} from "./liveSessionState";

function createState(provider: "claude" | "codex") {
  return createInitialLiveSessionState({
    provider,
    filePath: `/tmp/${provider}.jsonl`,
    sessionIdentity: `${provider}-session`,
    sourceSessionId: `${provider}-session`,
    projectName: "codetrail",
    projectPath: "/workspace/codetrail",
    cwd: "/workspace/codetrail",
  });
}

describe("liveSessionState", () => {
  it("maps Codex task start and reasoning events to active statuses", () => {
    const started = applyCodexLiveLine(
      createState("codex"),
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", title: "Investigate live status" },
      }),
      Date.parse("2026-03-24T09:00:00.000Z"),
    );

    expect(started.statusKind).toBe("working");
    expect(started.statusText).toBe("Starting task");

    const thinking = applyCodexLiveLine(
      started,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:01.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "text", text: "Inspecting session files" }],
        },
      }),
      Date.parse("2026-03-24T09:00:01.000Z"),
    );

    expect(thinking.statusKind).toBe("thinking");
    expect(thinking.detailText).toBe("Inspecting session files");
  });

  it("tracks Codex tool execution and restores the previous active state", () => {
    const working = applyCodexLiveLine(
      createState("codex"),
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Applying patch" },
      }),
      Date.parse("2026-03-24T09:00:00.000Z"),
    );

    const runningTool = applyCodexLiveLine(
      working,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run typecheck" },
        },
      }),
      Date.parse("2026-03-24T09:00:01.000Z"),
    );

    expect(runningTool.statusKind).toBe("running_tool");
    expect(runningTool.detailText).toBe("bun run typecheck");

    const resumed = applyCodexLiveLine(
      runningTool,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:02.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-1" },
      }),
      Date.parse("2026-03-24T09:00:02.000Z"),
    );

    expect(resumed.statusKind).toBe("working");
    expect(resumed.statusText).toBe("Working");
  });

  it("maps Codex approval and input requests", () => {
    const waitingApproval = applyCodexLiveLine(
      createState("codex"),
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "shell_approval_request", command: "git commit -m test" },
      }),
      Date.parse("2026-03-24T09:00:00.000Z"),
    );
    expect(waitingApproval.statusKind).toBe("waiting_for_approval");
    expect(waitingApproval.detailText).toBe("git commit -m test");

    const waitingInput = applyCodexLiveLine(
      waitingApproval,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:01.000Z",
        type: "event_msg",
        payload: { type: "request_user_input", prompt: "Choose a provider" },
      }),
      Date.parse("2026-03-24T09:00:01.000Z"),
    );
    expect(waitingInput.statusKind).toBe("waiting_for_input");
    expect(waitingInput.detailText).toBe("Choose a provider");
  });

  it("downgrades passive sessions to idle after inactivity and ignores unknown records", () => {
    const working = applyCodexLiveLine(
      createState("codex"),
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Still working" },
      }),
      Date.parse("2026-03-24T09:00:00.000Z"),
    );

    const unchanged = applyCodexLiveLine(
      working,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:01.000Z",
        type: "event_msg",
        payload: { type: "something_new", text: "ignore me" },
      }),
      Date.parse("2026-03-24T09:00:01.000Z"),
    );
    expect(unchanged.statusKind).toBe("working");

    const finalized = finalizeLiveSessionState(unchanged, {
      nowMs: Date.parse("2026-03-24T09:03:30.000Z"),
      idleTimeoutMs: 120_000,
    });
    expect(finalized.statusKind).toBe("idle");
    expect(finalized.statusText).toBe("Idle");
  });

  it("derives coarse Claude transcript states without hooks", () => {
    const runningTool = applyClaudeTranscriptLine(
      createState("claude"),
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read" }],
        },
      }),
      Date.parse("2026-03-24T09:00:00.000Z"),
    );
    expect(runningTool.statusKind).toBe("running_tool");
    expect(runningTool.sourcePrecision).toBe("passive");

    const userUpdate = applyClaudeTranscriptLine(
      runningTool,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:01.000Z",
        type: "user",
        message: {
          content: [{ type: "text", text: "Continue" }],
        },
      }),
      Date.parse("2026-03-24T09:00:01.000Z"),
    );
    expect(userUpdate.statusKind).toBe("active_recently");
    expect(userUpdate.statusText).toBe("Prompt updated");
  });

  it("uses Claude hooks for precise session, tool, approval, and idle states", () => {
    const sessionStarted = applyClaudeHookLine(
      createState("claude"),
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        hook_event_name: "SessionStart",
        source: "claude --resume",
      }),
      Date.parse("2026-03-24T09:00:00.000Z"),
    );
    expect(sessionStarted.statusText).toBe("Starting session");
    expect(sessionStarted.sourcePrecision).toBe("hook");

    const promptSubmitted = applyClaudeHookLine(
      sessionStarted,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:01.000Z",
        hook_event_name: "UserPromptSubmit",
        message: "Check the watcher",
      }),
      Date.parse("2026-03-24T09:00:01.000Z"),
    );
    expect(promptSubmitted.statusText).toBe("Prompt submitted");

    const runningTool = applyClaudeHookLine(
      promptSubmitted,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:02.000Z",
        hook_event_name: "PreToolUse",
        tool_name: "Read",
      }),
      Date.parse("2026-03-24T09:00:02.000Z"),
    );
    expect(runningTool.statusKind).toBe("running_tool");
    expect(runningTool.detailText).toBe("Read");

    const finishedTool = applyClaudeHookLine(
      runningTool,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:03.000Z",
        hook_event_name: "PostToolUse",
        tool_name: "Read",
      }),
      Date.parse("2026-03-24T09:00:03.000Z"),
    );
    expect(finishedTool.statusText).toBe("Tool finished");

    const waitingApproval = applyClaudeHookLine(
      finishedTool,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:04.000Z",
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        message: "Allow file write",
      }),
      Date.parse("2026-03-24T09:00:04.000Z"),
    );
    expect(waitingApproval.statusKind).toBe("waiting_for_approval");
    expect(waitingApproval.sourcePrecision).toBe("hook");

    const idlePrompt = applyClaudeHookLine(
      waitingApproval,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:05.000Z",
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
        message: "Paused",
      }),
      Date.parse("2026-03-24T09:00:05.000Z"),
    );
    expect(idlePrompt.statusKind).toBe("idle");

    const genericNotification = applyClaudeHookLine(
      idlePrompt,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:06.000Z",
        hook_event_name: "Notification",
        notification_type: "other",
        message: "Heads up",
      }),
      Date.parse("2026-03-24T09:00:06.000Z"),
    );
    expect(genericNotification.statusText).toBe("Notification received");

    const idle = applyClaudeHookLine(
      genericNotification,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:07.000Z",
        hook_event_name: "Stop",
        message: "Waiting on the user",
      }),
      Date.parse("2026-03-24T09:00:07.000Z"),
    );
    expect(idle.statusKind).toBe("idle");
    expect(idle.statusText).toBe("Idle");

    const sessionEnded = applyClaudeHookLine(
      idle,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:08.000Z",
        hook_event_name: "SessionEnd",
        message: "Complete",
      }),
      Date.parse("2026-03-24T09:00:08.000Z"),
    );
    expect(sessionEnded.statusText).toBe("Session ended");
  });

  it("reads only Claude transcript path fields from hook records", () => {
    expect(
      readClaudeHookTranscriptPath(
        JSON.stringify({
          transcript_path: "/tmp/claude-session.jsonl",
          cwd: "/workspace/ignored",
        }),
      ),
    ).toBe("/tmp/claude-session.jsonl");

    expect(
      readClaudeHookTranscriptPath(
        JSON.stringify({
          agent_transcript_path: "/tmp/claude-subagent.jsonl",
        }),
      ),
    ).toBe("/tmp/claude-subagent.jsonl");
  });
});
