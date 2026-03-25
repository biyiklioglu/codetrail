import type {
  PrefetchedJsonlChunk,
  Provider,
  SystemMessageRegexRuleOverrides,
} from "@codetrail/core";

export type SharedIndexingRequestSettings = {
  enabledProviders?: Provider[];
  removeMissingSessionsDuringIncrementalIndexing?: boolean;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
};

type SharedIndexingRequestSettingsInput = {
  enabledProviders?: Provider[] | undefined;
  removeMissingSessionsDuringIncrementalIndexing?: boolean | undefined;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides | undefined;
};

export type IncrementalWorkerRequest = {
  kind: "incremental";
  dbPath: string;
  forceReindex: boolean;
} & SharedIndexingRequestSettings;

export type ChangedFilesWorkerRequest = {
  kind: "changedFiles";
  dbPath: string;
  changedFilePaths: string[];
  prefetchedJsonlChunks?: PrefetchedJsonlChunk[];
} & SharedIndexingRequestSettings;

export type IndexingWorkerRequest = IncrementalWorkerRequest | ChangedFilesWorkerRequest;

export function buildSharedIndexingRequestSettings(
  settings: SharedIndexingRequestSettingsInput,
): SharedIndexingRequestSettings {
  const next: SharedIndexingRequestSettings = {};
  if (settings.enabledProviders) {
    next.enabledProviders = settings.enabledProviders;
  }
  if (settings.removeMissingSessionsDuringIncrementalIndexing !== undefined) {
    next.removeMissingSessionsDuringIncrementalIndexing =
      settings.removeMissingSessionsDuringIncrementalIndexing;
  }
  if (settings.systemMessageRegexRules) {
    next.systemMessageRegexRules = settings.systemMessageRegexRules;
  }
  return next;
}

export function toIncrementalIndexingConfig(request: IncrementalWorkerRequest) {
  return {
    dbPath: request.dbPath,
    forceReindex: request.forceReindex,
    ...buildSharedIndexingRequestSettings(request),
  };
}

export function toChangedFilesIndexingConfig(request: ChangedFilesWorkerRequest) {
  return {
    dbPath: request.dbPath,
    ...buildSharedIndexingRequestSettings(request),
  };
}

export function normalizePrefetchedJsonlChunks(
  chunks: unknown,
): PrefetchedJsonlChunk[] | undefined {
  if (!Array.isArray(chunks)) {
    return undefined;
  }

  const normalized: PrefetchedJsonlChunk[] = [];
  for (const chunk of chunks) {
    const candidate = normalizePrefetchedJsonlChunk(chunk);
    if (candidate) {
      normalized.push(candidate);
    }
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePrefetchedJsonlChunk(chunk: unknown): PrefetchedJsonlChunk | null {
  if (!isRecord(chunk)) {
    return null;
  }

  const bytes = normalizePrefetchedBytes(chunk.bytes);
  if (
    typeof chunk.filePath !== "string" ||
    !Number.isFinite(chunk.fileSize) ||
    !Number.isFinite(chunk.fileMtimeMs) ||
    !Number.isFinite(chunk.startOffsetBytes) ||
    !bytes
  ) {
    return null;
  }

  const fileSize = Number(chunk.fileSize);
  const fileMtimeMs = Number(chunk.fileMtimeMs);
  const startOffsetBytes = Number(chunk.startOffsetBytes);

  return {
    filePath: chunk.filePath,
    fileSize,
    fileMtimeMs,
    startOffsetBytes,
    bytes,
  };
}

function normalizePrefetchedBytes(bytes: unknown): Uint8Array | null {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (Array.isArray(bytes) && bytes.every(isByteValue)) {
    return Uint8Array.from(bytes);
  }
  if (isRecord(bytes) && bytes.type === "Buffer" && Array.isArray(bytes.data)) {
    return bytes.data.every(isByteValue) ? Uint8Array.from(bytes.data) : null;
  }
  if (isRecord(bytes)) {
    const numericKeys = Object.keys(bytes).filter((key) => /^\d+$/.test(key));
    if (numericKeys.length === 0) {
      return null;
    }
    numericKeys.sort((left, right) => Number(left) - Number(right));
    const values: number[] = [];
    for (let index = 0; index < numericKeys.length; index += 1) {
      const expectedKey = String(index);
      if (numericKeys[index] !== expectedKey) {
        return null;
      }
      const value = bytes[expectedKey];
      if (!isByteValue(value)) {
        return null;
      }
      values.push(value);
    }
    return Uint8Array.from(values);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isByteValue(value: unknown): value is number {
  if (!Number.isInteger(value)) {
    return false;
  }
  const byte = Number(value);
  return byte >= 0 && byte <= 255;
}
