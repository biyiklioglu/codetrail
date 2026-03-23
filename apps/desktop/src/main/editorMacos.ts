import { basename, isAbsolute, join } from "node:path";

import type { LaunchCommand } from "./editorDefinitions";

export const MACOS_OPEN_COMMAND = "/usr/bin/open";
export const MACOS_OSASCRIPT_COMMAND = "/usr/bin/osascript";
export const DEFAULT_MAC_TERMINAL_APP = "Terminal";

export function isExplicitCommandPath(command: string): boolean {
  return isAbsolute(command) || command.includes("/") || command.includes("\\");
}

export function isMacAppBundleCommand(command: string): boolean {
  return process.platform === "darwin" && command.trim().toLowerCase().endsWith(".app");
}

export function shouldOpenMacAppBundleAsDocument(
  argsTemplate: string[],
  target: { filePath: string; line?: number; column?: number },
): boolean {
  if (target.line || target.column) {
    return false;
  }
  if (argsTemplate.length === 0) {
    return true;
  }
  return argsTemplate.length === 1 && argsTemplate[0]?.trim() === "{file}";
}

export function normalizeMacTerminalApp(value?: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return DEFAULT_MAC_TERMINAL_APP;
  }
  const baseName = basename(trimmed);
  const normalized = baseName.toLowerCase().endsWith(".app") ? baseName.slice(0, -4) : baseName;
  return normalized.length > 0 ? normalized : DEFAULT_MAC_TERMINAL_APP;
}

function isAppleScriptTerminalApp(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "terminal" || normalized.includes("iterm");
}

function isITermTerminalApp(value: string): boolean {
  return value.toLowerCase().includes("iterm");
}

export function buildCustomTerminalLaunch(command: string, shellCommand: string): LaunchCommand {
  if (isMacAppBundleCommand(command)) {
    const executablePath = join(command, "Contents", "MacOS", basename(command, ".app"));
    return {
      command: executablePath,
      args: ["/bin/zsh", "-lc", shellCommand],
    };
  }
  return {
    command,
    args: ["/bin/zsh", "-lc", shellCommand],
  };
}

export function buildNeovimLaunch(
  command: string,
  args: string[],
  terminalAppCommand?: string,
): LaunchCommand {
  if (process.platform !== "darwin") {
    return { command, args };
  }

  const customTerminalCommand = terminalAppCommand?.trim() ?? "";
  const terminalApp = normalizeMacTerminalApp(customTerminalCommand);
  const shellCommand = [
    "exec",
    quoteForShell(command),
    ...args.map((arg) => quoteForShell(arg)),
  ].join(" ");
  if (customTerminalCommand.length > 0 && !isAppleScriptTerminalApp(terminalApp)) {
    return buildCustomTerminalLaunch(customTerminalCommand, shellCommand);
  }
  if (isITermTerminalApp(terminalApp)) {
    return {
      command: MACOS_OSASCRIPT_COMMAND,
      args: [
        "-e",
        `tell application "${escapeAppleScriptString(terminalApp)}"`,
        "-e",
        "activate",
        "-e",
        "if (count of windows) = 0 then create window with default profile",
        "-e",
        `tell current session of current window to write text "${escapeAppleScriptString(shellCommand)}"`,
        "-e",
        "end tell",
      ],
    };
  }
  return {
    command: MACOS_OSASCRIPT_COMMAND,
    args: [
      "-e",
      `tell application "${escapeAppleScriptString(terminalApp)}"`,
      "-e",
      "activate",
      "-e",
      "if (count of windows) = 0 then reopen",
      "-e",
      `do script "${escapeAppleScriptString(shellCommand)}" in front window`,
      "-e",
      "end tell",
    ],
  };
}

export function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
