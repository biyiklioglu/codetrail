import { describe, expect, it } from "vitest";

import type { ParserDiagnostic } from "./contracts";
import { parseProviderPayload } from "./providerParsers";

const baseEvent = {
  type: "user",
  created_at: "2024-01-01T00:00:00Z",
};

describe("parseProviderPayload (Gemini attachment normalization)", () => {
  it("summarizes large referenced file dumps", () => {
    const payload = {
      messages: [
        {
          ...baseEvent,
          parts: [
            {
              text: [
                "Do the task described below.",
                "--- Content from referenced files ---",
                "Content from @src/README.md:",
                "# Project",
                "Content from @src/checkpoints/model-1.bin:",
                "Cannot display content of binary file: model-1.bin",
                "Content from @src/checkpoints/model-2.bin:",
                "Cannot display content of binary file: model-2.bin",
                "Content from @src/checkpoints/model-3.bin:",
                "Cannot display content of binary file: model-3.bin",
                "Content from @src/checkpoints/model-4.bin:",
                "Cannot display content of binary file: model-4.bin",
                "Content from @src/checkpoints/model-5.bin:",
                "Cannot display content of binary file: model-5.bin",
                "Content from @src/checkpoints/model-6.bin:",
                "Cannot display content of binary file: model-6.bin",
                "Content from @src/checkpoints/model-7.bin:",
                "Cannot display content of binary file: model-7.bin",
              ].join("\n"),
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "gemini",
      sessionId: "sess-1",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.category).toBe("user");
    expect(messages[0]?.content).toContain("Do the task described below.");
    expect(messages[1]?.category).toBe("system");
    expect(messages[1]?.content).toContain("Gemini attachment dump truncated");
    expect(messages[1]?.content).toContain("@src/README.md");
    expect(messages.map((msg) => msg.content).join("\n")).not.toContain(
      "Cannot display content of binary file",
    );
  });

  it("leaves small attachment blocks untouched", () => {
    const payload = {
      messages: [
        {
          ...baseEvent,
          parts: [
            {
              text: [
                "Task details",
                "--- Content from referenced files ---",
                "Content from @src/small.txt:",
                "Just a short snippet",
              ].join("\n"),
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "gemini",
      sessionId: "sess-2",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("user");
    expect(messages[0]?.content).toContain("Content from @src/small.txt:");
  });
});

describe("parseProviderPayload (Copilot)", () => {
  it("parses user messages and markdown responses", () => {
    const payload = {
      requests: [
        {
          requestId: "req-1",
          timestamp: 1741615200000,
          message: { text: "Hello Copilot" },
          response: [{ kind: "markdownContent", value: "Hello! How can I help?" }],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.category).toBe("user");
    expect(messages[0]?.content).toBe("Hello Copilot");
    expect(messages[1]?.category).toBe("assistant");
    expect(messages[1]?.content).toBe("Hello! How can I help?");
  });

  it("extracts tool invocations as tool_use", () => {
    const payload = {
      requests: [
        {
          requestId: "req-2",
          timestamp: 1741615200000,
          message: { text: "Open the file" },
          response: [
            {
              kind: "toolInvocationSerialized",
              toolId: "vscode.open",
              toolSpecificData: { commandLine: "code test.ts" },
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.category).toBe("tool_use");
    expect(messages[1]?.content).toContain("vscode.open");
  });

  it("maps elicitation to system messages", () => {
    const payload = {
      requests: [
        {
          requestId: "req-3",
          timestamp: 1741615200000,
          message: { text: "Do it" },
          response: [
            {
              kind: "elicitation",
              title: "Confirm",
              message: "Are you sure?",
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.category).toBe("system");
    expect(messages[1]?.content).toBe("Confirm: Are you sure?");
  });

  it("skips progressMessage and progressTask response items", () => {
    const payload = {
      requests: [
        {
          requestId: "req-4",
          timestamp: 1741615200000,
          message: { text: "Run task" },
          response: [
            { kind: "progressMessage", value: "Working..." },
            { kind: "progressTask", value: "Step 1" },
            { kind: "markdownContent", value: "Done!" },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.category).toBe("user");
    expect(messages[1]?.category).toBe("assistant");
    expect(messages[1]?.content).toBe("Done!");
  });

  it("returns empty array for payload without requests", () => {
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload: { version: 3 },
      diagnostics,
    });

    expect(messages).toHaveLength(0);
  });
});

describe("parseProviderPayload (OpenCode)", () => {
  it("maps text, reasoning, tool usage, edits, and results into canonical categories", () => {
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "opencode",
      sessionId: "opencode-test",
      diagnostics,
      payload: {
        session: { id: "ses-1", directory: "/workspace/opencode" },
        project: { id: "project-1", worktree: "/workspace/opencode" },
        messages: [
          {
            id: "msg-user-1",
            timeCreated: 1_775_765_274_798,
            timeUpdated: 1_775_765_274_798,
            data: {
              role: "user",
              time: { created: 1_775_765_274_798 },
            },
            parts: [{ id: "p1", data: { type: "text", text: "Build the feature" } }],
          },
          {
            id: "msg-assistant-1",
            timeCreated: 1_775_765_274_808,
            timeUpdated: 1_775_765_279_366,
            data: {
              role: "assistant",
              modelID: "glm-5.1:cloud",
              tokens: { input: 42, output: 11 },
              time: { created: 1_775_765_274_808, completed: 1_775_765_279_366 },
            },
            parts: [
              {
                id: "p2",
                data: {
                  type: "reasoning",
                  text: "I should inspect the files first.",
                  time: { start: 1_775_765_274_809, end: 1_775_765_274_900 },
                },
              },
              {
                id: "p3",
                data: {
                  type: "tool",
                  tool: "read",
                  callID: "call-read-1",
                  state: {
                    status: "completed",
                    input: { filePath: "/workspace/opencode/README.md" },
                    output: "README contents",
                    time: { start: 1_775_765_274_901, end: 1_775_765_275_000 },
                  },
                },
              },
              {
                id: "p4",
                data: {
                  type: "tool",
                  tool: "write",
                  callID: "call-write-1",
                  state: {
                    status: "completed",
                    input: {
                      filePath: "/workspace/opencode/src/app.ts",
                      content: "console.log('hello')",
                    },
                    output: "Wrote file successfully.",
                    time: { start: 1_775_765_275_001, end: 1_775_765_275_100 },
                  },
                },
              },
              {
                id: "p5",
                data: {
                  type: "text",
                  text: "Implemented the change.",
                },
              },
            ],
          },
        ],
      },
    });

    expect(messages.map((message) => message.category)).toEqual([
      "user",
      "thinking",
      "tool_use",
      "tool_result",
      "tool_edit",
      "tool_result",
      "assistant",
    ]);
    expect(messages[0]?.content).toBe("Build the feature");
    expect(messages[2]?.content).toContain("\"name\":\"read\"");
    expect(messages[4]?.content).toContain("\"name\":\"write\"");
    expect(messages[4]?.content).toContain("\"filePath\":\"/workspace/opencode/src/app.ts\"");
    expect(messages[6]?.content).toBe("Implemented the change.");
    expect(messages[1]?.operationDurationSource).toBe("native");
    expect(messages[6]?.tokenInput).toBeNull();
    expect(messages[1]?.tokenInput).toBe(42);
    expect(messages[1]?.tokenOutput).toBe(11);
  });
});

describe("parseProviderPayload (Codex tool classification)", () => {
  it("keeps write_stdin as tool_use", () => {
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "codex",
      sessionId: "codex-test",
      payload: [
        {
          type: "response_item",
          timestamp: "2026-03-21T19:48:31.960Z",
          payload: {
            id: "call-write-stdin",
            type: "custom_tool_call",
            call_id: "call-write-stdin",
            name: "write_stdin",
            input: {
              session_id: 123,
              chars: "",
              yield_time_ms: 1000,
            },
          },
        },
      ],
      diagnostics,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("tool_use");
    expect(messages[0]?.content).toContain("write_stdin");
  });

  it("still classifies apply_patch as tool_edit", () => {
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "codex",
      sessionId: "codex-test",
      payload: [
        {
          type: "response_item",
          timestamp: "2026-03-21T19:47:10.130Z",
          payload: {
            id: "call-apply-patch",
            type: "custom_tool_call",
            call_id: "call-apply-patch",
            name: "apply_patch",
            input: "*** Begin Patch\n*** End Patch\n",
          },
        },
      ],
      diagnostics,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("tool_edit");
    expect(messages[0]?.content).toContain("apply_patch");
  });
});
