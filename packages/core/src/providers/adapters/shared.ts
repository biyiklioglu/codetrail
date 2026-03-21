import type {
  ProviderJsonObject,
  ProviderReadSourceResult,
  ProviderSourceMetadata,
  ProviderTimestampNormalizationResult,
  ReadFileText,
} from "../types";

export function readJsonlStreamSource(
  filePath: string,
  readFileText: ReadFileText,
): ProviderReadSourceResult | null {
  try {
    const lines = readFileText(filePath)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsedLines = lines
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter((entry) => entry !== null) as unknown[];

    return {
      payload: parsedLines as ProviderReadSourceResult["payload"],
    };
  } catch {
    return null;
  }
}

export function readMaterializedJsonSource(
  filePath: string,
  readFileText: ReadFileText,
): ProviderReadSourceResult | null {
  try {
    const parsed = JSON.parse(readFileText(filePath)) as ProviderJsonObject;
    return {
      payload: parsed,
    };
  } catch {
    return null;
  }
}

export function emptySourceMetadata(): ProviderSourceMetadata {
  return {
    models: [],
    gitBranch: null,
    cwd: null,
  };
}

export function sortModels(models: Set<string>): string[] {
  return [...models].sort();
}

export function defaultTimestampNormalization<T extends { createdAt: string }>(
  message: T,
  context: { fileMtimeMs: number; previousTimestampMs: number },
): ProviderTimestampNormalizationResult<T> {
  const fallbackBaseMs =
    Number.isFinite(context.fileMtimeMs) && context.fileMtimeMs > 0
      ? context.fileMtimeMs
      : Date.now();
  const createdAtMs = Date.parse(message.createdAt);
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
    return {
      message,
      previousTimestampMs: createdAtMs,
    };
  }

  return {
    message: {
      ...message,
      createdAt: new Date(fallbackBaseMs).toISOString(),
    },
    previousTimestampMs: context.previousTimestampMs,
  };
}

export function monotonicTimestampNormalization<T extends { createdAt: string }>(
  message: T,
  context: { fileMtimeMs: number; previousTimestampMs: number },
): ProviderTimestampNormalizationResult<T> {
  const fallbackBaseMs =
    Number.isFinite(context.fileMtimeMs) && context.fileMtimeMs > 0
      ? context.fileMtimeMs
      : Date.now();
  const parsedMs = Date.parse(message.createdAt);
  let nextMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : fallbackBaseMs;
  if (nextMs <= context.previousTimestampMs) {
    nextMs = context.previousTimestampMs + 1;
  }

  return {
    message: {
      ...message,
      createdAt: new Date(nextMs).toISOString(),
    },
    previousTimestampMs: nextMs,
  };
}
