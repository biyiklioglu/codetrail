import { describe, expect, it } from "vitest";

import { sanitizeClaudeOversizedJsonlEvent } from "./claude";
import { extractCodetrailCompactedSnapshotText, sanitizeCodexOversizedJsonlEvent } from "./codex";
import { estimateDecodedBase64Bytes } from "./shared";

describe("oversized transcript sanitizers", () => {
  it("replaces Claude inline image blocks with text placeholders", () => {
    const base64 = Buffer.from("hello-image").toString("base64");
    const result = sanitizeClaudeOversizedJsonlEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "before" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: base64,
            },
          },
          { type: "text", text: "after" },
        ],
      },
    }, {
      lineBytes: 9,
      primaryByteLimit: 8,
      rescueByteLimit: 32,
    });

    expect(result.sanitization?.replacedFieldCount).toBe(1);
    expect(result.sanitization?.omittedBytes).toBe(Buffer.byteLength("hello-image"));
    expect(result.event).toMatchObject({
      message: {
        content: [
          { type: "text", text: "before" },
          {
            type: "text",
            text: "[image omitted mime=image/png original_bytes=11]",
          },
          { type: "text", text: "after" },
        ],
      },
    });
  });

  it("leaves Claude events without inline media unchanged", () => {
    const event = {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "before" },
          { type: "text", text: "after" },
        ],
      },
    };

    const result = sanitizeClaudeOversizedJsonlEvent(event, {
      lineBytes: 9,
      primaryByteLimit: 8,
      rescueByteLimit: 32,
    });

    expect(result.sanitization).toBeNull();
    expect(result.event).toEqual(event);
  });

  it("turns rescued Codex compacted history into a searchable synthetic snapshot", () => {
    const base64 = Buffer.from("codex-image").toString("base64");
    const result = sanitizeCodexOversizedJsonlEvent({
      timestamp: "2026-03-21T10:00:00Z",
      type: "compacted",
      payload: {
        replacement_history: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "before" },
              { type: "input_image", image_url: `data:image/png;base64,${base64}` },
              { type: "input_text", text: "after" },
            ],
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "done" }],
          },
        ],
      },
    }, {
      lineBytes: 9,
      primaryByteLimit: 8,
      rescueByteLimit: 32,
    });

    expect(result.sanitization?.replacedFieldCount).toBe(1);
    expect(result.sanitization?.transformedShape).toBe(true);
    expect(result.event).toMatchObject({
      kind: "codetrail_compacted_history",
      timestamp: "2026-03-21T10:00:00Z",
    });
    expect(extractCodetrailCompactedSnapshotText(result.event)).toContain("User:\nbefore");
    expect(extractCodetrailCompactedSnapshotText(result.event)).toContain(
      "[image omitted mime=image/png original_bytes=11]",
    );
    expect(extractCodetrailCompactedSnapshotText(result.event)).toContain("Assistant:\ndone");
  });

  it("leaves Codex events without inline media unchanged", () => {
    const event = {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "plain text only" }],
      },
    };

    const result = sanitizeCodexOversizedJsonlEvent(event, {
      lineBytes: 9,
      primaryByteLimit: 8,
      rescueByteLimit: 32,
    });

    expect(result.sanitization).toBeNull();
    expect(result.event).toEqual(event);
  });

  it("leaves Codex compacted events unchanged when they contain no message entries", () => {
    const event = {
      timestamp: "2026-03-21T10:00:00Z",
      type: "compacted",
      payload: {
        replacement_history: [{ type: "compaction", encrypted_content: "..." }],
      },
    };

    const result = sanitizeCodexOversizedJsonlEvent(event, {
      lineBytes: 9,
      primaryByteLimit: 8,
      rescueByteLimit: 32,
    });

    expect(result.sanitization).toBeNull();
    expect(result.event).toEqual(event);
  });

  it("returns null byte estimates for malformed base64 input", () => {
    expect(estimateDecodedBase64Bytes("abc")).toBeNull();
  });
});
