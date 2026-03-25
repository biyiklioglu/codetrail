export const APP_COMMAND_CHANNEL = "codetrail:app-command";

export const APP_COMMAND_VALUES = [
  "open-settings",
  "open-help",
  "search-current-view",
  "open-global-search",
  "refresh-now",
  "toggle-auto-refresh",
  "zoom-in",
  "zoom-out",
  "zoom-reset",
  "toggle-project-pane",
  "toggle-session-pane",
  "toggle-focus-mode",
  "toggle-all-messages-expanded",
] as const;

export type AppCommand = (typeof APP_COMMAND_VALUES)[number];
