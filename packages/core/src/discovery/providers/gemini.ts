import { basename, extname, join } from "node:path";

import { readString } from "../../parsing/helpers";
import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
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
  config: ResolvedDiscoveryConfig,
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
  let resolvedProjectPath = resolution.hashToPath.get(projectHash) ?? null;

  if (!resolvedProjectPath) {
    const projectRootPath = join(containerDir, ".project_root");
    if (dependencies.fs.existsSync(projectRootPath)) {
      const fallbackPath = (safeReadUtf8File(projectRootPath, dependencies) ?? "").trim();
      if (fallbackPath.length > 0) {
        resolvedProjectPath = fallbackPath;
        if (projectHash) {
          resolution.hashToPath.set(projectHash, fallbackPath);
        }
      }
    }
  }

  const projectPath = resolvedProjectPath ?? "";
  const unresolvedProject = !resolvedProjectPath;
  const fallbackProjectName = basename(containerDir);

  return {
    provider: "gemini",
    projectPath,
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
    },
  };
}

export function discoverGeminiFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const geminiRoot = getDiscoveryPath(config, "gemini", "geminiRoot");
  if (!geminiRoot || !dependencies.fs.existsSync(geminiRoot)) {
    return [];
  }
  const resolution = buildGeminiProjectResolution(config, dependencies);
  return walkFiles(geminiRoot, dependencies)
    .map((filePath) => toDiscoveredGeminiFile(filePath, config, dependencies, resolution))
    .filter((file): file is DiscoveredSessionFile => file !== null);
}

export function discoverSingleGeminiFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const geminiRoot = getDiscoveryPath(config, "gemini", "geminiRoot");
  if (!geminiRoot || !filePath.startsWith(`${geminiRoot}/`)) {
    return null;
  }

  return toDiscoveredGeminiFile(
    filePath,
    config,
    dependencies,
    buildGeminiProjectResolution(config, dependencies),
  );
}
