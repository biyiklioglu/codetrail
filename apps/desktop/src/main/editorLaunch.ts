import { basename } from "node:path";

import type { PaneState } from "./appStateStore";
import type {
  EditorInfo,
  EditorOpenRequest,
  LaunchCommand,
  ResolvedEditorDependencies,
} from "./editorDefinitions";
import {
  MACOS_OPEN_COMMAND,
  buildCustomTerminalLaunch,
  buildNeovimLaunch,
  isMacAppBundleCommand,
  shouldOpenMacAppBundleAsDocument,
} from "./editorMacos";
import { materializeContentTarget, materializeDiffTarget } from "./editorTempArtifacts";

export async function buildLaunchCommand(
  request: EditorOpenRequest,
  editor: EditorInfo,
  dependencies: ResolvedEditorDependencies,
  paneState: Partial<PaneState> | null | undefined,
): Promise<LaunchCommand | null> {
  const command = editor.command;
  if (!command) {
    return null;
  }

  if (editor.kind === "custom" || !editor.appId) {
    if (isMacAppBundleCommand(command)) {
      return buildCustomAppBundleLaunchCommand(request, command, dependencies, editor.args);
    }
    return buildCustomLaunchCommand(request, command, dependencies, editor.args);
  }

  if (request.kind === "diff") {
    const diffTarget = await materializeDiffTarget(request, dependencies);
    switch (editor.appId) {
      case "vscode":
      case "cursor":
      case "zed":
        return { command, args: ["--diff", diffTarget.leftPath, diffTarget.rightPath] };
      case "neovim":
        return buildNeovimLaunch(
          command,
          ["-d", diffTarget.leftPath, diffTarget.rightPath],
          paneState?.terminalAppCommand,
        );
      case "sublime_text":
        return null;
    }
  }

  if (request.kind !== "content" && !request.filePath) {
    return null;
  }

  const existingFilePath = request.filePath;
  const fileTarget =
    request.kind === "content"
      ? await materializeContentTarget(request, dependencies)
      : !existingFilePath
        ? null
        : {
            filePath: existingFilePath,
            ...(request.line ? { line: request.line } : {}),
            ...(request.column ? { column: request.column } : {}),
          };
  if (!fileTarget) {
    return null;
  }
  return buildFileLaunch(command, fileTarget, editor.appId, paneState?.terminalAppCommand);
}

function buildFileLaunch(
  command: string,
  request: { filePath: string; line?: number; column?: number },
  editorId: NonNullable<EditorInfo["appId"]>,
  terminalAppCommand?: string,
): LaunchCommand {
  const location = appendLineColumn(request.filePath, request.line, request.column);
  switch (editorId) {
    case "vscode":
    case "cursor":
      return request.line
        ? { command, args: ["--goto", location] }
        : { command, args: [request.filePath] };
    case "zed":
    case "sublime_text":
      return { command, args: [location] };
    case "text_edit":
      return { command: MACOS_OPEN_COMMAND, args: ["-a", command, request.filePath] };
    case "neovim":
      return buildNeovimLaunch(
        command,
        request.line
          ? [`+call cursor(${request.line},${request.column ?? 1})`, request.filePath]
          : [request.filePath],
        terminalAppCommand,
      );
  }
  return { command, args: [request.filePath] };
}

function appendLineColumn(filePath: string, line?: number, column?: number): string {
  if (!line) {
    return filePath;
  }
  return `${filePath}:${line}${column ? `:${column}` : ""}`;
}

async function buildCustomLaunchCommand(
  request: EditorOpenRequest,
  command: string,
  dependencies: ResolvedEditorDependencies,
  argsTemplate: string[],
): Promise<LaunchCommand | null> {
  if (request.kind === "diff") {
    const diffTarget = await materializeDiffTarget(request, dependencies);
    return {
      command,
      args: applyCustomArgs(argsTemplate, {
        file: request.filePath ?? diffTarget.rightPath,
        ...(request.line ? { line: request.line } : {}),
        ...(request.column ? { column: request.column } : {}),
        left: diffTarget.leftPath,
        right: diffTarget.rightPath,
        title: request.title,
      }),
    };
  }

  const target =
    request.kind === "content"
      ? await materializeContentTarget(request, dependencies)
      : {
          filePath: request.filePath,
          ...(request.line ? { line: request.line } : {}),
          ...(request.column ? { column: request.column } : {}),
        };
  if (!target.filePath) {
    return null;
  }

  return {
    command,
    args: applyCustomArgs(argsTemplate, {
      file: target.filePath,
      ...(target.line ? { line: target.line } : {}),
      ...(target.column ? { column: target.column } : {}),
      left: target.filePath,
      right: target.filePath,
      title: basename(target.filePath),
    }),
  };
}

async function buildCustomAppBundleLaunchCommand(
  request: EditorOpenRequest,
  command: string,
  dependencies: ResolvedEditorDependencies,
  argsTemplate: string[],
): Promise<LaunchCommand | null> {
  if (request.kind === "diff") {
    const diffTarget = await materializeDiffTarget(request, dependencies);
    const resolvedArgs = applyCustomArgs(argsTemplate, {
      file: request.filePath ?? diffTarget.rightPath,
      ...(request.line ? { line: request.line } : {}),
      ...(request.column ? { column: request.column } : {}),
      left: diffTarget.leftPath,
      right: diffTarget.rightPath,
      title: request.title,
    });
    return {
      command: MACOS_OPEN_COMMAND,
      args: ["-a", command, "--args", ...resolvedArgs],
    };
  }

  const target =
    request.kind === "content"
      ? await materializeContentTarget(request, dependencies)
      : {
          filePath: request.filePath,
          ...(request.line ? { line: request.line } : {}),
          ...(request.column ? { column: request.column } : {}),
        };
  if (!target.filePath) {
    return null;
  }
  const resolvedArgs = applyCustomArgs(argsTemplate, {
    file: target.filePath,
    ...(target.line ? { line: target.line } : {}),
    ...(target.column ? { column: target.column } : {}),
    left: target.filePath,
    right: target.filePath,
    title: basename(target.filePath),
  });

  if (shouldOpenMacAppBundleAsDocument(argsTemplate, target)) {
    return {
      command: MACOS_OPEN_COMMAND,
      args: ["-a", command, target.filePath],
    };
  }

  return {
    command: MACOS_OPEN_COMMAND,
    args: ["-a", command, "--args", ...resolvedArgs],
  };
}

function applyCustomArgs(
  argsTemplate: string[],
  values: {
    file: string;
    line?: number;
    column?: number;
    left: string;
    right: string;
    title: string;
  },
): string[] {
  if (argsTemplate.length === 0) {
    return [values.file];
  }
  return argsTemplate.map((arg) =>
    arg
      .replaceAll("{file}", values.file)
      .replaceAll("{line}", String(values.line ?? ""))
      .replaceAll("{column}", String(values.column ?? ""))
      .replaceAll("{left}", values.left)
      .replaceAll("{right}", values.right)
      .replaceAll("{title}", values.title),
  );
}
