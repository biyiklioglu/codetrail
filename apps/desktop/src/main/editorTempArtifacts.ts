import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import type { EditorOpenRequest, ResolvedEditorDependencies } from "./editorDefinitions";

type TempArtifactWriteDependencies = Pick<
  ResolvedEditorDependencies,
  "mkdir" | "mkdtemp" | "writeFile"
>;

type TempArtifactCleanupDependencies = Pick<ResolvedEditorDependencies, "readdir" | "stat" | "rm">;

const TEMP_ROOT_NAME = "codetrail-editor-artifacts";
const DIFF_PREFIX = "diff-";
const CONTENT_PREFIX = "content-";
const ARTIFACT_TTL_MS = 1000 * 60 * 60 * 12;
const activeArtifactDirs = new Set<string>();

function getTempRoot(): string {
  return join(tmpdir(), TEMP_ROOT_NAME);
}

async function ensureTempRootWithWriteDependencies(
  dependencies: TempArtifactWriteDependencies,
): Promise<string> {
  const root = getTempRoot();
  await dependencies.mkdir(root, { recursive: true });
  return root;
}

async function createArtifactDir(
  kind: "diff" | "content",
  dependencies: TempArtifactWriteDependencies,
): Promise<string> {
  const root = await ensureTempRootWithWriteDependencies(dependencies);
  const prefix = kind === "diff" ? DIFF_PREFIX : CONTENT_PREFIX;
  const dir = await dependencies.mkdtemp(join(root, prefix));
  activeArtifactDirs.add(dir);
  return dir;
}

async function writeArtifactMetadata(
  dir: string,
  metadata: Record<string, string | number | null>,
  dependencies: TempArtifactWriteDependencies,
): Promise<void> {
  await dependencies.writeFile(
    join(dir, "artifact.json"),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
}

export async function materializeDiffTarget(
  request: Extract<EditorOpenRequest, { kind: "diff" }>,
  dependencies: ResolvedEditorDependencies,
): Promise<{ leftPath: string; rightPath: string }> {
  const suffix = request.filePath ? extname(request.filePath) : ".txt";
  const baseName = request.filePath
    ? basename(request.filePath, extname(request.filePath))
    : "diff";
  const dir = await createArtifactDir("diff", dependencies);
  const leftPath = join(dir, `${baseName}.before${suffix}`);
  const rightPath = join(dir, `${baseName}.after${suffix}`);
  await Promise.all([
    dependencies.writeFile(leftPath, request.leftContent, "utf8"),
    dependencies.writeFile(rightPath, request.rightContent, "utf8"),
    writeArtifactMetadata(
      dir,
      {
        kind: "diff",
        title: request.title ?? null,
        filePath: request.filePath ?? null,
        createdAt: Date.now(),
      },
      dependencies,
    ),
  ]);
  return { leftPath, rightPath };
}

export async function materializeContentTarget(
  request: Extract<EditorOpenRequest, { kind: "content" }>,
  dependencies: ResolvedEditorDependencies,
): Promise<{ filePath: string; line?: number; column?: number }> {
  const suffix = resolveContentSuffix(request);
  const baseName = sanitizeFileStem(
    request.filePath ? basename(request.filePath, extname(request.filePath)) : request.title,
  );
  const dir = await createArtifactDir("content", dependencies);
  const filePath = join(dir, `${baseName}${suffix}`);
  await Promise.all([
    dependencies.writeFile(filePath, request.content, "utf8"),
    writeArtifactMetadata(
      dir,
      {
        kind: "content",
        title: request.title,
        filePath: request.filePath ?? null,
        language: request.language ?? null,
        createdAt: Date.now(),
      },
      dependencies,
    ),
  ]);
  return {
    filePath,
    ...(request.line ? { line: request.line } : {}),
    ...(request.column ? { column: request.column } : {}),
  };
}

export async function cleanupStaleEditorTempArtifacts(
  dependencies: TempArtifactCleanupDependencies,
  now = Date.now(),
): Promise<void> {
  const root = getTempRoot();
  try {
    const entries = await dependencies.readdir(root, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isDirectory()) {
          return;
        }
        const dir = join(root, entry.name);
        if (activeArtifactDirs.has(dir)) {
          return;
        }
        const stats = await dependencies.stat(dir);
        if (now - stats.mtimeMs < ARTIFACT_TTL_MS) {
          return;
        }
        await dependencies.rm(dir, { recursive: true, force: true });
      }),
    );
  } catch {
    return;
  }
}

export function getEditorTempRoot(): string {
  return getTempRoot();
}

export function resetActiveEditorTempArtifacts(): void {
  activeArtifactDirs.clear();
}

export function resetActiveEditorTempArtifactsForTests(): void {
  resetActiveEditorTempArtifacts();
}

function resolveContentSuffix(request: Extract<EditorOpenRequest, { kind: "content" }>): string {
  const filePath = request.filePath?.trim() ?? "";
  const explicitExt = filePath ? extname(filePath) : "";
  if (explicitExt) {
    return explicitExt;
  }

  switch ((request.language ?? "").trim().toLowerCase()) {
    case "typescript":
    case "ts":
      return ".ts";
    case "tsx":
      return ".tsx";
    case "javascript":
    case "js":
      return ".js";
    case "jsx":
      return ".jsx";
    case "json":
      return ".json";
    case "shell":
    case "bash":
    case "sh":
    case "zsh":
      return ".sh";
    case "python":
    case "py":
      return ".py";
    case "markdown":
    case "md":
      return ".md";
    case "html":
      return ".html";
    case "css":
      return ".css";
    case "sql":
      return ".sql";
    case "diff":
    case "patch":
      return ".diff";
    default:
      return ".txt";
  }
}

function sanitizeFileStem(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-");
  return normalized.length > 0 ? normalized.slice(0, 48) : "content";
}
