import { describe, expect, it } from "vitest";

import {
  asNonEmptyString,
  asObject,
  asString,
  buildUnifiedDiffFromTextPair,
  parseToolEditPayload,
  parseToolInvocationPayload,
  tryParseJsonRecord,
} from "./toolParsing";

describe("toolParsing", () => {
  it("parses invocation payloads and maps pretty tool names", () => {
    const parsed = parseToolInvocationPayload(
      JSON.stringify({ tool_name: "apply_patch", input: { operation: "replace" } }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe("apply_patch");
    expect(parsed?.prettyName).toBe("Apply Patch");
    expect(parsed?.isWrite).toBe(true);
    expect(parsed?.inputRecord).toEqual({ operation: "replace" });
  });

  it("supports functionCall name fallback when explicit name is missing", () => {
    const parsed = parseToolInvocationPayload(
      JSON.stringify({ functionCall: { name: "run_command" }, arguments: { cmd: "ls" } }),
    );

    expect(parsed?.name).toBe("run_command");
    expect(parsed?.prettyName).toBe("Execute Command");
    expect(parsed?.isWrite).toBe(false);
  });

  it("parses edit payloads from structured before/after fields", () => {
    const payload = parseToolEditPayload(
      JSON.stringify({
        input: {
          path: "src/app.ts",
          old_string: "const a = 1;",
          new_string: "const a = 2;",
        },
      }),
    );

    expect(payload).toEqual({
      filePath: "src/app.ts",
      oldText: "const a = 1;",
      newText: "const a = 2;",
      diff: null,
      files: [
        {
          filePath: "src/app.ts",
          previousFilePath: null,
          changeType: "update",
          oldText: "const a = 1;",
          newText: "const a = 2;",
          diff: null,
        },
      ],
    });
  });

  it("parses OpenCode-native write and edit fields", () => {
    const payload = parseToolEditPayload(
      JSON.stringify({
        name: "write",
        input: {
          filePath: "src/opencode.ts",
          oldString: "const before = 1;\n",
          newString: "const after = 2;\n",
        },
      }),
    );

    expect(payload).toEqual({
      filePath: "src/opencode.ts",
      oldText: "const before = 1;\n",
      newText: "const after = 2;\n",
      diff: null,
      files: [
        {
          filePath: "src/opencode.ts",
          previousFilePath: null,
          changeType: "update",
          oldText: "const before = 1;\n",
          newText: "const after = 2;\n",
          diff: null,
        },
      ],
    });
  });

  it("converts apply_patch payloads into unified diff and extracts file path", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/parser.ts",
      "@@",
      "-const value = old();",
      "+const value = next();",
      "*** End Patch",
    ].join("\n");

    const payload = parseToolEditPayload(
      JSON.stringify({
        name: "apply_patch",
        input: patch,
      }),
    );

    expect(payload?.filePath).toBe("src/parser.ts");
    expect(payload?.diff).toContain("diff --git a/src/parser.ts b/src/parser.ts");
    expect(payload?.diff).toContain("-const value = old();");
    expect(payload?.diff).toContain("+const value = next();");
    expect(payload?.files).toEqual([
      {
        filePath: "src/parser.ts",
        previousFilePath: "src/parser.ts",
        changeType: "update",
        oldText: null,
        newText: null,
        diff: expect.stringContaining("diff --git a/src/parser.ts b/src/parser.ts"),
      },
    ]);
  });

  it("parses multi-file apply_patch payloads into per-file entries", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const created = true;",
      "*** Update File: src/parser.ts",
      "@@",
      "-const value = old();",
      "+const value = next();",
      "*** End Patch",
    ].join("\n");

    const payload = parseToolEditPayload(
      JSON.stringify({
        name: "apply_patch",
        input: patch,
      }),
    );

    expect(payload?.filePath).toBe("src/new.ts");
    expect(payload?.files).toHaveLength(2);
    expect(payload?.files[0]).toMatchObject({
      filePath: "src/new.ts",
      changeType: "add",
    });
    expect(payload?.files[1]).toMatchObject({
      filePath: "src/parser.ts",
      changeType: "update",
    });
    expect(payload?.diff).toContain("diff --git /dev/null b/src/new.ts");
    expect(payload?.diff).toContain("diff --git a/src/parser.ts b/src/parser.ts");
  });

  it("parses delete and move apply_patch entries into per-file diffs", () => {
    const patch = [
      "*** Begin Patch",
      "*** Delete File: src/obsolete.ts",
      "@@",
      "-export const obsolete = true;",
      "*** Update File: src/old-name.ts",
      "*** Move to: src/new-name.ts",
      "@@",
      "-export const before = oldName();",
      "+export const after = newName();",
      "*** End Patch",
    ].join("\n");

    const payload = parseToolEditPayload(
      JSON.stringify({
        name: "apply_patch",
        input: patch,
      }),
    );

    expect(payload?.files).toHaveLength(2);
    expect(payload?.files[0]).toMatchObject({
      filePath: "src/obsolete.ts",
      changeType: "delete",
    });
    expect(payload?.files[0]?.diff).toContain("diff --git a/src/obsolete.ts /dev/null");
    expect(payload?.files[1]).toMatchObject({
      filePath: "src/new-name.ts",
      changeType: "move",
      previousFilePath: "src/old-name.ts",
    });
    expect(payload?.files[1]?.diff).toContain("diff --git a/src/old-name.ts b/src/new-name.ts");
    expect(payload?.files[1]?.diff).toContain("+++ b/src/new-name.ts");
  });

  it("builds unified diff hunks from text pairs", () => {
    const diff = buildUnifiedDiffFromTextPair({
      oldText: "a\nb\nc",
      newText: "a\nb\nd",
      filePath: "src/file.ts",
    });

    expect(diff).toContain("--- a/src/file.ts");
    expect(diff).toContain("+++ b/src/file.ts");
    expect(diff).toContain("-c");
    expect(diff).toContain("+d");
  });

  it("returns placeholder hunk when no textual change exists", () => {
    const diff = buildUnifiedDiffFromTextPair({
      oldText: "same",
      newText: "same",
      filePath: null,
    });

    expect(diff).toContain("--- a/file");
    expect(diff).toContain("+++ b/file");
    expect(diff).toContain("@@ -1,0 +1,0 @@");
  });

  it("handles json parsing helpers and null fallbacks", () => {
    expect(tryParseJsonRecord("{")).toBeNull();
    expect(tryParseJsonRecord("[]")).toBeNull();
    expect(tryParseJsonRecord('{"ok":true}')).toEqual({ ok: true });

    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    expect(asObject(null)).toBeNull();
    expect(asString("x")).toBe("x");
    expect(asString(1)).toBeNull();
    expect(asNonEmptyString("  keep ")).toBe("keep");
    expect(asNonEmptyString("   ")).toBeNull();
  });
});
