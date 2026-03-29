import { describe, expect, it } from "vitest";

import { createInitialLiveSessionState } from "@codetrail/core";

import {
  areInstrumentationValuesEqual,
  summarizeLiveLine,
  summarizeLiveSessionState,
} from "./liveInstrumentation";

describe("liveInstrumentation", () => {
  it("summarizes live session state with truncated detail and visible detail source", () => {
    const state = createInitialLiveSessionState({
      provider: "codex",
      filePath: "/tmp/codex.jsonl",
      sessionIdentity: "session-1",
      sourceSessionId: "session-1",
      projectPath: "/workspace/project-one",
      cwd: "/workspace/project-one",
    });
    state.statusKind = "working";
    state.statusText = "Responding";
    state.detailText = `${"a".repeat(260)} tail`;
    state.visibleDetailSource = "last_action";
    state.lastActionDetail = "bun run typecheck";
    state.lastActionKind = "command";
    state.activeOperations.push({
      id: "call-1",
      kind: "command",
      detailText: "bun run typecheck",
      statusText: "Running command",
      sourcePrecision: "passive",
      startedAtMs: Date.parse("2026-03-24T09:00:00.000Z"),
    });

    expect(summarizeLiveSessionState(state)).toMatchObject({
      provider: "codex",
      statusKind: "working",
      visibleDetailSource: "last_action",
      lastActionDetail: "bun run typecheck",
      activeOperationCount: 1,
      activeOperations: [
        {
          id: "call-1",
          kind: "command",
          statusText: "Running command",
        },
      ],
    });
    expect((summarizeLiveSessionState(state).detailText as string | null) ?? "").toMatch(/…$/);
  });

  it("summarizes parseable live lines with tool, command, and preview metadata", () => {
    const summary = summarizeLiveLine(
      JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          command: "bun run test",
        },
        transcript_path: "/tmp/codex.jsonl",
      }),
    );

    expect(summary).toMatchObject({
      parseable: true,
      type: "response_item",
      payloadType: "function_call",
      toolName: "exec_command",
      command: "bun run test",
      transcriptPath: "/tmp/codex.jsonl",
    });
  });

  it("compares nested instrumentation values structurally", () => {
    expect(
      areInstrumentationValuesEqual(
        {
          state: {
            statusKind: "running_tool",
            activeOperations: [{ id: "call-1", detailText: "bun run test" }],
          },
        },
        {
          state: {
            statusKind: "running_tool",
            activeOperations: [{ id: "call-1", detailText: "bun run test" }],
          },
        },
      ),
    ).toBe(true);

    expect(
      areInstrumentationValuesEqual(
        {
          state: {
            statusKind: "running_tool",
            activeOperations: [{ id: "call-1", detailText: "bun run test" }],
          },
        },
        {
          state: {
            statusKind: "running_tool",
            activeOperations: [{ id: "call-1", detailText: "bun run typecheck" }],
          },
        },
      ),
    ).toBe(false);
  });
});
