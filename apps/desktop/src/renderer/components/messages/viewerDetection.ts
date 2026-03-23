import { tryParseJsonRecord } from "./toolParsing";
import { LARGE_VIEWER_BYTE_LIMIT, LARGE_VIEWER_LINE_LIMIT } from "./viewerConfig";

export type ViewerKind = "source" | "diff" | "json" | "shell" | "log" | "plain";

const TEXT_ENCODER = new TextEncoder();

export function detectViewerKind(language: string, codeValue: string): ViewerKind {
  const normalizedLanguage = language.trim().toLowerCase();
  if (isLikelyDiff(normalizedLanguage, codeValue)) {
    return "diff";
  }
  if (normalizedLanguage === "json" || detectLanguageFromContent(codeValue) === "json") {
    return "json";
  }
  if (["shell", "bash", "sh", "zsh"].includes(normalizedLanguage)) {
    return "shell";
  }
  if (looksLikeLogContent(codeValue)) {
    return "log";
  }
  if (normalizedLanguage.length > 0 && normalizedLanguage !== "text") {
    return "source";
  }
  return "plain";
}

export function looksLikeLogContent(value: string): boolean {
  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return false;
  }
  const logLikeLines = lines.filter((line) =>
    /(^\d{4}-\d{2}-\d{2}|^\[\w+\]|^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|(?:ERROR|WARN|INFO|DEBUG|TRACE)\b)/i.test(
      line,
    ),
  ).length;
  return logLikeLines >= Math.min(3, lines.length);
}

export function getContentSummary(
  value: string,
  renderedCount: number,
  totalCount: number,
): string {
  const sizeKb = Math.max(1, Math.round(TEXT_ENCODER.encode(value).length / 1024));
  return renderedCount < totalCount
    ? `${renderedCount}/${totalCount} lines shown, ${sizeKb} KB`
    : `${totalCount} lines, ${sizeKb} KB`;
}

export function shouldProgressivelyRender(value: string, totalCount: number): boolean {
  return (
    totalCount > LARGE_VIEWER_LINE_LIMIT ||
    TEXT_ENCODER.encode(value).length > LARGE_VIEWER_BYTE_LIMIT
  );
}

export function analyzeTextContent(value: string): {
  byteLength: number;
  isLarge: boolean;
  lineValues: string[];
  totalLines: number;
} {
  const lineValues = value.split(/\r?\n/);
  const byteLength = TEXT_ENCODER.encode(value).length;
  return {
    byteLength,
    isLarge: lineValues.length > LARGE_VIEWER_LINE_LIMIT || byteLength > LARGE_VIEWER_BYTE_LIMIT,
    lineValues,
    totalLines: lineValues.length,
  };
}

export function detectLanguageFromContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "text";
  }
  if (isLikelyDiff("", value)) {
    return "diff";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJsonValue(value);
    if (parsed !== null) {
      return "json";
    }
  }
  if (trimmed.includes("<html") || trimmed.includes("</")) {
    return "html";
  }
  return "text";
}

function tryParseJsonValue(value: string): unknown | null {
  const record = tryParseJsonRecord(value);
  if (record) {
    return record;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function detectLanguageFromFilePath(path: string | null): string {
  if (!path) {
    return "text";
  }
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) {
    return "typescript";
  }
  if (normalized.endsWith(".js") || normalized.endsWith(".jsx")) {
    return "javascript";
  }
  if (normalized.endsWith(".py")) {
    return "python";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".css")) {
    return "css";
  }
  if (normalized.endsWith(".html")) {
    return "html";
  }
  if (normalized.endsWith(".sql")) {
    return "sql";
  }
  if (normalized.endsWith(".md")) {
    return "markdown";
  }
  if (normalized.endsWith(".sh") || normalized.endsWith(".zsh") || normalized.endsWith(".bash")) {
    return "shell";
  }
  return "text";
}

export function isLikelyDiff(language: string, codeValue: string): boolean {
  if (language.includes("diff") || language === "patch") {
    return true;
  }
  const lines = codeValue.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }
  const hasStrongMarker = lines.some(
    (line) =>
      line.startsWith("@@") ||
      line.startsWith("diff --git") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ "),
  );
  if (hasStrongMarker) {
    return true;
  }

  const addedLines = lines.filter((line) => isAddedDiffLine(line)).length;
  const removedLines = lines.filter((line) => isRemovedDiffLine(line)).length;
  const contextLines = lines.filter((line) => line.startsWith(" ")).length;
  return addedLines > 0 && removedLines > 0 && addedLines + removedLines + contextLines >= 4;
}

export function isAddedDiffLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++ ");
}

export function isRemovedDiffLine(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("--- ");
}
