import { basename, extname, join } from "node:path";

import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  projectNameFromPath,
  relativeSegments,
  safeIsDirectory,
  safeReadDir,
  safeStat,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";
import {
  decodeClaudeProjectId,
  readClaudeJsonlMeta,
  readClaudeSessionsIndex,
} from "./claudeHelpers";

export function discoverClaudeFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const claudeRoot = getDiscoveryPath(config, "claude", "claudeRoot");
  if (!claudeRoot || !dependencies.fs.existsSync(claudeRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];

  for (const projectEntry of safeReadDir(claudeRoot, dependencies)) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = join(claudeRoot, projectEntry.name);
    const sessionsIndexById = readClaudeSessionsIndex(projectDir, dependencies);

    for (const entry of safeReadDir(projectDir, dependencies)) {
      if (!entry.isFile() || extname(entry.name) !== ".jsonl") {
        continue;
      }

      const filePath = join(projectDir, entry.name);
      const fileStat = safeStat(filePath, dependencies);
      if (!fileStat) {
        continue;
      }
      const sessionIdentity = entry.name.slice(0, -".jsonl".length);
      const fileMeta = readClaudeJsonlMeta(filePath, dependencies);
      const sessionIndexEntry = sessionsIndexById.get(sessionIdentity);
      const projectPath =
        sessionIndexEntry?.projectPath ?? decodeClaudeProjectId(projectEntry.name);

      discovered.push({
        provider: "claude",
        projectPath,
        projectName: projectNameFromPath(projectPath),
        sessionIdentity,
        sourceSessionId: sessionIdentity,
        filePath,
        fileSize: fileStat.size,
        fileMtimeMs: Math.trunc(fileStat.mtimeMs),
        metadata: {
          includeInHistory: true,
          isSubagent: false,
          unresolvedProject: false,
          gitBranch: fileMeta.gitBranch,
          cwd: fileMeta.cwd,
        },
      });
    }

    if (!config.providers.claude.options.includeSubagents) {
      continue;
    }

    for (const sessionDir of safeReadDir(projectDir, dependencies)) {
      if (!sessionDir.isDirectory()) {
        continue;
      }

      const subagentsDir = join(projectDir, sessionDir.name, "subagents");
      if (!safeIsDirectory(subagentsDir, dependencies)) {
        continue;
      }

      for (const fileEntry of safeReadDir(subagentsDir, dependencies)) {
        if (!fileEntry.isFile() || extname(fileEntry.name) !== ".jsonl") {
          continue;
        }

        const filePath = join(subagentsDir, fileEntry.name);
        const fileStat = safeStat(filePath, dependencies);
        if (!fileStat) {
          continue;
        }
        const fileMeta = readClaudeJsonlMeta(filePath, dependencies);
        const parentSessionId = sessionDir.name;
        const subagentName = fileEntry.name.slice(0, -".jsonl".length);
        const sessionIdentity = `${parentSessionId}:subagent:${subagentName}`;
        const sessionIndexEntry = sessionsIndexById.get(parentSessionId);
        const projectPath =
          sessionIndexEntry?.projectPath ?? decodeClaudeProjectId(projectEntry.name);

        discovered.push({
          provider: "claude",
          projectPath,
          projectName: projectNameFromPath(projectPath),
          sessionIdentity,
          sourceSessionId: parentSessionId,
          filePath,
          fileSize: fileStat.size,
          fileMtimeMs: Math.trunc(fileStat.mtimeMs),
          metadata: {
            includeInHistory: true,
            isSubagent: true,
            unresolvedProject: false,
            gitBranch: fileMeta.gitBranch,
            cwd: fileMeta.cwd,
          },
        });
      }
    }
  }

  return discovered;
}

export function discoverSingleClaudeFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  if (extname(filePath) !== ".jsonl") {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const claudeRoot = getDiscoveryPath(config, "claude", "claudeRoot");
  if (!claudeRoot) {
    return null;
  }

  const segments = relativeSegments(filePath, claudeRoot);
  if (segments.length < 2) {
    return null;
  }

  const projectId = segments[0];
  if (!projectId) {
    return null;
  }

  const projectDir = join(claudeRoot, projectId);
  const sessionIdentity = basename(filePath, ".jsonl");
  const sessionsIndexById = readClaudeSessionsIndex(projectDir, dependencies);
  const sessionIndexEntry = sessionsIndexById.get(sessionIdentity);
  const projectPath = sessionIndexEntry?.projectPath ?? decodeClaudeProjectId(projectId);
  const fileMeta = readClaudeJsonlMeta(filePath, dependencies);

  return {
    provider: "claude",
    projectPath,
    projectName: projectNameFromPath(projectPath),
    sessionIdentity,
    sourceSessionId: sessionIdentity,
    filePath,
    fileSize: fileStat.size,
    fileMtimeMs: Math.trunc(fileStat.mtimeMs),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject: false,
      gitBranch: fileMeta.gitBranch,
      cwd: fileMeta.cwd,
    },
  };
}
