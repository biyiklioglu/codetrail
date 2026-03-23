export const KNOWN_EXTERNAL_APP_VALUES = [
  "text_edit",
  "sublime_text",
  "vscode",
  "zed",
  "neovim",
  "cursor",
] as const;

export type KnownExternalAppId = (typeof KNOWN_EXTERNAL_APP_VALUES)[number];
