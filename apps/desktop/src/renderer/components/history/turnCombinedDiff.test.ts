import { beforeEach, describe, expect, it } from "vitest";

import { type TurnCombinedMessage, aggregateTurnCombinedFiles } from "./turnCombinedDiff";

let codexMessageCounter = 0;

function createCodexPatchMessage(patch: string): TurnCombinedMessage {
  codexMessageCounter += 1;
  return {
    id: `message_${codexMessageCounter}`,
    provider: "codex",
    category: "tool_edit",
    content: JSON.stringify({
      name: "apply_patch",
      input: patch,
    }),
    createdAt: `2026-04-08T08:00:${String(codexMessageCounter).padStart(2, "0")}.000Z`,
  };
}

describe("aggregateTurnCombinedFiles", () => {
  beforeEach(() => {
    codexMessageCounter = 0;
  });

  it("shows a single exact edit as a diff", () => {
    const messages = [
      createCodexPatchMessage(
        [
          "*** Begin Patch",
          "*** Update File: src/new-file.ts",
          "@@",
          "-export const created = false;",
          "+export const created = true;",
          "*** End Patch",
        ].join("\n"),
      ),
    ];

    const [file] = aggregateTurnCombinedFiles(messages);

    expect(file?.renderMode).toBe("diff");
    expect(file?.displayUnifiedDiff).toContain("+++ b/src/new-file.ts");
    expect(file?.displayUnifiedDiff).toContain("+export const created = true;");
    expect(file?.addedLineCount).toBe(1);
    expect(file?.removedLineCount).toBe(1);
  });

  it("shows a single best-effort delete as sequence", () => {
    const messages: TurnCombinedMessage[] = [
      {
        id: "message_1",
        provider: "claude",
        category: "tool_edit",
        content: '{"name":"Delete","input":{"file_path":"src/query.ts"}}',
        createdAt: "2026-04-08T08:00:00.000Z",
        toolEditFiles: [
          {
            filePath: "src/query.ts",
            previousFilePath: null,
            changeType: "delete",
            unifiedDiff: null,
            addedLineCount: 0,
            removedLineCount: 0,
            exactness: "best_effort",
          },
        ],
      },
    ];

    const [file] = aggregateTurnCombinedFiles(messages);

    expect(file?.renderMode).toBe("sequence");
    expect(file?.displayUnifiedDiff).toBeNull();
    expect(file?.changeType).toBe("delete");
    expect(file?.sequenceEdits).toHaveLength(1);
    expect(file?.sequenceEdits[0]?.unifiedDiff).toContain("+++ /dev/null");
    expect(file?.removedLineCount).toBe(1);
  });

  it("shows multiple exact edits as sequence and sums counts", () => {
    const messages = [
      createCodexPatchMessage(
        [
          "*** Begin Patch",
          "*** Update File: src/useHistoryController.ts",
          "@@",
          ' import { useHistoryViewportEffects } from "./useHistoryViewportEffects";',
          '+import { buildTurnCategoryCounts, buildTurnVisibleMessages } from "./turnViewModel";',
          "*** End Patch",
        ].join("\n"),
      ),
      createCodexPatchMessage(
        [
          "*** Begin Patch",
          "*** Update File: src/useHistoryController.ts",
          "@@",
          "   const activeHistoryMessageIds = useMemo(",
          "     () => activeHistoryMessages.map((message) => message.id),",
          "     [activeHistoryMessages],",
          "   );",
          "+  const detailMessages =",
          '+    historyDetailMode === "turn" ? turnVisibleMessages : activeHistoryMessages;',
          "*** End Patch",
        ].join("\n"),
      ),
    ];

    const [file] = aggregateTurnCombinedFiles(messages);

    expect(file?.renderMode).toBe("sequence");
    expect(file?.displayUnifiedDiff).toBeNull();
    expect(file?.sequenceEdits).toHaveLength(2);
    expect(file?.addedLineCount).toBe(3);
    expect(file?.removedLineCount).toBe(0);
  });

  it("keeps add-then-update chains in sequence mode with net add identity", () => {
    const messages = [
      createCodexPatchMessage(
        [
          "*** Begin Patch",
          "*** Add File: src/historyRefreshPlanner.ts",
          '+import { alpha } from "./alpha";',
          '+import { beta } from "./beta";',
          "+",
          "+export const ready = true;",
          "*** End Patch",
        ].join("\n"),
      ),
      createCodexPatchMessage(
        [
          "*** Begin Patch",
          "*** Update File: src/historyRefreshPlanner.ts",
          "@@",
          ' import { alpha } from "./alpha";',
          '-import { beta } from "./beta";',
          '+import { gamma } from "./gamma";',
          " ",
          " export const ready = true;",
          "*** End Patch",
        ].join("\n"),
      ),
    ];

    const [file] = aggregateTurnCombinedFiles(messages);

    expect(file?.renderMode).toBe("sequence");
    expect(file?.displayUnifiedDiff).toBeNull();
    expect(file?.changeType).toBe("add");
    expect(file?.previousFilePath).toBeNull();
    expect(file?.sequenceEdits).toHaveLength(2);
  });

  it("keeps overlapping rewrites in sequence mode", () => {
    const messages = [
      createCodexPatchMessage(
        [
          "*** Begin Patch",
          "*** Update File: src/controller.ts",
          "@@",
          " function loadValue() {",
          '-  return "old";',
          '+  return "mid";',
          " }",
          "*** End Patch",
        ].join("\n"),
      ),
      createCodexPatchMessage(
        [
          "*** Begin Patch",
          "*** Update File: src/controller.ts",
          "@@",
          " function loadValue() {",
          '-  return "mid";',
          '+  return "new";',
          " }",
          "*** End Patch",
        ].join("\n"),
      ),
    ];

    const [file] = aggregateTurnCombinedFiles(messages);

    expect(file?.renderMode).toBe("sequence");
    expect(file?.displayUnifiedDiff).toBeNull();
    expect(file?.sequenceEdits).toHaveLength(2);
    expect(file?.addedLineCount).toBe(2);
    expect(file?.removedLineCount).toBe(2);
  });

  it("preserves exact move metadata for single-edit diffs", () => {
    const messages = [
      createCodexPatchMessage(
        [
          "*** Begin Patch",
          "*** Update File: src/old-name.ts",
          "*** Move to: src/new-name.ts",
          "@@",
          "-export const oldName = true;",
          "+export const newName = true;",
          "*** End Patch",
        ].join("\n"),
      ),
    ];

    const [file] = aggregateTurnCombinedFiles(messages);

    expect(file?.renderMode).toBe("diff");
    expect(file?.filePath).toBe("src/new-name.ts");
    expect(file?.previousFilePath).toBe("src/old-name.ts");
    expect(file?.changeType).toBe("move");
    expect(file?.displayUnifiedDiff).toContain("+++ b/src/new-name.ts");
  });

  it("filters out Claude internal artifact files from combined changes", () => {
    const messages: TurnCombinedMessage[] = [
      {
        id: "message_1",
        provider: "claude",
        category: "tool_edit",
        content:
          '{"name":"Write","input":{"file_path":"/Users/test/.claude/projects/foo/tool-results/bar.txt"}}',
        createdAt: "2026-04-08T08:00:00.000Z",
        toolEditFiles: [
          {
            filePath: "/Users/test/.claude/projects/foo/tool-results/bar.txt",
            previousFilePath: null,
            changeType: "add",
            unifiedDiff:
              "--- a//Users/test/.claude/projects/foo/tool-results/bar.txt\n+++ b//Users/test/.claude/projects/foo/tool-results/bar.txt\n@@ -0,0 +1,1 @@\n+artifact",
            addedLineCount: 1,
            removedLineCount: 0,
            exactness: "best_effort",
          },
          {
            filePath: "/workspace/project-one/src/query.ts",
            previousFilePath: null,
            changeType: "update",
            unifiedDiff:
              "--- a//workspace/project-one/src/query.ts\n+++ b//workspace/project-one/src/query.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
            addedLineCount: 1,
            removedLineCount: 1,
            exactness: "exact",
          },
        ],
      },
    ];

    const files = aggregateTurnCombinedFiles(messages);

    expect(files).toHaveLength(1);
    expect(files[0]?.filePath).toBe("/workspace/project-one/src/query.ts");
  });

  it("ignores tool_result diff output and only keeps true writes", () => {
    const messages: TurnCombinedMessage[] = [
      {
        id: "message_1",
        provider: "claude",
        category: "tool_use",
        content: JSON.stringify({
          type: "tool_use",
          name: "Read",
          input: {
            file_path: "/Users/test/.claude/projects/foo/tool-results/diff.txt",
          },
        }),
        createdAt: "2026-04-08T08:00:00.000Z",
      },
      {
        id: "message_2",
        provider: "claude",
        category: "tool_result",
        content: [
          "1\tdiff --git a/apps/desktop/src/main/data/bookmarkStore.ts b/apps/desktop/src/main/data/bookmarkStore.ts",
          "2\tindex 1111111..2222222 100644",
          "3\t--- a/apps/desktop/src/main/data/bookmarkStore.ts",
          "4\t+++ b/apps/desktop/src/main/data/bookmarkStore.ts",
          "5\t@@ -1,2 +1,3 @@",
          "6\t export function loadBookmarks() {",
          "7\t+  return 1;",
          "8\t }",
        ].join("\n"),
        createdAt: "2026-04-08T08:00:01.000Z",
      },
    ];

    const [file] = aggregateTurnCombinedFiles(messages);

    expect(file).toBeUndefined();
  });

  it("ignores non-write Read tool paths when no diff output exists", () => {
    const messages: TurnCombinedMessage[] = [
      {
        id: "message_1",
        provider: "claude",
        category: "tool_use",
        content: JSON.stringify({
          type: "tool_use",
          name: "Read",
          input: {
            file_path: "/workspace/project-one/src/query.ts",
          },
        }),
        createdAt: "2026-04-08T08:00:00.000Z",
      },
      {
        id: "message_2",
        provider: "claude",
        category: "tool_result",
        content: "Some plain file contents without unified diff markers.",
        createdAt: "2026-04-08T08:00:01.000Z",
      },
    ];

    const files = aggregateTurnCombinedFiles(messages);

    expect(files).toEqual([]);
  });

  it("drops write artifacts that do not have a renderable diff", () => {
    const messages: TurnCombinedMessage[] = [
      {
        id: "message_1",
        provider: "claude",
        category: "tool_edit",
        content: "opaque write payload without replayable diff context",
        createdAt: "2026-04-08T08:00:00.000Z",
        toolEditFiles: [
          {
            filePath: "src/query.ts",
            previousFilePath: null,
            changeType: "update",
            unifiedDiff: null,
            addedLineCount: 0,
            removedLineCount: 0,
            exactness: "best_effort",
          },
        ],
      },
    ];

    expect(aggregateTurnCombinedFiles(messages)).toEqual([]);
  });
});
