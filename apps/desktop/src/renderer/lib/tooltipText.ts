import { useCallback } from "react";

import { type DesktopPlatform, isMacPlatform } from "../../shared/desktopPlatform";
import { useDesktopPlatform } from "./codetrailClient";

const MODIFIER_SYMBOLS = {
  Cmd: "⌘",
  Ctrl: "⌃",
  Shift: "⇧",
  Alt: "⌥",
  Option: "⌥",
} as const;

const KEY_SYMBOLS = {
  Plus: "+",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
} as const;

function formatShortcutSequence(sequence: string): string {
  const trimmed = sequence.trim().replace(/\+\+$/u, "+Plus");
  if (trimmed.length === 0) {
    return "";
  }
  const tokens = trimmed.split("+").map((token) => token.trim());
  return tokens
    .map((token) => {
      if (token in MODIFIER_SYMBOLS) {
        return MODIFIER_SYMBOLS[token as keyof typeof MODIFIER_SYMBOLS];
      }
      if (token in KEY_SYMBOLS) {
        return KEY_SYMBOLS[token as keyof typeof KEY_SYMBOLS];
      }
      return token;
    })
    .join("");
}

function formatShortcutSequencePlainText(sequence: string): string {
  const trimmed = sequence.trim().replace(/\+\+$/u, "+Plus");
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed
    .split("+")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => (token === "Plus" ? "+" : token))
    .join("+");
}

export function formatShortcutDisplay(shortcut: string, platform: DesktopPlatform): string {
  return isMacPlatform(platform)
    ? formatShortcutSequence(shortcut)
    : formatShortcutSequencePlainText(shortcut);
}

export function formatTooltip(
  action: string,
  shortcut: string | null | undefined,
  platform: DesktopPlatform,
): string {
  if (!shortcut) {
    return action;
  }
  return `${action}  ${formatShortcutDisplay(shortcut, platform)}`;
}

export function useTooltipFormatter(): (action: string, shortcut?: string | null) => string {
  const desktopPlatform = useDesktopPlatform();
  return useCallback(
    (action: string, shortcut?: string | null) => formatTooltip(action, shortcut, desktopPlatform),
    [desktopPlatform],
  );
}
