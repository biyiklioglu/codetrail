import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CLAUDE_HOOK_EVENT_NAME_VALUES, type IpcResponse } from "@codetrail/core";

const CLAUDE_HOOK_MARKER = "CODETRAIL_CLAUDE_HOOK=1";

export type ClaudeHookState = IpcResponse<"watcher:getLiveStatus">["claudeHookState"];

type FileSnapshot = {
  exists: boolean;
  mtimeMs: number;
  size: number;
};

export function getClaudeSettingsPath(homeDir: string): string {
  return join(homeDir, ".claude", "settings.json");
}

export function getClaudeHookLogPath(userDataDir: string): string {
  return join(userDataDir, "live-status", "claude-hooks.jsonl");
}

export function buildClaudeManagedHookCommand(logPath: string): string {
  return `${CLAUDE_HOOK_MARKER} /bin/sh -lc 'if ! cat >> "$1" 2>/dev/null; then cat >/dev/null 2>&1 || true; fi; printf "\\n" >> "$1" 2>/dev/null || true; exit 0' sh ${shellQuote(logPath)}`;
}

export async function prepareClaudeHookLogForAppStart(logPath: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const rotatedPath = `${logPath}.1`;
  await unlink(rotatedPath).catch(() => undefined);
  await rename(logPath, rotatedPath).catch((error) => {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  });
}

export function inspectClaudeHookState(input: {
  homeDir: string;
  userDataDir: string;
}): ClaudeHookState {
  const settingsPath = getClaudeSettingsPath(input.homeDir);
  const logPath = getClaudeHookLogPath(input.userDataDir);
  try {
    let settings: Record<string, unknown> = {};
    try {
      const settingsText = readFileSync(settingsPath, "utf8");
      settings = asObject(JSON.parse(settingsText));
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
    const hooks = asObject(settings.hooks);
    const managedEventNames = CLAUDE_HOOK_EVENT_NAME_VALUES.filter((eventName) =>
      Array.isArray(hooks[eventName])
        ? hooks[eventName].some((entry) => entryHasManagedHookMarker(entry))
        : false,
    );
    return {
      settingsPath,
      logPath,
      installed: managedEventNames.length === CLAUDE_HOOK_EVENT_NAME_VALUES.length,
      managed: managedEventNames.length > 0,
      managedEventNames,
      missingEventNames: CLAUDE_HOOK_EVENT_NAME_VALUES.filter(
        (eventName) => !managedEventNames.includes(eventName),
      ),
      lastError: null,
    };
  } catch (error) {
    return {
      settingsPath,
      logPath,
      installed: false,
      managed: false,
      managedEventNames: [],
      missingEventNames: [...CLAUDE_HOOK_EVENT_NAME_VALUES],
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function updateClaudeSettingsJson(
  settingsPath: string,
  updater: (settings: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { settings, snapshot } = await readJsonFileWithSnapshot(settingsPath);
    const nextSettings = updater(structuredClone(settings));
    try {
      await writeJsonFileAtomicallyIfUnchanged(settingsPath, nextSettings, snapshot);
      return nextSettings;
    } catch (error) {
      if (!(error instanceof ConcurrentFileMutationError) || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }
  throw new Error("Failed to update Claude settings");
}

export function ensureRecord(
  target: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const existing = target[key];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  target[key] = created;
  return created;
}

export function entryHasManagedHookMarker(entry: unknown): boolean {
  const record = asObject(entry);
  const hooks = Array.isArray(record.hooks) ? record.hooks : [];
  return hooks.some((hook) => {
    const hookRecord = asObject(hook);
    const command = typeof hookRecord.command === "string" ? hookRecord.command : null;
    if (!command || hookRecord.type !== "command") {
      return false;
    }
    return command.includes(CLAUDE_HOOK_MARKER);
  });
}

export function entryHasExactManagedHookCommand(entry: unknown, exactCommand: string): boolean {
  const record = asObject(entry);
  const hooks = Array.isArray(record.hooks) ? record.hooks : [];
  return hooks.some((hook) => {
    const hookRecord = asObject(hook);
    return hookRecord.type === "command" && hookRecord.command === exactCommand;
  });
}

export function removeManagedHooksFromEntry(entry: unknown): Record<string, unknown> | null {
  const record = asObject(entry);
  const hooks = Array.isArray(record.hooks) ? record.hooks : [];
  const nextHooks = hooks.filter((hook) => !entryHasManagedHookMarker({ hooks: [hook] }));
  if (nextHooks.length === 0) {
    return null;
  }
  return {
    ...record,
    hooks: nextHooks,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readJsonFileWithSnapshot(filePath: string): Promise<{
  settings: Record<string, unknown>;
  snapshot: FileSnapshot;
}> {
  try {
    const initialStat = await stat(filePath);
    const text = await readFile(filePath, "utf8");
    const stableStat = await stat(filePath);
    if (!matchesFileSnapshot(stableStat, createFileSnapshot(initialStat))) {
      throw new ConcurrentFileMutationError(filePath);
    }
    return {
      settings: asObject(JSON.parse(text)),
      snapshot: createFileSnapshot(stableStat),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        settings: {},
        snapshot: { exists: false, mtimeMs: 0, size: 0 },
      };
    }
    throw error;
  }
}

async function writeJsonFileAtomicallyIfUnchanged(
  filePath: string,
  value: Record<string, unknown>,
  expectedSnapshot: FileSnapshot,
): Promise<void> {
  const currentStat = await safeStat(filePath);
  if (!matchesFileSnapshot(currentStat, expectedSnapshot)) {
    throw new ConcurrentFileMutationError(filePath);
  }
  await writeJsonFileAtomically(filePath, value);
}

function createFileSnapshot(fileStat: { mtimeMs: number; size: number }): FileSnapshot {
  return {
    exists: true,
    mtimeMs: Math.trunc(fileStat.mtimeMs),
    size: fileStat.size,
  };
}

function matchesFileSnapshot(
  fileStat: { mtimeMs: number; size: number } | null,
  snapshot: FileSnapshot,
): boolean {
  if (!snapshot.exists) {
    return fileStat === null;
  }
  if (!fileStat) {
    return false;
  }
  return Math.trunc(fileStat.mtimeMs) === snapshot.mtimeMs && fileStat.size === snapshot.size;
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function writeJsonFileAtomically(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  const directoryPath = dirname(filePath);
  const tempPath = join(
    directoryPath,
    `.${Math.random().toString(16).slice(2)}.${Date.now().toString(16)}.tmp`,
  );
  await mkdir(directoryPath, { recursive: true });
  let tempWritten = false;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    tempWritten = true;
    await rename(tempPath, filePath);
  } catch (error) {
    if (tempWritten) {
      await unlink(tempPath).catch(() => undefined);
    }
    throw error;
  }
}

class ConcurrentFileMutationError extends Error {
  constructor(filePath: string) {
    super(`File changed while updating: ${filePath}`);
  }
}
