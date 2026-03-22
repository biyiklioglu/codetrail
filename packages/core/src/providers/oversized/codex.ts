import type { ProviderJsonArray, ProviderJsonObject, ProviderJsonValue } from "../types";
import type {
  ProviderOversizedJsonlEventContext,
  ProviderOversizedJsonlEventResult,
} from "../types";

import {
  appendOversizedSanitization,
  asProviderJsonArray,
  asProviderJsonObject,
  buildInlineMediaPlaceholder,
  collectSanitizedValue,
  emptyOversizedSanitization,
  estimateDecodedBase64Bytes,
  parseDataUrl,
} from "./shared";

type CodexHistoryEntry = {
  role: string;
  text: string;
};

const CODETRAIL_COMPACTED_EVENT_KIND = "codetrail_compacted_history";

export function sanitizeCodexOversizedJsonlEvent(
  event: unknown,
  _context: ProviderOversizedJsonlEventContext,
): ProviderOversizedJsonlEventResult {
  const root = asProviderJsonObject(event);
  if (!root) {
    return {
      event,
      sanitization: null,
    };
  }

  if (root.type === "compacted") {
    return sanitizeCodexCompactedEvent(root);
  }

  const payload = asProviderJsonObject(root.payload);
  if (!payload) {
    return {
      event,
      sanitization: null,
    };
  }

  const transformed = sanitizeCodexContentArray(payload.content);
  if (!transformed.changed) {
    return {
      event,
      sanitization: null,
    };
  }

  return {
    event: {
      ...root,
      payload: {
        ...payload,
        content: transformed.content,
      },
    },
    sanitization: transformed.sanitization,
  };
}

export function isCodetrailCompactedSnapshotEvent(event: unknown): boolean {
  const record = asProviderJsonObject(event);
  return record?.kind === CODETRAIL_COMPACTED_EVENT_KIND;
}

export function extractCodetrailCompactedSnapshotText(event: unknown): string {
  const record = asProviderJsonObject(event);
  return typeof record?.content === "string" ? record.content : "";
}

function sanitizeCodexCompactedEvent(root: ProviderJsonObject): ProviderOversizedJsonlEventResult {
  const payload = asProviderJsonObject(root.payload);
  const replacementHistory = asProviderJsonArray(payload?.replacement_history);
  if (replacementHistory.length === 0) {
    return {
      event: root,
      sanitization: null,
    };
  }

  let sanitization = emptyOversizedSanitization();
  const historyEntries: CodexHistoryEntry[] = [];
  let changed = false;

  for (const item of replacementHistory) {
    const record = asProviderJsonObject(item);
    if (!record || record.type !== "message") {
      continue;
    }

    const role = typeof record.role === "string" ? record.role : "system";
    const transformed = sanitizeCodexContentArray(record.content);
    if (transformed.changed) {
      changed = true;
    }
    sanitization = appendOversizedSanitization(sanitization, transformed.sanitization);
    const text = extractCodexTextParts(transformed.content).join("\n").trim();
    if (text.length > 0) {
      historyEntries.push({ role, text });
    }
  }

  if (!changed) {
    return {
      event: root,
      sanitization: null,
    };
  }

  return {
    event: {
      timestamp: root.timestamp,
      kind: CODETRAIL_COMPACTED_EVENT_KIND,
      content: buildCompactedSnapshotText(historyEntries),
    },
    sanitization: {
      ...sanitization,
      transformedShape: true,
    },
  };
}

function sanitizeCodexContentArray(value: unknown): {
  changed: boolean;
  content: ProviderJsonArray;
  sanitization: ReturnType<typeof emptyOversizedSanitization>;
} {
  const content = asProviderJsonArray(value);
  if (content.length === 0) {
    return {
      changed: false,
      content,
      sanitization: emptyOversizedSanitization(),
    };
  }

  let changed = false;
  let sanitization = emptyOversizedSanitization();
  const nextContent = content.map((block) => {
    const transformed = sanitizeCodexContentBlock(block);
    if (transformed.changed) {
      changed = true;
    }
    sanitization = appendOversizedSanitization(sanitization, transformed.sanitization);
    return transformed.value;
  });

  return {
    changed,
    content: nextContent,
    sanitization,
  };
}

function sanitizeCodexContentBlock(value: ProviderJsonValue): {
  changed: boolean;
  value: ProviderJsonValue;
  sanitization: ReturnType<typeof emptyOversizedSanitization>;
} {
  const record = asProviderJsonObject(value);
  if (!record || record.type !== "input_image" || typeof record.image_url !== "string") {
    return {
      changed: false,
      value,
      sanitization: emptyOversizedSanitization(),
    };
  }

  const descriptor = parseDataUrl(record.image_url);
  if (!descriptor) {
    return {
      changed: false,
      value,
      sanitization: emptyOversizedSanitization(),
    };
  }

  const transformed = collectSanitizedValue(
    {
      type: "input_text",
      text: buildInlineMediaPlaceholder({
        mediaKind: descriptor.mediaKind,
        mimeType: descriptor.mimeType,
        approxBytes: estimateDecodedBase64Bytes(descriptor.encodedData),
      }),
    },
    descriptor,
    { transformedShape: true },
  );

  return {
    changed: true,
    value: transformed.value,
    sanitization: transformed.sanitization,
  };
}

function extractCodexTextParts(value: unknown): string[] {
  return asProviderJsonArray(value).flatMap((block) => {
    const record = asProviderJsonObject(block);
    const text = typeof record?.text === "string" ? record.text : null;
    return text && text.length > 0 ? [text] : [];
  });
}

function buildCompactedSnapshotText(entries: CodexHistoryEntry[]): string {
  if (entries.length === 0) {
    return "[Codex compacted history snapshot omitted inline media payloads.]";
  }

  const body = entries.map((entry) => `${capitalize(entry.role)}:\n${entry.text}`).join("\n\n");
  return `[Codex compacted history snapshot]\n\n${body}`;
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}
