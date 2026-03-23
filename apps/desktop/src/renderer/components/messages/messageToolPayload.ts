import type { MessageCategory } from "@codetrail/core/browser";

import {
  parseToolEditPayload,
  parseToolInvocationPayload,
  tryParseJsonRecord,
} from "./toolParsing";

export type ParsedMessageToolPayload = {
  toolInvocation: ReturnType<typeof parseToolInvocationPayload> | null;
  toolEdit: ReturnType<typeof parseToolEditPayload> | null;
  toolResult: ReturnType<typeof tryParseJsonRecord> | null;
};

export function parseMessageToolPayload(
  category: MessageCategory,
  text: string,
): ParsedMessageToolPayload {
  return {
    toolInvocation:
      category === "tool_use" || category === "tool_edit" ? parseToolInvocationPayload(text) : null,
    toolEdit:
      category === "tool_edit" || category === "tool_use" ? parseToolEditPayload(text) : null,
    toolResult: category === "tool_result" ? tryParseJsonRecord(text) : null,
  };
}
