import { mkdir, open, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CLAUDE_HOOK_EVENT_NAME_VALUES,
  type DiscoveryConfig,
  type IpcResponse,
  type LiveSessionState,
  type PrefetchedJsonlChunk,
  applyClaudeHookLine,
  applyClaudeTranscriptLine,
  applyCodexLiveLine,
  createInitialLiveSessionState,
  discoverSingleFile,
  readClaudeHookTranscriptPath,
} from "@codetrail/core";

import type { QueryService } from "./data/queryService";
import {
  type FileWatcherBatch,
  type FileWatcherOptions,
  FileWatcherService,
} from "./fileWatcherService";
import {
  type ClaudeHookState,
  buildClaudeManagedHookCommand,
  ensureRecord,
  entryHasExactManagedHookCommand,
  getClaudeHookLogPath,
  getClaudeSettingsPath,
  inspectClaudeHookState,
  prepareClaudeHookLogForAppStart,
  removeManagedHooksFromEntry,
  updateClaudeSettingsJson,
} from "./live/claudeHookSettings";
import { buildLiveStatusSnapshot, pruneStaleSessionCursors } from "./live/liveSnapshot";

const STARTUP_SEED_WINDOW_MS = 90_000;
const STARTUP_SEED_LIMIT = 24;
const INITIAL_TAIL_BYTES = 32 * 1024;
const MAX_READ_BYTES = 64 * 1024;
const IDLE_TIMEOUT_MS = 120_000;
const PRUNE_AFTER_MS = 180_000;
const HOOK_WATCH_DEBOUNCE_MS = 250;

type FileCursorState = {
  filePath: string;
  offset: number;
  lastSize: number;
  lastMtimeMs: number;
  partialLineBuffer: string;
  session: LiveSessionState;
};

export type LiveSessionStoreOptions = {
  queryService: Pick<QueryService, "listRecentLiveSessionFiles">;
  userDataDir: string;
  homeDir: string;
  now?: () => number;
  onBackgroundError?: (message: string, error: unknown, details?: Record<string, unknown>) => void;
  createFileWatcher?: (
    roots: string[],
    onFilesChanged: (batch: FileWatcherBatch) => void | Promise<void>,
    options?: FileWatcherOptions,
  ) => FileWatcherService;
};

export class LiveSessionStore {
  private readonly queryService: Pick<QueryService, "listRecentLiveSessionFiles">;
  private readonly userDataDir: string;
  private readonly homeDir: string;
  private readonly now: () => number;
  private readonly onBackgroundError:
    | ((message: string, error: unknown, details?: Record<string, unknown>) => void)
    | undefined;
  private readonly createFileWatcher: NonNullable<LiveSessionStoreOptions["createFileWatcher"]>;

  private enabled = false;
  private discoveryConfig: DiscoveryConfig | null = null;
  private readonly sessionCursors = new Map<string, FileCursorState>();
  private readonly hookCursor = {
    offset: 0,
    lastSize: 0,
    lastMtimeMs: 0,
    partialLineBuffer: "",
  };
  private hookWatcher: FileWatcherService | null = null;
  private claudeHookState: ClaudeHookState;
  private snapshotCache: IpcResponse<"watcher:getLiveStatus"> | null = null;
  private snapshotCacheExpiresAtMs = 0;
  private snapshotDirty = true;
  private revision = 0;
  private hookLogPreparedForAppStart = false;
  private readonly indexingPrefetchByFilePath = new Map<string, PrefetchedJsonlChunk>();

  constructor(options: LiveSessionStoreOptions) {
    this.queryService = options.queryService;
    this.userDataDir = options.userDataDir;
    this.homeDir = options.homeDir;
    this.now = options.now ?? (() => Date.now());
    this.onBackgroundError = options.onBackgroundError;
    this.createFileWatcher =
      options.createFileWatcher ??
      ((roots, onFilesChanged, watcherOptions) =>
        new FileWatcherService(roots, onFilesChanged, watcherOptions));
    this.claudeHookState = this.inspectClaudeHookState();
  }

  async start(input: { discoveryConfig: DiscoveryConfig }): Promise<void> {
    this.enabled = true;
    this.discoveryConfig = input.discoveryConfig;
    this.sessionCursors.clear();
    this.resetHookCursor();
    this.invalidateSnapshotCache();
    this.claudeHookState = this.inspectClaudeHookState();
    await this.refreshClaudeHookWatcher();
    await this.seedRecentSessions();
  }

  async prepareClaudeHookLogForAppStart(): Promise<void> {
    if (this.hookLogPreparedForAppStart) {
      return;
    }
    await prepareClaudeHookLogForAppStart(this.getClaudeHookLogPath());
    this.resetHookCursor();
    this.hookLogPreparedForAppStart = true;
  }

  async stop(): Promise<void> {
    this.enabled = false;
    this.sessionCursors.clear();
    this.indexingPrefetchByFilePath.clear();
    this.invalidateSnapshotCache();
    await this.stopHookWatcher();
  }

  takeIndexingPrefetchedJsonlChunks(changedPaths: string[]): PrefetchedJsonlChunk[] {
    const chunks: PrefetchedJsonlChunk[] = [];
    for (const changedPath of changedPaths) {
      const chunk = this.indexingPrefetchByFilePath.get(changedPath);
      if (!chunk) {
        continue;
      }
      this.indexingPrefetchByFilePath.delete(changedPath);
      chunks.push(chunk);
    }
    return chunks;
  }

  async handleWatcherBatch(batch: FileWatcherBatch): Promise<void> {
    if (!this.enabled || !this.discoveryConfig) {
      return;
    }

    const changedPaths = [...new Set(batch.changedPaths)];
    const results = await Promise.allSettled(
      changedPaths.map((changedPath) => this.processTranscriptPath(changedPath)),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.reportBackgroundError("Failed processing live transcript update", result.reason, {
          filePath: changedPaths[index],
        });
      }
    });
  }

  async installClaudeHooks(): Promise<ClaudeHookState> {
    const settingsPath = this.getClaudeSettingsPath();
    const logPath = this.getClaudeHookLogPath();
    const managedCommand = buildClaudeManagedHookCommand(logPath);
    await this.updateClaudeSettingsJson(settingsPath, (settings) => {
      const hooksRecord = ensureRecord(settings, "hooks");

      for (const eventName of CLAUDE_HOOK_EVENT_NAME_VALUES) {
        const currentEntries = Array.isArray(hooksRecord[eventName]) ? hooksRecord[eventName] : [];
        const alreadyInstalled = currentEntries.some((entry) =>
          entryHasExactManagedHookCommand(entry, managedCommand),
        );
        if (alreadyInstalled) {
          hooksRecord[eventName] = currentEntries;
          continue;
        }
        hooksRecord[eventName] = [
          ...currentEntries,
          {
            hooks: [
              {
                type: "command",
                command: managedCommand,
                async: true,
              },
            ],
          },
        ];
      }
      return settings;
    });

    await mkdir(dirname(logPath), { recursive: true });
    this.claudeHookState = this.inspectClaudeHookState();
    this.invalidateSnapshotCache();
    await this.refreshClaudeHookWatcher();
    return this.claudeHookState;
  }

  async removeClaudeHooks(): Promise<ClaudeHookState> {
    const settingsPath = this.getClaudeSettingsPath();
    await this.updateClaudeSettingsJson(settingsPath, (settings) => {
      const hooksRecord = ensureRecord(settings, "hooks");

      for (const eventName of Object.keys(hooksRecord)) {
        const currentEntries = Array.isArray(hooksRecord[eventName]) ? hooksRecord[eventName] : [];
        const nextEntries = currentEntries
          .map((entry) => removeManagedHooksFromEntry(entry))
          .filter((entry) => entry !== null);
        if (nextEntries.length === 0) {
          delete hooksRecord[eventName];
          continue;
        }
        hooksRecord[eventName] = nextEntries;
      }
      return settings;
    });
    this.claudeHookState = this.inspectClaudeHookState();
    this.invalidateSnapshotCache();
    await this.refreshClaudeHookWatcher();
    return this.claudeHookState;
  }

  async refreshClaudeHookWatcher(): Promise<void> {
    this.claudeHookState = this.inspectClaudeHookState();
    this.invalidateSnapshotCache();
    if (!this.enabled || !this.claudeHookState.installed) {
      await this.stopHookWatcher();
      return;
    }

    if (this.hookWatcher) {
      return;
    }

    await mkdir(dirname(this.claudeHookState.logPath), { recursive: true });
    const watcher = this.createFileWatcher(
      [dirname(this.claudeHookState.logPath)],
      async (batch) => {
        const changedPaths = [...new Set(batch.changedPaths)];
        for (const changedPath of changedPaths) {
          if (changedPath === this.claudeHookState.logPath) {
            try {
              await this.processClaudeHookLogFile(changedPath);
            } catch (error) {
              this.reportBackgroundError("Failed processing Claude hook log update", error, {
                filePath: changedPath,
              });
            }
            break;
          }
        }
      },
      {
        debounceMs: HOOK_WATCH_DEBOUNCE_MS,
      },
    );
    await watcher.start();
    this.hookWatcher = watcher;
  }

  snapshot(): IpcResponse<"watcher:getLiveStatus"> {
    const nowMs = this.now();
    if (this.snapshotCache && !this.snapshotDirty && nowMs < this.snapshotCacheExpiresAtMs) {
      return this.snapshotCache;
    }
    const prunedAnySessions = pruneStaleSessionCursors(this.sessionCursors, nowMs, PRUNE_AFTER_MS);
    const previousSnapshot = this.snapshotCache;
    const nextSnapshotState = buildLiveStatusSnapshot({
      enabled: this.enabled,
      nowMs,
      sessionCursors: this.sessionCursors,
      claudeHookState: this.claudeHookState,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      pruneAfterMs: PRUNE_AFTER_MS,
      previousSnapshot,
      previousRevision: this.revision,
    });
    if (prunedAnySessions || nextSnapshotState.revision !== this.revision) {
      this.revision = nextSnapshotState.revision;
    }
    this.snapshotCache = nextSnapshotState.snapshot;
    this.snapshotDirty = false;
    this.snapshotCacheExpiresAtMs = nextSnapshotState.expiresAtMs;
    return nextSnapshotState.snapshot;
  }

  private async seedRecentSessions(): Promise<void> {
    if (!this.discoveryConfig) {
      return;
    }

    const providers = this.discoveryConfig.enabledProviders?.filter(
      (provider) => provider === "claude" || provider === "codex",
    ) ?? ["claude", "codex"];
    const cutoffMs = this.now() - STARTUP_SEED_WINDOW_MS;
    const candidates = this.queryService.listRecentLiveSessionFiles({
      providers,
      minFileMtimeMs: cutoffMs,
      limit: STARTUP_SEED_LIMIT,
    });

    const candidatePaths = [...new Set(candidates.map((candidate) => candidate.filePath))];
    await Promise.all(
      candidatePaths.map((filePath) =>
        this.processTranscriptPath(filePath, {
          initialTailBytes: INITIAL_TAIL_BYTES,
        }),
      ),
    );
  }

  private async processTranscriptPath(
    filePath: string,
    options: { initialTailBytes?: number } = {},
  ): Promise<void> {
    if (!this.discoveryConfig) {
      return;
    }

    const discovered = discoverSingleFile(filePath, this.discoveryConfig);
    if (!discovered || (discovered.provider !== "claude" && discovered.provider !== "codex")) {
      return;
    }

    const fileStat = await safeStat(filePath);
    if (!fileStat?.isFile()) {
      if (this.sessionCursors.delete(filePath)) {
        this.invalidateSnapshotCache();
      }
      return;
    }

    const cursor = this.ensureCursor(discovered.filePath, discovered);
    const previousOffset = cursor.offset;
    let readFrom = cursor.offset;
    let ignoreLeadingPartialLine = false;

    if (
      options.initialTailBytes &&
      cursor.offset === 0 &&
      fileStat.size > options.initialTailBytes
    ) {
      readFrom = fileStat.size - options.initialTailBytes;
      ignoreLeadingPartialLine = true;
      cursor.session.bestEffort = true;
      cursor.partialLineBuffer = "";
    } else if (fileStat.size < cursor.offset) {
      readFrom = Math.max(0, fileStat.size - INITIAL_TAIL_BYTES);
      ignoreLeadingPartialLine = readFrom > 0;
      cursor.offset = readFrom;
      cursor.lastSize = fileStat.size;
      cursor.partialLineBuffer = "";
      cursor.session.bestEffort = true;
    }

    let bytesToRead = fileStat.size - readFrom;
    if (bytesToRead <= 0) {
      cursor.lastMtimeMs = Math.trunc(fileStat.mtimeMs);
      cursor.lastSize = fileStat.size;
      this.indexingPrefetchByFilePath.delete(filePath);
      return;
    }

    if (bytesToRead > MAX_READ_BYTES) {
      readFrom = fileStat.size - MAX_READ_BYTES;
      bytesToRead = MAX_READ_BYTES;
      ignoreLeadingPartialLine = true;
      cursor.partialLineBuffer = "";
      cursor.session.bestEffort = true;
    }

    const buffer = await readBufferRange(filePath, readFrom, bytesToRead);
    const text = buffer.toString("utf8");
    if (!ignoreLeadingPartialLine && readFrom === previousOffset) {
      this.indexingPrefetchByFilePath.set(filePath, {
        filePath,
        fileSize: fileStat.size,
        fileMtimeMs: Math.trunc(fileStat.mtimeMs),
        startOffsetBytes: readFrom,
        bytes: new Uint8Array(buffer),
      });
    } else {
      this.indexingPrefetchByFilePath.delete(filePath);
    }
    const completeLines = splitJsonLines({
      text,
      previousPartialLine: cursor.partialLineBuffer,
      ignoreLeadingPartialLine,
    });

    for (const line of completeLines.lines) {
      if (discovered.provider === "codex") {
        cursor.session = applyCodexLiveLine(cursor.session, line, this.now());
      } else {
        cursor.session = applyClaudeTranscriptLine(cursor.session, line, this.now());
      }
    }

    if (readFrom !== previousOffset) {
      cursor.session.bestEffort = true;
    }
    cursor.offset = fileStat.size;
    cursor.lastSize = fileStat.size;
    cursor.lastMtimeMs = Math.trunc(fileStat.mtimeMs);
    cursor.partialLineBuffer = completeLines.partialLineBuffer;
    this.invalidateSnapshotCache();
  }

  private async processClaudeHookLogFile(filePath: string): Promise<void> {
    const fileStat = await safeStat(filePath);
    if (!fileStat?.isFile()) {
      this.resetHookCursor();
      return;
    }

    let readFrom = this.hookCursor.offset;
    let ignoreLeadingPartialLine = false;
    if (fileStat.size < this.hookCursor.offset) {
      readFrom = Math.max(0, fileStat.size - INITIAL_TAIL_BYTES);
      ignoreLeadingPartialLine = readFrom > 0;
      this.hookCursor.partialLineBuffer = "";
    }

    const bytesToRead = fileStat.size - readFrom;
    if (bytesToRead <= 0) {
      this.hookCursor.lastMtimeMs = Math.trunc(fileStat.mtimeMs);
      this.hookCursor.lastSize = fileStat.size;
      return;
    }

    const text = await readTextRange(filePath, readFrom, Math.min(bytesToRead, MAX_READ_BYTES));
    const completeLines = splitJsonLines({
      text,
      previousPartialLine: this.hookCursor.partialLineBuffer,
      ignoreLeadingPartialLine,
    });

    for (const line of completeLines.lines) {
      const transcriptPath = readClaudeHookTranscriptPath(line);
      if (!transcriptPath || !this.discoveryConfig) {
        continue;
      }
      const discovered = discoverSingleFile(transcriptPath, this.discoveryConfig);
      if (!discovered || discovered.provider !== "claude") {
        continue;
      }
      const cursor = this.ensureCursor(discovered.filePath, discovered);
      cursor.session = applyClaudeHookLine(cursor.session, line, this.now());
    }

    this.hookCursor.offset = fileStat.size;
    this.hookCursor.lastSize = fileStat.size;
    this.hookCursor.lastMtimeMs = Math.trunc(fileStat.mtimeMs);
    this.hookCursor.partialLineBuffer = completeLines.partialLineBuffer;
    this.invalidateSnapshotCache();
  }

  private ensureCursor(
    filePath: string,
    discovered: NonNullable<ReturnType<typeof discoverSingleFile>>,
  ): FileCursorState {
    const current = this.sessionCursors.get(filePath);
    if (current) {
      current.session.projectName = discovered.projectName || null;
      current.session.projectPath = discovered.projectPath || null;
      current.session.cwd = discovered.metadata.cwd ?? current.session.cwd;
      return current;
    }

    const next: FileCursorState = {
      filePath,
      offset: 0,
      lastSize: 0,
      lastMtimeMs: 0,
      partialLineBuffer: "",
      session: createInitialLiveSessionState({
        provider: discovered.provider,
        filePath: discovered.filePath,
        sessionIdentity: discovered.sessionIdentity,
        sourceSessionId: discovered.sourceSessionId,
        projectName: discovered.projectName || null,
        projectPath: discovered.projectPath || null,
        cwd: discovered.metadata.cwd ?? null,
      }),
    };
    this.sessionCursors.set(filePath, next);
    return next;
  }

  private inspectClaudeHookState(): ClaudeHookState {
    return inspectClaudeHookState({
      homeDir: this.homeDir,
      userDataDir: this.userDataDir,
    });
  }

  private async updateClaudeSettingsJson(
    settingsPath: string,
    updater: (settings: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return updateClaudeSettingsJson(settingsPath, updater);
  }

  private async stopHookWatcher(): Promise<void> {
    if (!this.hookWatcher) {
      return;
    }
    await this.hookWatcher.stop();
    this.hookWatcher = null;
    this.resetHookCursor();
  }

  private resetHookCursor(): void {
    this.hookCursor.offset = 0;
    this.hookCursor.lastSize = 0;
    this.hookCursor.lastMtimeMs = 0;
    this.hookCursor.partialLineBuffer = "";
  }

  private invalidateSnapshotCache(): void {
    this.snapshotDirty = true;
    this.snapshotCacheExpiresAtMs = 0;
  }

  private getClaudeSettingsPath(): string {
    return getClaudeSettingsPath(this.homeDir);
  }

  private getClaudeHookLogPath(): string {
    return getClaudeHookLogPath(this.userDataDir);
  }

  private reportBackgroundError(
    message: string,
    error: unknown,
    details?: Record<string, unknown>,
  ): void {
    if (this.onBackgroundError) {
      this.onBackgroundError(message, error, details);
      return;
    }
    console.error(`[codetrail] ${message}`, error, details);
  }
}

async function readBufferRange(filePath: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readTextRange(filePath: string, start: number, length: number): Promise<string> {
  const buffer = await readBufferRange(filePath, start, length);
  return buffer.toString("utf8");
}

function splitJsonLines(input: {
  text: string;
  previousPartialLine: string;
  ignoreLeadingPartialLine: boolean;
}): {
  lines: string[];
  partialLineBuffer: string;
} {
  const combined = `${input.previousPartialLine}${input.text}`;
  const normalized = combined.replaceAll("\r\n", "\n");
  const parts = normalized.split("\n");
  const partialLineBuffer = normalized.endsWith("\n") ? "" : (parts.pop() ?? "");
  let lines = parts.map((line) => line.trim()).filter((line) => line.length > 0);
  if (input.ignoreLeadingPartialLine && !input.previousPartialLine) {
    lines = lines.slice(1);
  }
  return {
    lines,
    partialLineBuffer,
  };
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}
