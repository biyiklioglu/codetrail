import type { execFile, spawn } from "node:child_process";
import type {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import type { IpcRequest, IpcResponse } from "@codetrail/core";

import type { KnownExternalAppId } from "../shared/uiPreferences";

export type EditorId = IpcResponse<"editor:listAvailable">["editors"][number]["id"];
export type EditorInfo = IpcResponse<"editor:listAvailable">["editors"][number];
export type EditorOpenRequest = IpcRequest<"editor:open">;
export type EditorOpenResponse = IpcResponse<"editor:open">;
export type ToolRole = "editor" | "diff";

export type EditorDefinition = {
  id: KnownExternalAppId;
  label: string;
  commands: string[];
  knownPaths: Partial<Record<NodeJS.Platform, string[]>>;
  capabilities: EditorInfo["capabilities"];
};

export type EditorDependencies = {
  execFile?:
    | ((...args: Parameters<typeof execFile>) => ReturnType<typeof execFile>)
    | ((
        file: string,
        args?: readonly string[] | null,
      ) => Promise<{ stdout: string; stderr: string }>);
  access?: typeof access;
  spawn?: typeof spawn;
  mkdtemp?: typeof mkdtemp;
  mkdir?: typeof mkdir;
  writeFile?: typeof writeFile;
  readdir?: typeof readdir;
  stat?: typeof stat;
  rm?: typeof rm;
  readFile?: typeof readFile;
};

export type ResolvedEditorDependencies = {
  execFile: (
    file: string,
    args?: readonly string[] | null,
  ) => Promise<{ stdout: string; stderr: string }>;
  access: typeof access;
  spawn: typeof spawn;
  mkdtemp: typeof mkdtemp;
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  readdir: typeof readdir;
  stat: typeof stat;
  rm: typeof rm;
  readFile: typeof readFile;
};

export type LaunchCommand = {
  command: string;
  args: string[];
};

export const EDITOR_DEFINITIONS: EditorDefinition[] = [
  {
    id: "text_edit",
    label: "Text Edit",
    commands: [],
    knownPaths: {
      darwin: ["/System/Applications/TextEdit.app", "/Applications/TextEdit.app"],
    },
    capabilities: { openFile: true, openAtLineColumn: false, openContent: true, openDiff: false },
  },
  {
    id: "vscode",
    label: "VS Code",
    commands: ["code", "code-insiders"],
    knownPaths: {
      darwin: [
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
      ],
      win32: [
        "C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd",
        "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
      ],
      linux: ["/usr/bin/code", "/snap/bin/code", "/usr/bin/code-insiders"],
    },
    capabilities: { openFile: true, openAtLineColumn: true, openContent: true, openDiff: true },
  },
  {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor"],
    knownPaths: {
      darwin: ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"],
      win32: [
        "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd",
      ],
      linux: ["/usr/bin/cursor", "/opt/Cursor/resources/app/bin/cursor"],
    },
    capabilities: { openFile: true, openAtLineColumn: true, openContent: true, openDiff: true },
  },
  {
    id: "zed",
    label: "Zed",
    commands: ["zed", "zeditor"],
    knownPaths: {
      darwin: ["/usr/local/bin/zed", "/Applications/Zed.app/Contents/MacOS/cli"],
      win32: [
        "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Zed\\zed.exe",
        "C:\\Program Files\\Zed\\zed.exe",
      ],
      linux: ["/usr/bin/zed", "/usr/bin/zeditor"],
    },
    capabilities: { openFile: true, openAtLineColumn: true, openContent: true, openDiff: true },
  },
  {
    id: "sublime_text",
    label: "Sublime Text",
    commands: ["subl", "sublime_text"],
    knownPaths: {
      darwin: [
        "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
        "/Applications/Sublime Text.app/Contents/MacOS/Sublime Text",
      ],
      win32: [
        "C:\\Program Files\\Sublime Text\\subl.exe",
        "C:\\Program Files\\Sublime Text\\sublime_text.exe",
      ],
      linux: ["/usr/bin/subl", "/opt/sublime_text/sublime_text"],
    },
    capabilities: { openFile: true, openAtLineColumn: true, openContent: true, openDiff: false },
  },
  {
    id: "neovim",
    label: "Neovim",
    commands: ["nvim"],
    knownPaths: {
      darwin: ["/opt/homebrew/bin/nvim", "/usr/local/bin/nvim"],
      win32: ["C:\\Program Files\\Neovim\\bin\\nvim.exe"],
      linux: ["/usr/bin/nvim", "/usr/local/bin/nvim"],
    },
    capabilities: { openFile: true, openAtLineColumn: true, openContent: true, openDiff: true },
  },
];

export function defaultCapabilitiesForRole(role: ToolRole): EditorInfo["capabilities"] {
  return role === "diff"
    ? { openFile: false, openAtLineColumn: false, openContent: false, openDiff: true }
    : { openFile: true, openAtLineColumn: true, openContent: true, openDiff: false };
}
