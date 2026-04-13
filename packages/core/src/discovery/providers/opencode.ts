import { basename, join } from "node:path";

import Database from "better-sqlite3";

import { compactMetadata } from "../../metadata";
import {
  type ProviderReadSourceResult,
  type ProviderSource,
  type ReadFileText,
} from "../../providers/types";
import { readString } from "../../parsing/helpers";
import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  projectNameFromPath,
  providerSessionIdentity,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";

const OPENCODE_DB_FILENAME = "opencode.db";
const OPENCODE_SOURCE_PREFIX = "opencode:";

type OpenCodeDiscoveryRow = {
  session_id: string;
  project_id: string;
  parent_id: string | null;
  directory: string;
  title: string;
  version: string;
  time_created: number;
  time_updated: number;
  project_name: string | null;
  worktree: string | null;
  payload_bytes: number | null;
};

type OpenCodeSessionRow = {
  session_id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string;
  version: string;
  time_created: number;
  time_updated: number;
  time_archived: number | null;
  workspace_id: string | null;
  project_name: string | null;
  worktree: string | null;
  project_time_created: number | null;
  project_time_updated: number | null;
};

type OpenCodeMessageRow = {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
};

type OpenCodePartRow = {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
};

export function buildOpenCodeDatabasePath(root: string): string {
  return join(root, OPENCODE_DB_FILENAME);
}

export function buildOpenCodeSessionSourceKey(dbPath: string, sessionId: string): string {
  return `${OPENCODE_SOURCE_PREFIX}${dbPath}:${sessionId}`;
}

export function buildOpenCodeSessionSourcePrefix(dbPath: string): string {
  return `${OPENCODE_SOURCE_PREFIX}${dbPath}:`;
}

export function parseOpenCodeSessionSourceKey(sourceKey: string): {
  dbPath: string;
  sessionId: string;
} | null {
  if (!sourceKey.startsWith(OPENCODE_SOURCE_PREFIX)) {
    return null;
  }

  const remainder = sourceKey.slice(OPENCODE_SOURCE_PREFIX.length);
  const separator = remainder.lastIndexOf(":");
  if (separator <= 0 || separator === remainder.length - 1) {
    return null;
  }

  return {
    dbPath: remainder.slice(0, separator),
    sessionId: remainder.slice(separator + 1),
  };
}

export function normalizeOpenCodeDatabasePath(
  changedPath: string,
  opencodeRoot: string,
): string | null {
  const dbPath = buildOpenCodeDatabasePath(opencodeRoot);
  if (
    changedPath === dbPath ||
    changedPath === `${dbPath}-wal` ||
    changedPath === `${dbPath}-shm`
  ) {
    return dbPath;
  }
  return null;
}

function openReadOnlyDatabase(dbPath: string): InstanceType<typeof Database> {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readOpenCodeDiscoveryRows(
  dbPath: string,
  dependencies: ResolvedDiscoveryDependencies,
  sessionId?: string,
): OpenCodeDiscoveryRow[] {
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = openReadOnlyDatabase(dbPath);
    const query = db.prepare(
      `SELECT
         s.id AS session_id,
         s.project_id AS project_id,
         s.parent_id AS parent_id,
         s.directory AS directory,
         s.title AS title,
         s.version AS version,
         s.time_created AS time_created,
         s.time_updated AS time_updated,
         p.name AS project_name,
         p.worktree AS worktree,
         COALESCE((SELECT SUM(LENGTH(m.data)) FROM message m WHERE m.session_id = s.id), 0) +
         COALESCE((SELECT SUM(LENGTH(prt.data)) FROM part prt WHERE prt.session_id = s.id), 0) AS payload_bytes
       FROM session s
       LEFT JOIN project p ON p.id = s.project_id
       WHERE (? IS NULL OR s.id = ?)
       ORDER BY s.time_updated DESC, s.id DESC`,
    );
    return query.all(sessionId ?? null, sessionId ?? null) as OpenCodeDiscoveryRow[];
  } catch (error) {
    dependencies.onDiscoveryIssue({ operation: "readFile", path: dbPath, error });
    return [];
  } finally {
    db?.close();
  }
}

function toDiscoveredOpenCodeSession(
  row: OpenCodeDiscoveryRow,
  dbPath: string,
): DiscoveredSessionFile {
  const projectPath = row.directory || row.worktree || "";
  const sourceKey = buildOpenCodeSessionSourceKey(dbPath, row.session_id);
  const sessionIdentity = providerSessionIdentity("opencode", row.session_id, sourceKey);
  const unresolvedProject = projectPath.length === 0;
  const projectName =
    !unresolvedProject && projectPath.length > 0
      ? projectNameFromPath(projectPath)
      : row.project_name || basename(row.directory) || "Unknown";
  const resolutionSource = row.directory
    ? "session_directory"
    : row.worktree
      ? "project_worktree"
      : "unresolved";

  return {
    provider: "opencode",
    projectPath,
    canonicalProjectPath: projectPath,
    projectName,
    sessionIdentity,
    sourceSessionId: row.session_id,
    filePath: sourceKey,
    backingFilePath: dbPath,
    fileSize: Math.max(0, Number(row.payload_bytes ?? 0)),
    fileMtimeMs: Math.max(0, Number(row.time_updated ?? row.time_created ?? 0)),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject,
      gitBranch: null,
      cwd: row.directory || null,
      worktreeLabel: null,
      worktreeSource: null,
      repositoryUrl: null,
      forkedFromSessionId: row.parent_id,
      parentSessionCwd: null,
      providerProjectKey: row.project_id,
      providerSessionId: row.session_id,
      sessionKind: row.parent_id ? "forked" : "regular",
      gitCommitHash: null,
      providerClient: "OpenCode",
      providerSource: null,
      providerClientVersion: row.version || null,
      lineageParentId: row.parent_id,
      resolutionSource,
      projectMetadata: null,
      sessionMetadata: compactMetadata({
        title: row.title || undefined,
      }),
    },
  };
}

function discoverOpenCodeSessionsFromDb(
  dbPath: string,
  dependencies: ResolvedDiscoveryDependencies,
  sessionId?: string,
): DiscoveredSessionFile[] {
  if (!dependencies.fs.existsSync(dbPath)) {
    return [];
  }
  return readOpenCodeDiscoveryRows(dbPath, dependencies, sessionId).map((row) =>
    toDiscoveredOpenCodeSession(row, dbPath),
  );
}

export function discoverOpenCodeFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const opencodeRoot = getDiscoveryPath(config, "opencode", "opencodeRoot");
  if (!opencodeRoot) {
    return [];
  }
  return discoverOpenCodeSessionsFromDb(buildOpenCodeDatabasePath(opencodeRoot), dependencies);
}

export function discoverSingleOpenCodeFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const parsed = parseOpenCodeSessionSourceKey(filePath);
  const opencodeRoot = getDiscoveryPath(config, "opencode", "opencodeRoot");
  const configuredDbPath = opencodeRoot ? buildOpenCodeDatabasePath(opencodeRoot) : null;
  if (!parsed || !configuredDbPath || parsed.dbPath !== configuredDbPath) {
    return null;
  }

  return (
    discoverOpenCodeSessionsFromDb(parsed.dbPath, dependencies, parsed.sessionId)[0] ?? null
  );
}

export function discoverChangedOpenCodeFiles(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const parsed = parseOpenCodeSessionSourceKey(filePath);
  if (parsed) {
    return discoverOpenCodeSessionsFromDb(parsed.dbPath, dependencies, parsed.sessionId);
  }

  const opencodeRoot = getDiscoveryPath(config, "opencode", "opencodeRoot");
  if (!opencodeRoot) {
    return [];
  }

  const dbPath = normalizeOpenCodeDatabasePath(filePath, opencodeRoot);
  if (!dbPath) {
    return [];
  }

  return discoverOpenCodeSessionsFromDb(dbPath, dependencies);
}

export function readOpenCodeSource(
  discovered: DiscoveredSessionFile,
  _readFileText: ReadFileText,
): ProviderReadSourceResult | null {
  const parsed = parseOpenCodeSessionSourceKey(discovered.filePath);
  const dbPath = parsed?.dbPath ?? discovered.backingFilePath;
  const sessionId = parsed?.sessionId ?? discovered.sourceSessionId;
  if (!dbPath) {
    return null;
  }
  let db: InstanceType<typeof Database> | null = null;

  try {
    db = openReadOnlyDatabase(dbPath);
    const sessionRow = db
      .prepare(
        `SELECT
           s.id AS session_id,
           s.project_id AS project_id,
           s.parent_id AS parent_id,
           s.slug AS slug,
           s.directory AS directory,
           s.title AS title,
           s.version AS version,
           s.time_created AS time_created,
           s.time_updated AS time_updated,
           s.time_archived AS time_archived,
           s.workspace_id AS workspace_id,
           p.name AS project_name,
           p.worktree AS worktree,
           p.time_created AS project_time_created,
           p.time_updated AS project_time_updated
         FROM session s
         LEFT JOIN project p ON p.id = s.project_id
         WHERE s.id = ?`,
      )
      .get(sessionId) as OpenCodeSessionRow | undefined;

    if (!sessionRow) {
      return null;
    }

    const messageRows = db
      .prepare(
        `SELECT id, session_id, time_created, time_updated, data
         FROM message
         WHERE session_id = ?
         ORDER BY time_created ASC, id ASC`,
      )
      .all(sessionId) as OpenCodeMessageRow[];

    const partRows = db
      .prepare(
        `SELECT id, message_id, session_id, time_created, time_updated, data
         FROM part
         WHERE session_id = ?
         ORDER BY time_created ASC, id ASC`,
      )
      .all(sessionId) as OpenCodePartRow[];

    const partsByMessageId = new Map<string, Array<Record<string, unknown>>>();
    for (const partRow of partRows) {
      const list = partsByMessageId.get(partRow.message_id) ?? [];
      list.push({
        id: partRow.id,
        messageId: partRow.message_id,
        sessionId: partRow.session_id,
        timeCreated: partRow.time_created,
        timeUpdated: partRow.time_updated,
        data: parseJsonObject(partRow.data) ?? {},
      });
      partsByMessageId.set(partRow.message_id, list);
    }

    return {
      payload: {
        session: {
          id: sessionRow.session_id,
          projectId: sessionRow.project_id,
          parentId: sessionRow.parent_id,
          slug: sessionRow.slug,
          directory: sessionRow.directory,
          title: sessionRow.title,
          version: sessionRow.version,
          timeCreated: sessionRow.time_created,
          timeUpdated: sessionRow.time_updated,
          timeArchived: sessionRow.time_archived,
          workspaceId: sessionRow.workspace_id,
        },
        project: {
          id: sessionRow.project_id,
          name: sessionRow.project_name,
          worktree: sessionRow.worktree,
          timeCreated: sessionRow.project_time_created,
          timeUpdated: sessionRow.project_time_updated,
        },
        messages: messageRows.map((messageRow) => ({
          id: messageRow.id,
          sessionId: messageRow.session_id,
          timeCreated: messageRow.time_created,
          timeUpdated: messageRow.time_updated,
          data: parseJsonObject(messageRow.data) ?? {},
          parts: partsByMessageId.get(messageRow.id) ?? [],
        })),
      } as ProviderSource,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
