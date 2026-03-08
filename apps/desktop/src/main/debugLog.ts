import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

export const DEBUG_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEBUG_LOG_MAX_ARCHIVES = 5;

export type DebugLogRetentionOptions = {
  maxBytes?: number;
  maxArchives?: number;
};

export function appendDebugLog(
  logPath: string,
  line: string,
  options: DebugLogRetentionOptions = {},
): void {
  const normalizedOptions = normalizeRetentionOptions(options);
  mkdirSync(dirname(logPath), { recursive: true });
  rotateDebugLogIfNeeded(logPath, Buffer.byteLength(line, "utf8"), normalizedOptions);
  appendFileSync(logPath, line, "utf8");
}

export function rotateDebugLogIfNeeded(
  logPath: string,
  incomingBytes: number,
  options: DebugLogRetentionOptions = {},
): boolean {
  const normalizedOptions = normalizeRetentionOptions(options);
  const currentSize = readFileSizeSafe(logPath);
  if (currentSize <= 0 || currentSize + incomingBytes <= normalizedOptions.maxBytes) {
    pruneExtraArchives(logPath, normalizedOptions.maxArchives);
    return false;
  }

  if (normalizedOptions.maxArchives <= 0) {
    rmSync(logPath, { force: true });
    return true;
  }

  const oldestArchivePath = `${logPath}.${normalizedOptions.maxArchives}`;
  rmSync(oldestArchivePath, { force: true });

  for (let index = normalizedOptions.maxArchives - 1; index >= 1; index -= 1) {
    const sourcePath = `${logPath}.${index}`;
    const destinationPath = `${logPath}.${index + 1}`;
    if (!existsSync(sourcePath)) {
      continue;
    }
    renameSync(sourcePath, destinationPath);
  }

  if (existsSync(logPath)) {
    renameSync(logPath, `${logPath}.1`);
  }
  pruneExtraArchives(logPath, normalizedOptions.maxArchives);
  return true;
}

function normalizeRetentionOptions(options: DebugLogRetentionOptions): {
  maxBytes: number;
  maxArchives: number;
} {
  return {
    maxBytes: options.maxBytes ?? DEBUG_LOG_MAX_BYTES,
    maxArchives: options.maxArchives ?? DEBUG_LOG_MAX_ARCHIVES,
  };
}

function readFileSizeSafe(logPath: string): number {
  try {
    return statSync(logPath).size;
  } catch {
    return 0;
  }
}

function pruneExtraArchives(logPath: string, maxArchives: number): void {
  let index = maxArchives + 1;
  while (existsSync(`${logPath}.${index}`)) {
    rmSync(`${logPath}.${index}`, { force: true });
    index += 1;
  }
}
