import type {
  ProviderOversizedJsonlEventContext,
  ProviderOversizedJsonlEventResult,
} from "../types";

import {
  asProviderJsonArray,
  asProviderJsonObject,
  buildInlineMediaPlaceholder,
  collectSanitizedValue,
  estimateDecodedBase64Bytes,
  emptyOversizedSanitization,
  fromBase64Field,
  inferMediaKindFromMimeType,
  mergeOversizedSanitizations,
} from "./shared";

export function sanitizeClaudeOversizedJsonlEvent(
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

  const message = asProviderJsonObject(root.message);
  if (!message) {
    return {
      event,
      sanitization: null,
    };
  }

  const content = asProviderJsonArray(message.content);
  if (content.length === 0) {
    return {
      event,
      sanitization: null,
    };
  }

  let changed = false;
  let sanitization = emptyOversizedSanitization();
  const nextContent = content.map((block) => {
    const record = asProviderJsonObject(block);
    if (!record || record.type !== "image") {
      return block;
    }

    const source = asProviderJsonObject(record.source);
    const data = typeof source?.data === "string" ? source.data : null;
    if (!data) {
      return block;
    }

    changed = true;
    const mimeType = typeof source?.media_type === "string" ? source.media_type : null;
    const descriptor = fromBase64Field({
      mediaKind: inferMediaKindFromMimeType(mimeType),
      mimeType,
      encodedData: data,
    });
    const placeholder = buildInlineMediaPlaceholder({
      mediaKind: descriptor.mediaKind,
      mimeType: descriptor.mimeType,
      approxBytes: estimateDecodedBase64Bytes(descriptor.encodedData),
    });
    const transformed = collectSanitizedValue(
      {
        type: "text",
        text: placeholder,
      },
      descriptor,
      { transformedShape: true },
    );
    sanitization = mergeOversizedSanitizations(sanitization, transformed.sanitization)!;
    return transformed.value;
  });

  if (!changed) {
    return {
      event,
      sanitization: null,
    };
  }

  return {
    event: {
      ...root,
      message: {
        ...message,
        content: nextContent,
      },
    },
    sanitization,
  };
}
