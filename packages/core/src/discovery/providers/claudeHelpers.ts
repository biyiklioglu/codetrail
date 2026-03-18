import { join } from "node:path";

import { readString } from "../../parsing/helpers";
import type { ResolvedDiscoveryDependencies } from "../shared";
import { parseJsonFile, readFirstJsonlObject } from "../shared";

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
  cwd: string | null;
  gitBranch: string | null;
} {
  const firstObject = readFirstJsonlObject(filePath, dependencies);
  if (!firstObject) {
    return { cwd: null, gitBranch: null };
  }

  return {
    cwd: readString(firstObject.cwd),
    gitBranch: readString(firstObject.gitBranch),
  };
}

export function decodeClaudeProjectId(projectId: string): string {
  if (!projectId) {
    return "";
  }

  return projectId.replaceAll("-", "/");
}
