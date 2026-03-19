import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import { BrowserWindow, app, ipcMain, shell } from "electron";

import {
  DATABASE_SCHEMA_VERSION,
  DEFAULT_DISCOVERY_CONFIG,
  type IndexingFileIssue,
  type IndexingNotice,
  type IpcResponse,
  PROVIDER_LIST,
  type Provider,
  indexerConfigBaseSchema,
  initializeDatabase,
  listDiscoverySettingsPaths,
  listDiscoveryWatchRoots,
  paneStateBaseSchema,
  resolveEnabledProviders,
  resolveSystemMessageRegexRules,
} from "@codetrail/core";

import { HISTORY_EXPORT_PROGRESS_CHANNEL } from "../shared/historyExport";
import type { AppStateStore } from "./appStateStore";
import { initializeBookmarkStore, resolveBookmarksDbPath } from "./data/bookmarkStore";
import { type QueryService, createQueryService } from "./data/queryService";
import {
  type FileWatcherBatch,
  type FileWatcherOptions,
  FileWatcherService,
} from "./fileWatcherService";
import { exportHistoryMessages } from "./historyExport";
import { WorkerIndexingRunner } from "./indexingRunner";
import { registerIpcHandlers } from "./ipc";
import { WatchStatsStore } from "./watchStatsStore";

const MIN_ZOOM_PERCENT = 60;
const MAX_ZOOM_PERCENT = 175;
const DEFAULT_ZOOM_PERCENT = 100;
const ZOOM_STEP_PERCENT = 10;

export type BootstrapOptions = {
  dbPath?: string;
  runStartupIndexing?: boolean;
  appStateStore?: AppStateStore;
  onIndexingFileIssue?: (issue: IndexingFileIssue) => void;
  onIndexingNotice?: (notice: IndexingNotice) => void;
  onBackgroundError?: (message: string, error: unknown, details?: Record<string, unknown>) => void;
};

export type BootstrapResult = {
  schemaVersion: number;
  tableCount: number;
};

// The main process owns long-lived resources: databases, IPC handlers, indexing workers, and the
// path allowlist used by shell integrations.
const runtimeState: {
  queryService: QueryService | null;
  fileWatcher: FileWatcherService | null;
  watcherDebounceMs: 1000 | 3000 | 5000 | null;
} = {
  queryService: null,
  fileWatcher: null,
  watcherDebounceMs: null,
};

export async function bootstrapMainProcess(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const dbPath = options.dbPath ?? join(app.getPath("userData"), "codetrail.sqlite");
  const bookmarksDbPath = resolveBookmarksDbPath(dbPath);
  const settingsFilePath =
    options.appStateStore?.getFilePath() ?? join(app.getPath("userData"), "ui-state.json");
  const geminiHistoryRoot =
    DEFAULT_DISCOVERY_CONFIG.geminiHistoryRoot ?? join(app.getPath("home"), ".gemini", "history");
  const geminiProjectsPath =
    DEFAULT_DISCOVERY_CONFIG.geminiProjectsPath ??
    join(app.getPath("home"), ".gemini", "projects.json");
  const discoveryConfig = {
    ...DEFAULT_DISCOVERY_CONFIG,
    geminiHistoryRoot,
    geminiProjectsPath,
  };

  const dbBootstrap = initializeDatabase(dbPath);
  initializeBookmarkStore(bookmarksDbPath);
  const watchStatsStore = new WatchStatsStore();
  const getEnabledProviders = () =>
    resolveEnabledProviders(options.appStateStore?.getIndexingState()?.enabledProviders);
  const getRemoveMissingSessionsDuringIncrementalIndexing = () =>
    options.appStateStore?.getIndexingState()?.removeMissingSessionsDuringIncrementalIndexing ??
    false;
  const getEffectiveDiscoveryConfig = () => ({
    ...discoveryConfig,
    enabledProviders: getEnabledProviders(),
  });
  const indexingRunner = new WorkerIndexingRunner(dbPath, {
    bookmarksDbPath,
    getEnabledProviders,
    getRemoveMissingSessionsDuringIncrementalIndexing,
    getSystemMessageRegexRules: () =>
      options.appStateStore?.getPaneState()?.systemMessageRegexRules,
    onJobSettled: (event) => watchStatsStore.recordJobSettled(event),
    ...(options.onIndexingFileIssue ? { onFileIssue: options.onIndexingFileIssue } : {}),
    ...(options.onIndexingNotice ? { onNotice: options.onIndexingNotice } : {}),
  });
  if (runtimeState.queryService) {
    runtimeState.queryService.close();
  }
  const queryService = createQueryService(dbPath, { bookmarksDbPath });
  runtimeState.queryService = queryService;
  let allowedRootsCache: { roots: string[]; expiresAt: number } | null = null;
  const readAllowedRoots = (): string[] => {
    const now = Date.now();
    if (!allowedRootsCache || allowedRootsCache.expiresAt <= now) {
      allowedRootsCache = {
        roots: getAllowedOpenInFileManagerRoots({
          dbPath,
          bookmarksDbPath,
          settingsFilePath,
          queryService,
          discoveryConfig: getEffectiveDiscoveryConfig(),
        }),
        expiresAt: now + 5_000,
      };
    }
    return allowedRootsCache.roots;
  };
  const invalidateAllowedRootsCache = () => {
    allowedRootsCache = null;
  };

  const discoverySettingsPaths = listDiscoverySettingsPaths(discoveryConfig);
  const applyEnabledProviderFilter = (providers: Provider[] | undefined): Provider[] =>
    providers
      ? providers.filter((provider) => getEnabledProviders().includes(provider))
      : [...getEnabledProviders()];

  const startWatcherWithConfig = async (debounceMs: 1000 | 3000 | 5000) => {
    if (runtimeState.fileWatcher) {
      await runtimeState.fileWatcher.stop();
      runtimeState.fileWatcher = null;
    }

    const watcherRoots = listDiscoveryWatchRoots(getEffectiveDiscoveryConfig());
    const createFileWatcher = (watcherOptions: FileWatcherOptions) =>
      new FileWatcherService(
        watcherRoots,
        async (batch: FileWatcherBatch) => {
          invalidateAllowedRootsCache();
          watchStatsStore.recordWatcherTrigger({
            changedPathCount: batch.changedPaths.length,
            requiresFullScan: batch.requiresFullScan,
          });
          const enqueuePromise = batch.requiresFullScan
            ? indexingRunner.enqueue({ force: false }, { source: "watch_fallback_incremental" })
            : indexingRunner.enqueueChangedFiles(batch.changedPaths, {
                source: "watch_targeted",
              });
          await enqueuePromise.catch((error: unknown) => {
            if (options.onBackgroundError) {
              options.onBackgroundError("watcher-triggered indexing failed", error, {
                requiresFullScan: batch.requiresFullScan,
                changedPathCount: batch.changedPaths.length,
              });
              return;
            }
            console.error("[codetrail] watcher-triggered indexing failed", error);
          });
        },
        {
          ...watcherOptions,
          debounceMs,
        },
      );

    const startWatcher = async (
      watcherOptions: FileWatcherOptions,
      backend: "default" | "kqueue",
    ) => {
      const fileWatcher = createFileWatcher(watcherOptions);
      await fileWatcher.start();
      runtimeState.fileWatcher = fileWatcher;
      runtimeState.watcherDebounceMs = debounceMs;
      watchStatsStore.recordWatcherStart({
        backend,
        watchedRootCount: fileWatcher.getWatchedRoots().length,
      });
      return {
        backend,
        watchedRoots: fileWatcher.getWatchedRoots(),
      };
    };

    if (process.platform === "darwin") {
      try {
        return await startWatcher({ subscribeOptions: { backend: "kqueue" } }, "kqueue");
      } catch (error) {
        console.warn(
          "[codetrail] Failed to start kqueue watcher on macOS, falling back to default backend",
          error,
        );
        return startWatcher({}, "default");
      }
    }

    return startWatcher({}, "default");
  };

  registerIpcHandlers(ipcMain, {
    "app:getHealth": () => ({
      status: "ok",
      version: app.getVersion(),
    }),
    "app:getSettingsInfo": () => ({
      storage: {
        settingsFile: settingsFilePath,
        cacheDir: app.getPath("sessionData"),
        databaseFile: dbPath,
        bookmarksDatabaseFile: bookmarksDbPath,
        userDataDir: app.getPath("userData"),
      },
      discovery: {
        providers: PROVIDER_LIST.map((provider) => ({
          provider: provider.id,
          label: provider.label,
          paths: discoverySettingsPaths
            .filter((path) => path.provider === provider.id)
            .map((path) => ({
              key: path.key,
              label: path.label,
              value: path.value,
              watch: path.watch,
            })),
        })),
      },
    }),
    "db:getSchemaVersion": () => ({
      schemaVersion: dbBootstrap.schemaVersion,
    }),
    "indexer:refresh": async (payload) => {
      invalidateAllowedRootsCache();
      const job = await indexingRunner.enqueue(
        { force: payload.force },
        {
          source: payload.force ? "manual_force_reindex" : "manual_incremental",
        },
      );
      return { jobId: job.jobId };
    },
    "indexer:getStatus": () => indexingRunner.getStatus(),
    "projects:list": (payload) =>
      queryService.listProjects({
        ...payload,
        providers: applyEnabledProviderFilter(payload.providers),
      }),
    "projects:getCombinedDetail": (payload) => queryService.getProjectCombinedDetail(payload),
    "sessions:list": (payload) => queryService.listSessions(payload),
    "sessions:getDetail": (payload) => queryService.getSessionDetail(payload),
    "bookmarks:listProject": (payload) => queryService.listProjectBookmarks(payload),
    "bookmarks:toggle": (payload) => queryService.toggleBookmark(payload),
    "history:exportMessages": async (payload, event) =>
      exportHistoryMessages({
        browserWindow: BrowserWindow.fromWebContents(event.sender),
        onProgress: (progress) => {
          event.sender.send(HISTORY_EXPORT_PROGRESS_CHANNEL, progress);
        },
        queryService,
        request: payload,
      }),
    "search:query": (payload) =>
      queryService.runSearchQuery({
        ...payload,
        providers: applyEnabledProviderFilter(payload.providers),
      }),
    "path:openInFileManager": async (payload) => {
      if (!isAbsolute(payload.path)) {
        return { ok: false, error: "Path must be absolute." };
      }
      const targetPath = await resolveCanonicalPath(payload.path);
      // Only permit shell-open for indexed workspaces and app-owned storage to avoid turning IPC
      // into a generic arbitrary-path opener.
      const allowedRoots = readAllowedRoots();
      if (!isPathAllowedByRoots(targetPath, allowedRoots)) {
        return {
          ok: false,
          error: "Path is outside indexed projects and app storage roots.",
        };
      }
      try {
        const fileStat = await stat(targetPath);
        if (fileStat.isFile()) {
          shell.showItemInFolder(targetPath);
          return { ok: true, error: null };
        }
      } catch {
        // Fall through to generic shell open.
      }

      const error = await shell.openPath(targetPath);
      return {
        ok: error.length === 0,
        error: error.length > 0 ? error : null,
      };
    },
    "ui:getPaneState": () => {
      const paneState = options.appStateStore?.getPaneState();
      const result = Object.fromEntries(
        Object.keys(paneStateBaseSchema.shape)
          .filter((key) => key !== "systemMessageRegexRules")
          .map((key) => [key, paneState?.[key as keyof typeof paneState] ?? null]),
      );
      return {
        ...result,
        // systemMessageRegexRules needs special resolution to fill in defaults for new providers.
        systemMessageRegexRules: resolveSystemMessageRegexRules(paneState?.systemMessageRegexRules),
      } as IpcResponse<"ui:getPaneState">;
    },
    "ui:setPaneState": (payload) => {
      options.appStateStore?.setPaneState(payload);
      return { ok: true };
    },
    "indexer:getConfig": () => {
      const indexingState = options.appStateStore?.getIndexingState();
      const result = Object.fromEntries(
        Object.keys(indexerConfigBaseSchema.shape).map((key) => [
          key,
          indexingState?.[key as keyof typeof indexingState] ?? null,
        ]),
      );
      return {
        ...result,
        enabledProviders: getEnabledProviders(),
        removeMissingSessionsDuringIncrementalIndexing:
          getRemoveMissingSessionsDuringIncrementalIndexing(),
      } as IpcResponse<"indexer:getConfig">;
    },
    "indexer:setConfig": async (payload) => {
      const previousEnabledProviders = getEnabledProviders();
      options.appStateStore?.setIndexingState(payload);
      const nextEnabledProviders = getEnabledProviders();
      const enabledProvidersChanged =
        previousEnabledProviders.length !== nextEnabledProviders.length ||
        previousEnabledProviders.some((provider) => !nextEnabledProviders.includes(provider));
      if (enabledProvidersChanged) {
        const disabledProviders = previousEnabledProviders.filter(
          (provider) => !nextEnabledProviders.includes(provider),
        );
        invalidateAllowedRootsCache();
        if (disabledProviders.length > 0) {
          try {
            await indexingRunner.purgeProviders(disabledProviders, {
              source: "manual_incremental",
            });
          } catch (error) {
            if (options.onBackgroundError) {
              options.onBackgroundError("provider disable cleanup failed", error, {
                providers: disabledProviders,
              });
            } else {
              console.error("[codetrail] provider disable cleanup failed", error);
            }
          }
        }
        if (runtimeState.fileWatcher && runtimeState.watcherDebounceMs !== null) {
          try {
            await startWatcherWithConfig(runtimeState.watcherDebounceMs);
          } catch {
            runtimeState.watcherDebounceMs = null;
          }
        }
      }
      void indexingRunner
        .enqueue({ force: false }, { source: "manual_incremental" })
        .catch((error) => {
          if (options.onBackgroundError) {
            options.onBackgroundError("provider enablement refresh failed", error);
          } else {
            console.error("[codetrail] provider enablement refresh failed", error);
          }
        });
      return { ok: true };
    },
    "ui:getZoom": (_payload, event) => ({
      percent: Math.round(event.sender.getZoomFactor() * 100),
    }),
    "ui:setZoom": (payload, event) => {
      const currentPercent = Math.round(event.sender.getZoomFactor() * 100);
      let nextPercent = currentPercent;
      if ("percent" in payload) {
        nextPercent = payload.percent;
      } else if (payload.action === "reset") {
        nextPercent = DEFAULT_ZOOM_PERCENT;
      } else if (payload.action === "in") {
        nextPercent = currentPercent + ZOOM_STEP_PERCENT;
      } else {
        nextPercent = currentPercent - ZOOM_STEP_PERCENT;
      }
      const clampedPercent = Math.round(
        Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, nextPercent)),
      );
      event.sender.setZoomFactor(clampedPercent / 100);
      return {
        percent: clampedPercent,
      };
    },
    "watcher:start": async (payload) => {
      try {
        const startedWatcher = await startWatcherWithConfig(payload.debounceMs);

        // Run one full incremental scan to bring the DB up to date before relying on events
        void indexingRunner
          .enqueue({ force: false }, { source: "watch_initial_scan" })
          .catch((error: unknown) => {
            if (options.onBackgroundError) {
              options.onBackgroundError("watcher initial scan failed", error);
              return;
            }
            console.error("[codetrail] watcher initial scan failed", error);
          });
        return {
          ok: true,
          watchedRoots: startedWatcher.watchedRoots,
          backend: startedWatcher.backend,
        };
      } catch {
        return { ok: false, watchedRoots: [], backend: "default" as const };
      }
    },
    "watcher:getStatus": async () => {
      return (
        runtimeState.fileWatcher?.getStatus() ?? {
          running: false,
          processing: false,
          pendingPathCount: 0,
        }
      );
    },
    "watcher:getStats": async () => watchStatsStore.snapshot(),
    "watcher:stop": async () => {
      if (runtimeState.fileWatcher) {
        await runtimeState.fileWatcher.stop();
        runtimeState.fileWatcher = null;
      }
      runtimeState.watcherDebounceMs = null;
      return { ok: true };
    },
  });

  if (options.runStartupIndexing ?? true) {
    void indexingRunner
      .enqueue({ force: false }, { source: "startup_incremental" })
      .catch((error: unknown) => {
        if (options.onBackgroundError) {
          options.onBackgroundError("startup incremental indexing failed", error);
          return;
        }
        console.error("[codetrail] startup incremental indexing failed", error);
      });
  }

  return {
    schemaVersion: dbBootstrap.schemaVersion ?? DATABASE_SCHEMA_VERSION,
    tableCount: dbBootstrap.tables.length,
  };
}

export async function shutdownMainProcess(): Promise<void> {
  if (runtimeState.fileWatcher) {
    await runtimeState.fileWatcher.stop();
    runtimeState.fileWatcher = null;
  }
  runtimeState.watcherDebounceMs = null;
  if (!runtimeState.queryService) {
    return;
  }
  runtimeState.queryService.close();
  runtimeState.queryService = null;
}

function getAllowedOpenInFileManagerRoots(input: {
  dbPath: string;
  bookmarksDbPath: string;
  settingsFilePath: string;
  queryService: QueryService;
  discoveryConfig: typeof DEFAULT_DISCOVERY_CONFIG & { enabledProviders?: Provider[] };
}): string[] {
  const roots = new Set<string>();
  const addRoot = (value: string | null | undefined) => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    roots.add(normalizeResolvedPath(trimmed));
  };

  addRoot(input.dbPath);
  addRoot(input.bookmarksDbPath);
  addRoot(input.settingsFilePath);
  addRoot(app.getPath("userData"));
  addRoot(app.getPath("sessionData"));
  for (const path of listDiscoverySettingsPaths(input.discoveryConfig)) {
    addRoot(path.value);
    if (path.key === "geminiProjectsPath") {
      addRoot(dirname(path.value));
    }
  }

  try {
    // Indexed project paths are dynamic, so fold them into the static provider/app roots cache.
    const projects = input.queryService.listProjects({
      providers: input.discoveryConfig.enabledProviders,
      query: "",
    });
    for (const project of projects.projects) {
      addRoot(project.path);
    }
  } catch {
    // Keep static roots if project lookup fails.
  }

  return [...roots];
}

function normalizeResolvedPath(value: string): string {
  return resolve(normalize(value));
}

async function resolveCanonicalPath(value: string): Promise<string> {
  const normalizedPath = normalizeResolvedPath(value);
  try {
    return normalizeResolvedPath(await realpath(normalizedPath));
  } catch {
    return normalizedPath;
  }
}

function isPathAllowedByRoots(targetPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => isPathWithinRoot(targetPath, root));
}

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
