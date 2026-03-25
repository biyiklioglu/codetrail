import { join } from "node:path";

import { asArray, asRecord, readString } from "../../parsing/helpers";
import type { ResolvedDiscoveryDependencies } from "../shared";
import { parseJsonFile, readLeadingNonEmptyLines } from "../shared";
import { matchClaudeManagedWorktree } from "./worktreeHelpers";

export function readClaudeSessionsIndex(
  projectDir: string,
  dependencies: ResolvedDiscoveryDependencies,
): Map<string, { projectPath: string }> {
  const sessionsIndexPath = join(projectDir, "sessions-index.json");
  const parsed = parseJsonFile<{ entries?: Array<{ sessionId?: string; projectPath?: string }> }>(
    sessionsIndexPath,
    dependencies,
  );
  const byId = new Map<string, { projectPath: string }>();

  for (const entry of parsed?.entries ?? []) {
    if (!entry.sessionId || !entry.projectPath) {
      continue;
    }

    byId.set(entry.sessionId, { projectPath: entry.projectPath });
  }

  return byId;
}

export function readClaudeJsonlMeta(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
): {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  canonicalProjectPath: string | null;
  worktreeLabel: string | null;
  mainRepositoryPath: string | null;
  isSidechain: boolean;
  userType: string | null;
  version: string | null;
} {
  const lines = readLeadingNonEmptyLines(filePath, 80, 256 * 1024, dependencies);
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let mainRepositoryPath: string | null = null;
  let worktreeLabel: string | null = null;
  let isSidechain = false;
  let userType: string | null = null;
  let version: string | null = null;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record) {
      continue;
    }

    sessionId ??= readString(record.sessionId);
    cwd ??= readString(record.cwd);
    gitBranch ??= readString(record.gitBranch);
    userType ??= readString(record.userType);
    version ??= readString(record.version);
    isSidechain ||= record.isSidechain === true;

    const textValues = extractClaudeTextValues(record.message);
    for (const textValue of textValues) {
      mainRepositoryPath ??= extractClaudeEnvironmentValue(textValue, "Main repository");
      worktreeLabel ??= extractClaudeEnvironmentValue(textValue, "Worktree name");
    }
  }

  const claudeManagedWorktree = matchClaudeManagedWorktree(cwd);
  if (claudeManagedWorktree) {
    return {
      sessionId,
      cwd,
      gitBranch,
      canonicalProjectPath: claudeManagedWorktree.canonicalProjectPath,
      worktreeLabel: claudeManagedWorktree.worktreeLabel,
      mainRepositoryPath: claudeManagedWorktree.canonicalProjectPath,
      isSidechain,
      userType,
      version,
    };
  }

  return {
    sessionId,
    cwd,
    gitBranch,
    canonicalProjectPath: mainRepositoryPath,
    worktreeLabel,
    mainRepositoryPath,
    isSidechain,
    userType,
    version,
  };
}

function extractClaudeTextValues(message: unknown): string[] {
  const messageRecord = asRecord(message);
  if (!messageRecord) {
    return [];
  }

  const content = messageRecord.content;
  if (typeof content === "string") {
    return [content];
  }

  const values: string[] = [];
  for (const entry of asArray(content)) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }

    const contentType = readString(record.type);
    if (contentType === "text") {
      const text = readString(record.text);
      if (text) {
        values.push(text);
      }
      continue;
    }

    if (contentType === "thinking") {
      const thinking = readString(record.thinking);
      if (thinking) {
        values.push(thinking);
      }
    }
  }

  return values;
}

function extractClaudeEnvironmentValue(text: string, label: string): string | null {
  const match = text.match(new RegExp(`${escapeRegExp(label)}:\\s*(.+)`));
  return match?.[1]?.trim() || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function decodeClaudeProjectId(projectId: string): string {
  if (!projectId) {
    return "";
  }

  return projectId.replaceAll("-", "/");
}
