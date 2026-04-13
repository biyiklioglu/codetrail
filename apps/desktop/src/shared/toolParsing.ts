import { isLikelyEditOperation } from "@codetrail/core/tooling/editOperations";
export { buildUnifiedDiffFromTextPair } from "@codetrail/core/tooling/unifiedDiff";

export type ParsedToolEditFile = {
  filePath: string;
  previousFilePath?: string | null;
  changeType: "add" | "update" | "delete" | "move";
  oldText: string | null;
  newText: string | null;
  diff: string | null;
};

export type ParsedToolEditPayload = {
  filePath: string | null;
  oldText: string | null;
  newText: string | null;
  diff: string | null;
  files: ParsedToolEditFile[];
};

export function parseToolInvocationPayload(text: string): {
  record: Record<string, unknown>;
  name: string | null;
  prettyName: string | null;
  inputRecord: Record<string, unknown> | null;
  isWrite: boolean;
} | null {
  const record = tryParseJsonRecord(text);
  if (!record) {
    return null;
  }

  const functionCall = asObject(record.functionCall);
  const name =
    asNonEmptyString(record.name) ??
    asNonEmptyString(record.tool_name) ??
    asNonEmptyString(record.tool) ??
    asNonEmptyString(functionCall?.name) ??
    null;
  const inputRecord = asObject(record.input) ?? asObject(record.args) ?? asObject(record.arguments);
  const rawHint = [
    name,
    asNonEmptyString(record.operation),
    asNonEmptyString(inputRecord?.operation),
  ]
    .filter((value) => !!value)
    .join(" ");

  return {
    record,
    name,
    prettyName: name ? prettyToolName(name) : null,
    inputRecord,
    isWrite: isLikelyEditOperation(rawHint),
  };
}

function prettyToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const mapped: Record<string, string> = {
    exec_command: "Execute Command",
    run_command: "Execute Command",
    command: "Execute Command",
    grep: "Grep",
    search: "Search",
    read: "Read",
    edit: "Edit",
    apply_patch: "Apply Patch",
    write: "Write",
    write_file: "Write File",
    str_replace: "Replace Text",
    multi_edit: "Multi Edit",
  };
  if (mapped[normalized]) {
    return mapped[normalized];
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function parseToolEditPayload(text: string): ParsedToolEditPayload | null {
  const parsed = tryParseJsonRecord(text);
  if (!parsed) {
    return null;
  }

  const input = asObject(parsed.input);
  const args = asObject(parsed.args);
  const payload = input ?? args ?? parsed;
  const filePath =
    asNonEmptyString(payload.filePath) ??
    asNonEmptyString(payload.file_path) ??
    asNonEmptyString(payload.path) ??
    asNonEmptyString(payload.file) ??
    asNonEmptyString(parsed.filePath) ??
    asNonEmptyString(parsed.file_path) ??
    asNonEmptyString(parsed.path) ??
    null;
  const oldText =
    asString(payload.oldString) ??
    asString(payload.old_string) ??
    asString(payload.oldText) ??
    asString(payload.before) ??
    asString(parsed.oldString) ??
    asString(parsed.old_string) ??
    null;
  const newText =
    asString(payload.newString) ??
    asString(payload.new_string) ??
    asString(payload.newText) ??
    asString(payload.after) ??
    asString(payload.content) ??
    asString(payload.text) ??
    asString(payload.write_content) ??
    asString(payload.new_content) ??
    asString(parsed.newString) ??
    asString(parsed.new_string) ??
    null;
  const diff =
    asNonEmptyString(payload.diff) ??
    asNonEmptyString(payload.patch) ??
    asNonEmptyString(parsed.diff) ??
    asNonEmptyString(parsed.patch) ??
    null;
  const applyPatchInput =
    asNonEmptyString(parsed.input) ??
    asNonEmptyString(payload.input) ??
    asNonEmptyString(parsed.arguments) ??
    null;
  const applyPatchFiles = looksLikeApplyPatchPayload(parsed, payload)
    ? parseApplyPatchFiles(applyPatchInput)
    : [];
  const normalizedDiff = diff ?? buildApplyPatchDiff(applyPatchFiles);
  const normalizedFilePath = filePath ?? applyPatchFiles[0]?.filePath ?? null;
  const files =
    applyPatchFiles.length > 0
      ? applyPatchFiles
      : buildSingleToolEditFiles({
          filePath: normalizedFilePath,
          oldText,
          newText,
          diff: normalizedDiff,
        });

  return { filePath: normalizedFilePath, oldText, newText, diff: normalizedDiff, files };
}

export function tryParseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return asObject(parsed);
  } catch {
    return null;
  }
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeApplyPatchPayload(
  parsed: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const normalized = [
    asNonEmptyString(parsed.name),
    asNonEmptyString(parsed.tool),
    asNonEmptyString(parsed.type),
    asNonEmptyString(payload.operation),
    asNonEmptyString(payload.mode),
  ]
    .filter((value) => !!value)
    .join(" ")
    .toLowerCase();
  if (normalized.includes("apply_patch")) {
    return true;
  }
  return (
    asNonEmptyString(parsed.input)?.includes("*** Begin Patch") === true ||
    asNonEmptyString(payload.input)?.includes("*** Begin Patch") === true ||
    asNonEmptyString(parsed.arguments)?.includes("*** Begin Patch") === true
  );
}

function buildSingleToolEditFiles(args: {
  filePath: string | null;
  oldText: string | null;
  newText: string | null;
  diff: string | null;
}): ParsedToolEditFile[] {
  if (!args.filePath) {
    return [];
  }
  const changeType: ParsedToolEditFile["changeType"] =
    args.oldText === null && args.newText !== null
      ? "add"
      : args.oldText !== null && args.newText === null
        ? "delete"
        : "update";
  return [
    {
      filePath: args.filePath,
      previousFilePath: null,
      changeType,
      oldText: args.oldText,
      newText: args.newText,
      diff: args.diff,
    },
  ];
}

function buildApplyPatchDiff(files: ParsedToolEditFile[]): string | null {
  const diffs = files
    .map((file) => file.diff)
    .filter((diff): diff is string => typeof diff === "string" && diff.length > 0);
  return diffs.length > 0 ? diffs.join("\n") : null;
}

function parseApplyPatchFiles(patchText: string | null): ParsedToolEditFile[] {
  if (!patchText) {
    return [];
  }

  type ApplyPatchFileAccumulator = {
    filePath: string;
    changeType: ParsedToolEditFile["changeType"];
    oldPath: string;
    newPath: string;
    lines: string[];
    hasDiffRows: boolean;
  };

  const files: ParsedToolEditFile[] = [];
  let current: ApplyPatchFileAccumulator | null = null;

  const moveCurrentFile = (file: ApplyPatchFileAccumulator, destination: string) => {
    if (file.filePath !== destination) {
      file.changeType = "move";
    }
    file.filePath = destination;
    file.newPath = `b/${destination}`;
    file.lines[0] = `diff --git ${file.oldPath} ${file.newPath}`;
    file.lines[2] = `+++ ${file.newPath}`;
  };

  const appendDiffLine = (file: ApplyPatchFileAccumulator, diffLine: string) => {
    file.lines.push(diffLine);
    file.hasDiffRows = true;
  };

  const finishCurrent = () => {
    if (!current) {
      return;
    }
    files.push({
      filePath: current.filePath,
      previousFilePath:
        current.oldPath.startsWith("a/") && current.oldPath !== "/dev/null"
          ? current.oldPath.slice(2)
          : null,
      changeType: current.changeType,
      oldText: null,
      newText: null,
      diff: current.hasDiffRows ? current.lines.join("\n") : null,
    });
    current = null;
  };

  const startFile = (changeType: ParsedToolEditFile["changeType"], rawPath: string) => {
    finishCurrent();
    const filePath = rawPath.trim();
    if (!filePath) {
      return;
    }
    const oldPath = changeType === "add" ? "/dev/null" : `a/${filePath}`;
    const newPath = changeType === "delete" ? "/dev/null" : `b/${filePath}`;
    current = {
      filePath,
      changeType,
      oldPath,
      newPath,
      lines: [`diff --git ${oldPath} ${newPath}`, `--- ${oldPath}`, `+++ ${newPath}`],
      hasDiffRows: false,
    };
  };

  for (const line of patchText.split(/\r?\n/)) {
    if (line === "*** Begin Patch" || line === "*** End Patch" || line === "*** End of File") {
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      startFile("update", line.slice("*** Update File: ".length));
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      startFile("add", line.slice("*** Add File: ".length));
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      startFile("delete", line.slice("*** Delete File: ".length));
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      const destination = line.slice("*** Move to: ".length).trim();
      if (!current || !destination) {
        continue;
      }
      moveCurrentFile(current, destination);
      continue;
    }
    if (
      current &&
      (line.startsWith("@@") ||
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" "))
    ) {
      appendDiffLine(current, line);
    }
  }

  finishCurrent();
  return files;
}
