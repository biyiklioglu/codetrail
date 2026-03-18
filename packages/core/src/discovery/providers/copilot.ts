import { basename, extname, join } from "node:path";

import {
  type ResolvedDiscoveryDependencies,
  decodeFileUrlPath,
  getDiscoveryPath,
  isUnderRoot,
  parseJsonFile,
  projectNameFromPath,
  providerSessionIdentity,
  relativeSegments,
  safeIsDirectory,
  safeReadDir,
  safeStat,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";

function decodeCopilotWorkspaceProject(
  workspaceDir: string,
  dependencies: ResolvedDiscoveryDependencies,
): string | null {
  const workspaceJsonPath = join(workspaceDir, "workspace.json");
  const content = parseJsonFile<{ folder?: string }>(workspaceJsonPath, dependencies);
  if (!content?.folder) {
    return null;
  }

  return decodeFileUrlPath(content.folder);
}

function toDiscoveredCopilotFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const copilotRoot = getDiscoveryPath(config, "copilot", "copilotRoot");
  if (!copilotRoot || extname(filePath) !== ".json" || !isUnderRoot(filePath, copilotRoot)) {
    return null;
  }

  const segments = relativeSegments(filePath, copilotRoot);
  if (segments.length < 3 || segments[1] !== "chatSessions") {
    return null;
  }

  const workspaceId = segments[0];
  if (!workspaceId) {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const workspaceDir = join(copilotRoot, workspaceId);
  const projectPath = decodeCopilotWorkspaceProject(workspaceDir, dependencies);
  const projectName = projectPath ? projectNameFromPath(projectPath) : workspaceId;
  const unresolvedProject = !projectPath;
  const sourceSessionId = basename(filePath, ".json");
  const sessionIdentity = providerSessionIdentity("copilot", sourceSessionId, filePath);

  return {
    provider: "copilot",
    projectPath: projectPath ?? "",
    projectName,
    sessionIdentity,
    sourceSessionId,
    filePath,
    fileSize: fileStat.size,
    fileMtimeMs: Math.trunc(fileStat.mtimeMs),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject,
      gitBranch: null,
      cwd: projectPath || null,
    },
  };
}

export function discoverCopilotFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const copilotRoot = getDiscoveryPath(config, "copilot", "copilotRoot");
  if (!copilotRoot || !dependencies.fs.existsSync(copilotRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];
  for (const workspaceEntry of safeReadDir(copilotRoot, dependencies)) {
    if (!workspaceEntry.isDirectory()) {
      continue;
    }

    const workspaceDir = join(copilotRoot, workspaceEntry.name);
    const chatSessionsDir = join(workspaceDir, "chatSessions");
    if (!safeIsDirectory(chatSessionsDir, dependencies)) {
      continue;
    }

    for (const sessionFile of safeReadDir(chatSessionsDir, dependencies)) {
      if (!sessionFile.isFile()) {
        continue;
      }
      const discoveredFile = toDiscoveredCopilotFile(
        join(chatSessionsDir, sessionFile.name),
        config,
        dependencies,
      );
      if (discoveredFile) {
        discovered.push(discoveredFile);
      }
    }
  }

  return discovered;
}

export function discoverSingleCopilotFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  return toDiscoveredCopilotFile(filePath, config, dependencies);
}
