import { basename, extname, join } from "node:path";

import { readString } from "../../parsing/helpers";
import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  isUnderRoot,
  parseJsonFile,
  projectNameFromPath,
  providerSessionIdentity,
  safeReadUtf8File,
  safeStat,
  walkFiles,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";
import { buildGeminiProjectResolution, geminiContainerDir } from "./geminiHelpers";

function toDiscoveredGeminiFile(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
  resolution: ReturnType<typeof buildGeminiProjectResolution>,
): DiscoveredSessionFile | null {
  if (extname(filePath) !== ".json" || !basename(filePath).startsWith("session-")) {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const content = parseJsonFile<Record<string, unknown>>(filePath, dependencies);
  if (!content) {
    return null;
  }

  const sourceSessionId = readString(content.sessionId) ?? basename(filePath, ".json");
  const sessionIdentity = providerSessionIdentity("gemini", sourceSessionId, filePath);
  const projectHash = readString(content.projectHash) ?? "";
  const containerDir = geminiContainerDir(filePath);
  let resolvedProjectPath = resolution.resolveProjectPath(projectHash);
  let resolutionSource = resolvedProjectPath ? "project_hash" : "unresolved";

  if (!resolvedProjectPath) {
    const projectRootPath = join(containerDir, ".project_root");
    if (dependencies.fs.existsSync(projectRootPath)) {
      const fallbackPath = (safeReadUtf8File(projectRootPath, dependencies) ?? "").trim();
      if (fallbackPath.length > 0) {
        resolvedProjectPath = fallbackPath;
        resolution.rememberProjectPath(projectHash, fallbackPath);
        resolutionSource = "project_root";
      }
    }
  }

  const projectPath = resolvedProjectPath ?? "";
  const unresolvedProject = !resolvedProjectPath;
  const fallbackProjectName =
    basename(containerDir) || basename(filePath, extname(filePath)) || "Unknown";

  return {
    provider: "gemini",
    projectPath,
    canonicalProjectPath: projectPath,
    projectName: unresolvedProject ? fallbackProjectName : projectNameFromPath(projectPath),
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
      worktreeLabel: null,
      worktreeSource: null,
      repositoryUrl: null,
      forkedFromSessionId: null,
      parentSessionCwd: null,
      providerProjectKey: projectHash || null,
      providerSessionId: sourceSessionId,
      sessionKind: "regular",
      gitCommitHash: null,
      providerClient: "Gemini",
      providerSource: null,
      providerClientVersion: null,
      lineageParentId: null,
      resolutionSource,
      projectMetadata: null,
      sessionMetadata: null,
    },
  };
}

export function discoverGeminiFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const resolution = buildGeminiProjectResolution(config, dependencies);
  const discovered: DiscoveredSessionFile[] = [];

  for (const root of [
    getDiscoveryPath(config, "gemini", "geminiRoot"),
    getDiscoveryPath(config, "gemini", "geminiHistoryRoot"),
  ]) {
    if (!root || !dependencies.fs.existsSync(root)) {
      continue;
    }

    discovered.push(
      ...walkFiles(root, dependencies)
        .map((filePath) => toDiscoveredGeminiFile(filePath, dependencies, resolution))
        .filter((file): file is DiscoveredSessionFile => file !== null),
    );
  }

  return discovered;
}

export function discoverSingleGeminiFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const geminiRoots = [
    getDiscoveryPath(config, "gemini", "geminiRoot"),
    getDiscoveryPath(config, "gemini", "geminiHistoryRoot"),
  ].filter((root): root is string => typeof root === "string" && root.length > 0);
  if (!geminiRoots.some((root) => isUnderRoot(filePath, root))) {
    return null;
  }

  return toDiscoveredGeminiFile(
    filePath,
    dependencies,
    buildGeminiProjectResolution(config, dependencies),
  );
}
