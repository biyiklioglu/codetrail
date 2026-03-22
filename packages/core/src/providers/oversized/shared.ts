import type {
  ProviderJsonArray,
  ProviderJsonObject,
  ProviderJsonValue,
  ProviderOversizedJsonlSanitization,
} from "../types";

type InlineDataDescriptor = {
  mediaKind: string;
  mimeType: string | null;
  encodedData: string;
};

export type CollectedSanitizedValue = {
  value: ProviderJsonValue;
  sanitization: ProviderOversizedJsonlSanitization;
};

export function emptyOversizedSanitization(): ProviderOversizedJsonlSanitization {
  return {
    replacedFieldCount: 0,
    omittedBytes: 0,
    mediaKinds: [],
    transformedShape: false,
  };
}

export function mergeOversizedSanitizations(
  left: ProviderOversizedJsonlSanitization | null,
  right: ProviderOversizedJsonlSanitization | null,
): ProviderOversizedJsonlSanitization | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return {
    replacedFieldCount: left.replacedFieldCount + right.replacedFieldCount,
    omittedBytes: left.omittedBytes + right.omittedBytes,
    mediaKinds: dedupeStrings([...left.mediaKinds, ...right.mediaKinds]),
    transformedShape: left.transformedShape || right.transformedShape,
  };
}

export function buildInlineMediaPlaceholder(args: {
  mediaKind: string;
  mimeType: string | null;
  approxBytes: number | null;
}): string {
  const parts = [`${args.mediaKind} omitted`];
  if (args.mimeType) {
    parts.push(`mime=${args.mimeType}`);
  }
  if (
    typeof args.approxBytes === "number" &&
    Number.isFinite(args.approxBytes) &&
    args.approxBytes > 0
  ) {
    parts.push(`original_bytes=${args.approxBytes}`);
  }
  return `[${parts.join(" ")}]`;
}

export function summarizeOversizedSanitization(
  sanitization: ProviderOversizedJsonlSanitization | null,
): Record<string, unknown> | undefined {
  if (!sanitization || sanitization.replacedFieldCount <= 0) {
    return undefined;
  }

  return {
    replacedFieldCount: sanitization.replacedFieldCount,
    omittedBytes: sanitization.omittedBytes,
    mediaKinds: sanitization.mediaKinds,
    transformedShape: sanitization.transformedShape,
  };
}

export function collectSanitizedValue(
  value: ProviderJsonValue,
  descriptor: InlineDataDescriptor,
  options?: { transformedShape?: boolean },
): CollectedSanitizedValue {
  const approxBytes = estimateDecodedBase64Bytes(descriptor.encodedData);
  return {
    value,
    sanitization: {
      replacedFieldCount: 1,
      omittedBytes: approxBytes ?? 0,
      mediaKinds: [descriptor.mediaKind],
      transformedShape: options?.transformedShape ?? false,
    },
  };
}

export function appendOversizedSanitization(
  base: ProviderOversizedJsonlSanitization,
  next: ProviderOversizedJsonlSanitization | null,
): ProviderOversizedJsonlSanitization {
  if (!next) {
    return base;
  }
  return {
    replacedFieldCount: base.replacedFieldCount + next.replacedFieldCount,
    omittedBytes: base.omittedBytes + next.omittedBytes,
    mediaKinds: dedupeStrings([...base.mediaKinds, ...next.mediaKinds]),
    transformedShape: base.transformedShape || next.transformedShape,
  };
}

export function parseDataUrl(value: string): InlineDataDescriptor | null {
  if (!value.startsWith("data:")) {
    return null;
  }

  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }

  const metadata = value.slice(5, commaIndex);
  if (!metadata.includes(";base64")) {
    return null;
  }

  const mimeType = metadata.split(";")[0]?.trim() || null;
  return {
    mediaKind: inferMediaKindFromMimeType(mimeType),
    mimeType,
    encodedData: value.slice(commaIndex + 1),
  };
}

export function fromBase64Field(args: {
  mediaKind: string;
  mimeType: string | null;
  encodedData: string;
}): InlineDataDescriptor {
  return {
    mediaKind: args.mediaKind,
    mimeType: args.mimeType,
    encodedData: args.encodedData,
  };
}

export function estimateDecodedBase64Bytes(encoded: string): number | null {
  const normalized = encoded.replace(/\s+/g, "");
  if (normalized.length === 0) {
    return 0;
  }
  if (normalized.length % 4 !== 0) {
    return null;
  }

  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length / 4) * 3) - padding);
}

export function inferMediaKindFromMimeType(mimeType: string | null): string {
  if (!mimeType) {
    return "binary";
  }
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("image/")) {
    return "image";
  }
  if (normalized.startsWith("audio/")) {
    return "audio";
  }
  if (normalized.startsWith("video/")) {
    return "video";
  }
  return "binary";
}

export function asProviderJsonObject(value: unknown): ProviderJsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as ProviderJsonObject;
}

export function asProviderJsonArray(value: unknown): ProviderJsonArray {
  return Array.isArray(value) ? (value as ProviderJsonArray) : [];
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
